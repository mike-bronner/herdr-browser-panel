import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const stubs = {
  websocket: "export const WebSocket = { connect: (...a) => globalThis.hostStubs.connect(...a) };",
  herdr: "export const appHome = () => globalThis.hostStubs.home; export const watchFolder = () => new Promise(() => {});",
  "gpui-kit": "export const image = () => null; export const div = () => null;",
};
const hooks = `const stubs = ${JSON.stringify(stubs)};
export async function resolve(specifier, context, next) {
  if (Object.hasOwn(stubs, specifier)) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]), shortCircuit: true };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
globalThis.hostStubs = { home: "/nonexistent", connect: async () => { throw new Error("no connect stub"); } };
const { Feed } = await import("../mods/browser/stream.js");

const tick = () => new Promise((r) => setImmediate(r));
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function renderCx() {
  const cx = {
    rendering: true,
    notified: 0,
    notify() {
      if (cx.rendering) throw new Error("cx.notify() is not allowed during the `render` phase");
      cx.notified++;
    },
    spawn(body) { return body(cx); },
    sleep: () => new Promise(() => {}),
  };
  return cx;
}

function conn(port) {
  const c = { opened: 0, closed: 0 };
  c.open = async () => { c.opened++; return { http: `http://127.0.0.1:${port}`, port }; };
  c.close = () => { c.closed++; return Promise.resolve(); };
  return c;
}

function socket() {
  return { read: () => new Promise(() => {}), write: async () => {}, close: async () => {} };
}

test("a feed started during render does not notify before its first await, and goes live", async () => {
  const urls = [];
  globalThis.hostStubs.connect = async (url) => { urls.push(url); return socket(); };
  const cx = renderCx();
  const feed = new Feed("t", conn(55821), 15).start(cx);
  assert.equal(feed.phase, "connecting");
  assert.equal(feed.error, null);
  cx.rendering = false;
  await tick();
  assert.equal(feed.phase, "live");
  assert.equal(feed.http, "http://127.0.0.1:55821");
  assert.deepEqual(urls, ["ws://127.0.0.1:55821/?maxFps=15&pacing=ack"]);
  assert.equal(cx.notified, 1);
  feed.stopped = true;
});

test("a refused stream connection shows the error phase with its reason and clears the http base", async () => {
  globalThis.hostStubs.connect = async () => { throw new Error("connection refused"); };
  const cx = renderCx();
  const c = conn(55821);
  const feed = new Feed("t", c, 15).start(cx);
  cx.rendering = false;
  await tick();
  assert.equal(feed.phase, "error");
  assert.equal(feed.error, "connection refused");
  assert.equal(feed.http, null);
  assert.ok(c.closed >= 1);
  assert.equal(cx.notified, 1);
  feed.stopped = true;
});

test("after a refused connection the loop backs off, notifies connecting once, and goes live on the retry", async () => {
  let calls = 0;
  globalThis.hostStubs.connect = async () => {
    if (++calls === 1) throw new Error("connection refused");
    return socket();
  };
  const phases = [], backoffs = [];
  let task;
  const cx = renderCx();
  const notify = cx.notify;
  cx.notify = () => { notify(); phases.push(feed.phase); };
  cx.sleep = async (ms) => { backoffs.push(ms); };
  cx.spawn = (body) => { task = body(cx); return task; };
  const c = conn(55821);
  const feed = new Feed("t", c, 15).start(cx);
  cx.rendering = false;
  let rejected = null;
  task.catch((e) => { rejected = e; });
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(phases, ["error", "connecting", "live"]);
  assert.equal(cx.notified, 3);
  assert.equal(c.opened, 2);
  assert.equal(feed.phase, "live");
  assert.equal(feed.error, null);
  assert.equal(feed.connects, 1);
  assert.equal(feed.http, "http://127.0.0.1:55821");
  assert.deepEqual(backoffs, [1000]);
  assert.equal(rejected, null);
  feed.stopped = true;
});

