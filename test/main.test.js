import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const stubs = {
  "gpui-kit": "export class View {} export const div = () => null; export const image = () => null;",
  "gpui-base": "export const v_flex = () => null; export const h_flex = () => null; export const Input = { new: () => null }; export const InputState = { new: () => { let v = ''; return { on() {}, value: () => v, set_value(x) { v = x; } }; } };",
  herdr: ["exec", "focused", "spaces", "panes", "theme", "window", "layout", "checking", "hc", "appHome", "readTextFile", "watchFolder"]
    .map((name) => `export const ${name} = (...a) => globalThis.host.${name}(...a);`).join("\n"),
  websocket: "export const WebSocket = { connect: async () => { throw new Error('no socket'); } };",
};
const hooks = `const stubs = ${JSON.stringify(stubs)};
export async function resolve(specifier, context, next) {
  if (Object.hasOwn(stubs, specifier)) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]), shortCircuit: true };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

const { DISCOVER } = await import("../mods/browser/discovery.js");
const { DETECT } = await import("../mods/browser/address.js");
const { default: Browser } = await import("../mods/browser/main.js");

const TARGET = { address: "t6", machine: null, id: "t6", session: "herdr-t6", since: 1 };
let calls, sessions, visible, stored, openResult, detectFails;

function discovery() {
  return ['{"os":"Darwin","agentBrowser":true}', ...sessions.map((s) => JSON.stringify({ session: s.session, dir: "/tmp/agent-browser", pid: 77, port: 0, engine: "chrome", target: { url: s.url } }))].join("\n");
}

beforeEach(() => {
  calls = [];
  sessions = [];
  visible = true;
  openResult = { code: 0, stdout: "", stderr: "" };
  detectFails = false;
  stored = new Map();
  globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)) };
  globalThis.host = {
    checking: () => false,
    window: () => ({ visible }),
    layout: () => null,
    exec: async (command, args, options) => {
      calls.push({ command, args, on: options?.on ?? null });
      if (command === "sh" && args[1] === DISCOVER) return { code: 0, stdout: discovery(), stderr: "" };
      if (command === "sh" && args[1] === DETECT) {
        if (detectFails) throw new Error("machine unreachable");
        return { code: 0, stderr: "", stdout: ["home\t/home/me", `folder\t${args[3]}`, "lsof\tp9", "lsof\tf3", "lsof\tn*:3000", "lsofcwd\tp9", "lsofcwd\tfcwd", `lsofcwd\tn${args[3]}`].join("\n") };
      }
      if (command === "agent-browser" && args[2] === "open") return openResult;
      return { code: 0, stdout: "", stderr: "" };
    },
  };
});

function panel(folder) {
  globalThis.host.checking = () => true;
  const b = new Browser();
  const cx = { tasks: [], notify() {}, focus_handle: () => ({ is_focused: () => false }), spawn(body) { const p = body(cx); cx.tasks.push(p); return p; } };
  b.init({}, cx);
  globalThis.host.checking = () => false;
  b.target = TARGET;
  b.folder = folder;
  b.shownAt = 0;
  b.scans.set("", { at: 5, os: "Darwin", tools: { agentBrowser: true }, sessions: sessions.map((s) => ({ ...s, namespace: null, pid: 77, port: null, engine: "chrome" })), error: null });
  return { b, cx };
}

const opens = () => calls.filter((c) => c.command === "agent-browser" && c.args[2] === "open").map((c) => c.args);
const streams = () => calls.filter((c) => c.command === "agent-browser" && c.args.join(" ") === "--session herdr-t6 stream enable");

async function drain(cx) {
  for (let seen = 0; seen < cx.tasks.length;) {
    seen = cx.tasks.length;
    await Promise.all(cx.tasks);
  }
}

test("a shown terminal with no session starts one at the detected address, with the folder as an argument", async () => {
  const { b, cx } = panel("/home/me/shop");
  b.settle(cx);
  await Promise.all(cx.tasks);
  assert.deepEqual(opens(), [["--session", "herdr-t6", "open", "http://127.0.0.1:3000/"]]);
  const detect = calls.find((c) => c.command === "sh" && c.args[1] === DETECT);
  assert.deepEqual(detect.args, ["-c", DETECT, "sh", "/home/me/shop"]);
  assert.ok(calls.some((c) => c.command === "agent-browser" && c.args.join(" ") === "--session herdr-t6 stream enable"));
  assert.equal(b.starts.get("|t6").status, "started");
});

test("the Start button's start reaches agent-browser open too", async () => {
  const { b, cx } = panel("/home/me/shop");
  b.start(TARGET, cx);
  await Promise.all(cx.tasks);
  assert.deepEqual(opens(), [["--session", "herdr-t6", "open", "http://127.0.0.1:3000/"]]);
  assert.equal(streams().length, 1);
});

test("a session that appears while the address is found is connected to and not navigated", async () => {
  const { b, cx } = panel("/home/me/shop");
  sessions = [{ session: "herdr-t6", url: "https://agent.test/" }];
  b.start(TARGET, cx);
  await Promise.all(cx.tasks);
  assert.deepEqual(opens(), []);
  assert.deepEqual(streams(), []);
});

test("nothing starts while the panel is hidden, or for a running session", async () => {
  visible = false;
  const hidden = panel("/home/me/shop");
  hidden.b.settle(hidden.cx);
  visible = true;
  sessions = [{ session: "herdr-t6", url: "https://agent.test/" }];
  const live = panel("/home/me/shop");
  live.b.settle(live.cx);
  await Promise.all([...hidden.cx.tasks, ...live.cx.tasks]);
  assert.deepEqual(calls, []);
});

test("a running session's address is remembered under its own folder, not the one the terminal moved to", () => {
  sessions = [{ session: "herdr-t6", url: "https://a.test/one" }];
  const { b, cx } = panel("/home/me/a");
  b.settle(cx);
  b.folder = "/home/me/b";
  b.scans.get("").sessions[0].url = "https://a.test/two";
  b.settle(cx);
  const memory = JSON.parse(stored.get("lastUrls"));
  assert.deepEqual(Object.keys(memory), ["|/home/me/a"]);
  assert.equal(memory["|/home/me/a"].url, "https://a.test/two");
  assert.equal(memory["|/home/me/b"], undefined);
});

test("a failed start keeps its error and is not started again by the next settle", async () => {
  openResult = { code: 1, stdout: "", stderr: "Chrome failed to launch" };
  const { b, cx } = panel("/home/me/shop");
  b.settle(cx);
  await drain(cx);
  b.settle(cx);
  await drain(cx);
  assert.equal(opens().length, 1);
  assert.equal(b.current().kind, "start");
  assert.equal(b.current().error, "Chrome failed to launch");
});

test("a start remembers the session's address under the folder it started in, not the one the terminal moved to", async () => {
  const { b, cx } = panel("/home/me/a");
  b.start(TARGET, cx);
  b.folder = "/home/me/b";
  sessions = [{ session: "herdr-t6", url: "https://a.test/page" }];
  await drain(cx);
  b.settle(cx);
  const memory = JSON.parse(stored.get("lastUrls"));
  assert.deepEqual(Object.keys(memory), ["|/home/me/a"]);
  assert.equal(memory["|/home/me/a"].url, "https://a.test/page");
  assert.equal(memory["|/home/me/b"], undefined);
});

test("a start whose detection fails opens a blank page", async () => {
  detectFails = true;
  const { b, cx } = panel("/home/me/shop");
  b.start(TARGET, cx);
  await drain(cx);
  assert.deepEqual(opens(), [["--session", "herdr-t6", "open", "about:blank"]]);
});

async function autoStartedThenEnded(afterMs) {
  const { b, cx } = panel("/home/me/shop");
  b.settle(cx);
  await drain(cx);
  assert.equal(opens().length, 1);
  sessions = [{ session: "herdr-t6", url: "http://127.0.0.1:3000/" }];
  b.keep("", { at: Date.now(), os: "Darwin", tools: { agentBrowser: true }, sessions: [{ session: "herdr-t6", namespace: null, pid: 77, port: null, engine: "chrome", url: "http://127.0.0.1:3000/" }], error: null });
  b.settle(cx);
  assert.equal(b.current().kind, "running");
  const realNow = Date.now;
  Date.now = () => realNow() + afterMs;
  try {
    sessions = [];
    b.keep("", { at: Date.now(), os: "Darwin", tools: { agentBrowser: true }, sessions: [], error: null });
    b.settle(cx);
    await drain(cx);
  } finally {
    Date.now = realNow;
  }
  return b;
}

test("an auto-started session that ends within 30 seconds is not restarted, so the Start button shows", async () => {
  const b = await autoStartedThenEnded(29000);
  assert.equal(opens().length, 1);
  assert.equal(b.current().kind, "start");
  assert.equal(b.current().error, null);
});

test("an auto-started session that ends after 30 seconds is restarted", async () => {
  await autoStartedThenEnded(31000);
  assert.equal(opens().length, 2);
});