test("command refuses with not connected before the feed has an http base", async () => {
  const feed = new Feed("t", conn(1), 15);
  await assert.rejects(feed.command({ action: "reload" }), /not connected/);
});

test("navigate, back, forward and reload post to the session's command endpoint once connected", async () => {
  globalThis.hostStubs.connect = async () => socket();
  const posts = [];
  globalThis.fetch = async (url, init) => {
    posts.push({ url, origin: init.headers.Origin, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ success: true, data: null }) };
  };
  const cx = renderCx();
  const feed = new Feed("t", conn(55821), 15).start(cx);
  cx.rendering = false;
  await tick();
  for (const body of [{ action: "navigate", url: "https://example.com/" }, { action: "back" }, { action: "forward" }, { action: "reload" }]) await feed.command(body);
  assert.deepEqual(posts.map((p) => p.body.action), ["navigate", "back", "forward", "reload"]);
  assert.ok(posts.every((p) => p.url === "http://127.0.0.1:55821/api/command" && p.origin === "http://127.0.0.1:55821"));
  feed.stopped = true;
});

test("command reports the daemon's error text when it refuses", async () => {
  globalThis.hostStubs.connect = async () => socket();
  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ success: false, error: "bad url" }) });
  const cx = renderCx();
  const feed = new Feed("t", conn(55821), 15).start(cx);
  cx.rendering = false;
  await tick();
  await assert.rejects(feed.command({ action: "navigate", url: "x" }), /bad url/);
  feed.stopped = true;
});

test("a stop that lands while the connection opens ends the loop quietly without opening the socket", { timeout: 2000 }, async () => {
  let connects = 0;
  globalThis.hostStubs.connect = async () => { connects++; return socket(); };
  let release, task;
  const c = conn(55821);
  c.open = () => new Promise((r) => { release = () => r({ http: "http://127.0.0.1:55821", port: 55821 }); });
  const cx = renderCx();
  cx.rendering = false;
  cx.spawn = (body) => { task = body(cx); return task; };
  const feed = new Feed("t", c, 15).start(cx);
  await tick();
  assert.equal(feed.phase, "connecting");
  const stopped = feed.stop();
  release();
  await task;
  await stopped;
  assert.equal(connects, 0);
  assert.equal(feed.phase, "connecting");
  assert.equal(feed.error, null);
  assert.equal(feed.http, null);
  assert.equal(feed.ws, null);
  assert.equal(c.closed, 2);
  assert.equal(cx.notified, 0);
});

test("a stop that lands while the socket connects closes that socket and ends the loop quietly", { timeout: 2000 }, async () => {
  let release, closed = 0, task;
  globalThis.hostStubs.connect = () => new Promise((r) => { release = () => r({ ...socket(), close: async () => { closed++; } }); });
  const c = conn(55821);
  const cx = renderCx();
  cx.rendering = false;
  cx.spawn = (body) => { task = body(cx); return task; };
  const feed = new Feed("t", c, 15).start(cx);
  await tick();
  assert.equal(typeof release, "function");
  feed.stop();
  release();
  await task;
  assert.equal(closed, 1);
  assert.equal(feed.phase, "connecting");
  assert.equal(feed.error, null);
  assert.equal(feed.ws, null);
  assert.equal(feed.http, null);
  assert.equal(cx.notified, 0);
});

test("a tabs message keeps the session's tab list and redraws, and a malformed one is ignored", () => {
  const feed = new Feed("p", conn(1), 15);
  const cx = renderCx();
  cx.rendering = false;
  const tabs = [{ active: true, title: "Google", url: "https://www.google.com/" }];
  feed.handle(JSON.stringify({ type: "tabs", tabs }), cx);
  assert.deepEqual(feed.tabs, tabs);
  assert.equal(cx.notified, 1);
  feed.handle(JSON.stringify({ type: "tabs", tabs: "nope" }), cx);
  assert.deepEqual(feed.tabs, tabs);
  assert.equal(cx.notified, 1);
});
