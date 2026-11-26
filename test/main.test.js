import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const stubs = {
  "gpui-kit": "const c = new Proxy(function () {}, { get: (_t, k) => k === 'then' ? undefined : () => c, apply: () => c }); export class View {} export const div = () => c; export const image = () => c; export const svg = () => c;",
  "gpui-base": "const c = new Proxy(function () {}, { get: (_t, k) => k === 'then' ? undefined : () => c, apply: () => c }); export const v_flex = () => c; export const h_flex = () => c; export const Input = { new: () => c }; export const InputState = { new: () => { let v = ''; const handlers = {}; const s = { handlers, range: null, focused: false, on(name, h) { handlers[name] = h; }, value: () => v, set_value(x) { v = x; }, set_selected_range(r) { s.range = r; }, focus() { if (s.focused) return; s.focused = true; handlers.focus?.({}, { notify() {} }); }, blur() { if (!s.focused) return; s.focused = false; handlers.blur?.({}, { notify() {} }); } }; return s; } };",
  herdr: ["exec", "run", "focused", "spaces", "panes", "machines", "theme", "window", "layout", "checking", "settings", "hc", "appHome", "readTextFile", "watchFolder"]
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
const { targetKey } = await import("../mods/browser/panel.js");

const TARGET = { address: "t6", machine: null, id: "t6", session: "herdr-t6", since: 1 };
let calls, sessions, remoteSessions, listing, visible, stored, openResult, detectFails, hcCalls, runResult, closeResult, events, commands;

function discovery(on) {
  return ['{"os":"Darwin","agentBrowser":true}', ...(on ? remoteSessions[on] ?? sessions : sessions).map((s) => JSON.stringify({ session: s.session, dir: s.dir ?? "/tmp/agent-browser", pid: 77, port: 0, engine: "chrome", target: { url: s.url } }))].join("\n");
}

beforeEach(() => {
  calls = [];
  sessions = [];
  remoteSessions = {};
  listing = null;
  visible = true;
  openResult = { code: 0, stdout: "", stderr: "" };
  detectFails = false;
  hcCalls = [];
  events = [];
  commands = [];
  closeResult = async () => { sessions = []; return { code: 0, stdout: "✓ Browser closed", stderr: "" }; };
  runResult = async () => ({ code: 0, stderr: "", stdout: JSON.stringify({ address: "build_box/t1q", output: "", state: "live", wait: { ended: true, exit_code: 0, reason: "exit", signal: null } }) });
  stored = new Map();
  globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)) };
  globalThis.host = {
    checking: () => false,
    window: () => ({ visible }),
    settings: () => ({ zoom: 1 }),
    layout: () => null,
    run: (name, args) => { commands.push([name, args]); return null; },
    machines: () => [{ name: null, layout: "ready" }],
    panes: () => [],
    spaces: () => [],
    exec: async (command, args, options) => {
      calls.push({ command, args, on: options?.on ?? null });
      if (command === "sh" && args[1] === DISCOVER) return { code: 0, stdout: discovery(options?.on), stderr: "" };
      if (command === "sh" && args[1] === DETECT) {
        if (detectFails) throw new Error("machine unreachable");
        return { code: 0, stderr: "", stdout: ["home\t/home/me", `folder\t${args[3]}`, "lsof\tp9", "lsof\tf3", "lsof\tn*:3000", "lsofcwd\tp9", "lsofcwd\tfcwd", `lsofcwd\tn${args[3]}`].join("\n") };
      }
      if (command === "env" && args.includes("open")) return openResult;
      if (command === "agent-browser" && args.at(-1) === "close") {
        events.push("close");
        return closeResult(args, options);
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    hc: async (args) => {
      hcCalls.push(args);
      if (args[0] === "run") return runResult(args);
      if (args[0] === "ls") return listing ? listing() : { code: 0, stdout: "{}", stderr: "" };
      return { code: 0, stdout: "{}", stderr: "" };
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

const opens = () => calls.filter((c) => c.command === "env" && c.args.includes("open")).map((c) => c.args);
const opening = (url) => ["AGENT_BROWSER_STREAM_MAX_WIDTH=8192", "AGENT_BROWSER_STREAM_MAX_HEIGHT=8192", "agent-browser", "--session", "herdr-t6", "--args", "--force-device-scale-factor=2", "open", url];
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
  assert.deepEqual(opens(), [opening("http://127.0.0.1:3000/")]);
  const detect = calls.find((c) => c.command === "sh" && c.args[1] === DETECT);
  assert.deepEqual(detect.args, ["-c", DETECT, "sh", "/home/me/shop"]);
  assert.ok(calls.some((c) => c.command === "agent-browser" && c.args.join(" ") === "--session herdr-t6 stream enable"));
  assert.equal(b.starts.get("|t6").status, "started");
});

test("the Start button's start reaches agent-browser open too", async () => {
  const { b, cx } = panel("/home/me/shop");
  b.start(TARGET, cx);
  await Promise.all(cx.tasks);
  assert.deepEqual(opens(), [opening("http://127.0.0.1:3000/")]);
  assert.equal(streams().length, 1);
});

const REMOTE = { address: "build_box/t6", machine: "build_box", id: "t6", session: "herdr-t6", since: 1 };
const remoteRun = ["run", "--json", "--on", "build_box", "--no-parent", "--no-notify", "--timeout", "60", "--label", "browser=start", "--", "env", ...opening("about:blank")];

async function startRemote() {
  const { b, cx } = panel("/home/me/shop");
  b.start(REMOTE, cx);
  await drain(cx);
  b.target = REMOTE;
  return b;
}

test("a start on a remote machine runs the scaled launch in a Herdr terminal there, removes it, and enables the stream there", async () => {
  const b = await startRemote();
  assert.deepEqual(opens(), []);
  assert.deepEqual(hcCalls, [remoteRun, ["rm", "build_box/t1q"]]);
  assert.deepEqual(streams().map((c) => c.on), ["build_box"]);
  assert.equal(b.starts.get(targetKey(REMOTE)).status, "started");
});

test("a local start still runs the scaled launch directly, with no Herdr terminal", async () => {
  const { b, cx } = panel("/home/me/shop");
  b.start(TARGET, cx);
  await drain(cx);
  assert.deepEqual(hcCalls, []);
  assert.deepEqual(calls.filter((c) => c.command === "env").map((c) => c.on), [null]);
});

test("a remote open that fails shows what it printed in the panel, and its terminal is removed", async () => {
  runResult = async () => ({ code: 0, stderr: "", stdout: JSON.stringify({ address: "build_box/t1q", output: "✗ Chrome failed to launch\n", wait: { ended: true, exit_code: 1, reason: "exit", signal: null } }) });
  const b = await startRemote();
  assert.deepEqual(hcCalls, [remoteRun, ["rm", "build_box/t1q"]]);
  assert.deepEqual(streams(), []);
  assert.deepEqual(b.starts.get(targetKey(REMOTE)), { status: "failed", error: "✗ Chrome failed to launch" });
  const state = b.current();
  assert.equal(state.kind, "start");
  assert.equal(state.error, "✗ Chrome failed to launch");
});

test("a remote open still running when the wait ends is killed, removed and shown as failed", async () => {
  runResult = async () => ({ code: 0, stderr: "", stdout: JSON.stringify({ address: "build_box/t1q", output: "", wait: { ended: false, exit_code: null, reason: "timeout", signal: null } }) });
  const b = await startRemote();
  assert.deepEqual(hcCalls, [remoteRun, ["kill", "build_box/t1q"], ["rm", "build_box/t1q"]]);
  assert.equal(b.current().error, "agent-browser open did not finish within 60 s");
});

test("a remote terminal that cannot start shows hc's error, with nothing to remove", async () => {
  runResult = async () => ({ code: 1, stdout: "", stderr: JSON.stringify({ error: { kind: "spawn_failed", message: "cannot start \"env\"" } }) });
  const b = await startRemote();
  assert.deepEqual(hcCalls, [remoteRun]);
  assert.equal(b.current().error, "cannot start \"env\"");
});

test("a remote start whose hc call throws shows the machine and the reason", async () => {
  runResult = async () => { throw new Error("machine unreachable"); };
  const b = await startRemote();
  assert.equal(b.current().error, "agent-browser could not run on build_box: machine unreachable");
});

test("a failed cleanup of the remote terminal does not turn a good start into a failure", async () => {
  globalThis.host.hc = async (args) => {
    hcCalls.push(args);
    if (args[0] === "run") return runResult(args);
    throw new Error("core gone");
  };
  const b = await startRemote();
  assert.deepEqual(hcCalls, [remoteRun, ["rm", "build_box/t1q"]]);
  assert.equal(b.starts.get(targetKey(REMOTE)).status, "started");
});

test("a timed-out remote open whose kill fails is still removed and shown as timed out", async () => {
  runResult = async () => ({ code: 0, stderr: "", stdout: JSON.stringify({ address: "build_box/t1q", output: "", wait: { ended: false, exit_code: null, reason: "timeout", signal: null } }) });
  globalThis.host.hc = async (args) => {
    hcCalls.push(args);
    if (args[0] === "run") return runResult(args);
    if (args[0] === "kill") throw new Error("core gone");
    return { code: 0, stdout: "{}", stderr: "" };
  };
  const b = await startRemote();
  assert.deepEqual(hcCalls, [remoteRun, ["kill", "build_box/t1q"], ["rm", "build_box/t1q"]]);
  assert.equal(b.current().error, "agent-browser open did not finish within 60 s");
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
  assert.deepEqual(opens(), [opening("about:blank")]);
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

function sized(phase = "live") {
  const { b, cx } = panel("/home/me/shop");
  const sent = [];
  cx.timers = [];
  cx.timer = { after: (ms, fn) => cx.timers.push({ ms, fn }) };
  b.feed = { phase, connects: 1, command: async (body) => { sent.push(body); return null; }, stop: async () => {} };
  b.feedKey = "k";
  return { b, cx, sent };
}

test("a live feed sets the session's viewport to the picture area, rounded to whole pixels", async () => {
  const { b, cx, sent } = sized();
  b.area = { width: 489.6, height: 1000.2 };
  b.fit(cx);
  await drain(cx);
  assert.deepEqual(sent, [{ action: "viewport", width: 490, height: 1000, deviceScaleFactor: 0 }]);
});

test("an unchanged area sends no second viewport", async () => {
  const { b, cx, sent } = sized();
  b.area = { width: 490, height: 1000 };
  b.fit(cx);
  b.fit(cx);
  await drain(cx);
  assert.equal(sent.length, 1);
  assert.deepEqual(cx.timers, []);
});

test("no viewport is sent while the panel is hidden, or before the feed is live", async () => {
  visible = false;
  const hidden = sized();
  hidden.b.area = { width: 490, height: 1000 };
  hidden.b.fit(hidden.cx);
  visible = true;
  const connecting = sized("connecting");
  connecting.b.area = { width: 490, height: 1000 };
  connecting.b.fit(connecting.cx);
  await drain(hidden.cx);
  await drain(connecting.cx);
  assert.deepEqual(hidden.sent, []);
  assert.deepEqual(connecting.sent, []);
});

test("a resize under way waits for the gap once, then sends the latest area", async () => {
  const { b, cx, sent } = sized();
  b.area = { width: 490, height: 1000 };
  b.fit(cx);
  b.area = { width: 500, height: 1000 };
  b.fit(cx);
  b.area = { width: 520, height: 990 };
  b.fit(cx);
  await drain(cx);
  assert.equal(sent.length, 1);
  assert.equal(cx.timers.length, 1);
  assert.ok(cx.timers[0].ms > 0 && cx.timers[0].ms <= 250);
  const realNow = Date.now;
  Date.now = () => realNow() + 300;
  try { cx.timers[0].fn(cx); } finally { Date.now = realNow; }
  await drain(cx);
  assert.deepEqual(sent.at(-1), { action: "viewport", width: 520, height: 990, deviceScaleFactor: 0 });
});

test("render's own check sends when due but never schedules a wait", async () => {
  const { b, cx, sent } = sized();
  b.area = { width: 490, height: 1000 };
  b.fit(cx, false);
  b.area = { width: 500, height: 1000 };
  b.fit(cx, false);
  await drain(cx);
  assert.equal(sent.length, 1);
  assert.deepEqual(cx.timers, []);
});

test("a new feed sets the viewport again for the same area", async () => {
  const { b, cx, sent } = sized();
  b.area = { width: 490, height: 1000 };
  b.fit(cx);
  await b.drop();
  b.feed = { phase: "live", connects: 1, command: async (body) => { sent.push(body); return null; }, stop: async () => {} };
  b.feedKey = "k2";
  b.fit(cx);
  await drain(cx);
  assert.equal(sent.length, 2);
});

test("a too small area sends no viewport", async () => {
  const { b, cx, sent } = sized();
  b.area = { width: 0, height: 0 };
  b.fit(cx);
  await drain(cx);
  assert.deepEqual(sent, []);
});

test("focusing the address selects all of it, and leaving it puts back the page's address", () => {
  const { b, cx } = panel("/home/me/shop");
  b.shownUrl = "https://a.test/page";
  b.address.set_value("https://a.test/page");
  b.address.handlers.focus({}, cx);
  assert.equal(b.editing, true);
  assert.deepEqual(b.address.range, { start: 0, end: "https://a.test/page".length });
  b.address.set_value("half typed");
  b.address.handlers.blur({}, cx);
  assert.equal(b.editing, false);
  assert.equal(b.address.value(), "https://a.test/page");
});

test("submitting the address navigates, gives up the keyboard and keeps the typed address", async () => {
  const { b, cx, sent } = sized();
  b.address.focus();
  b.address.set_value("example.com");
  b.address.handlers.submit({}, cx);
  await drain(cx);
  assert.deepEqual(sent, [{ action: "navigate", url: "https://example.com" }]);
  assert.equal(b.address.focused, false);
  assert.equal(b.editing, false);
  assert.equal(b.shownUrl, "example.com");
  assert.equal(b.address.value(), "example.com");
});

test("submitting an empty address sends nothing and gives up the keyboard", async () => {
  const { b, cx, sent } = sized();
  b.address.focus();
  b.address.set_value("   ");
  b.address.handlers.submit({}, cx);
  await drain(cx);
  assert.deepEqual(sent, []);
  assert.equal(b.address.focused, false);
});

test("back, forward and reload each reach the feed's command with that action", async () => {
  const { b, cx, sent } = sized();
  for (const action of ["back", "forward", "reload"]) b.act({ action }, cx);
  await drain(cx);
  assert.deepEqual(sent, [{ action: "back" }, { action: "forward" }, { action: "reload" }]);
  assert.equal(b.note, null);
});

test("an action with no feed sends nothing and does not throw", async () => {
  const { b, cx, sent } = sized();
  b.feed = null;
  b.act({ action: "reload" }, cx);
  await drain(cx);
  assert.deepEqual(sent, []);
  assert.equal(cx.tasks.length, 0);
});

test("a failed action leaves a note with the action and the error", async () => {
  const { b, cx, sent } = sized();
  b.feed.command = async (body) => { sent.push(body); throw new Error("no history"); };
  b.act({ action: "back" }, cx);
  await drain(cx);
  assert.deepEqual(sent, [{ action: "back" }]);
  assert.equal(b.note.text, "back: no history");
});

test("an action that fails after the feed was replaced leaves no note", async () => {
  const { b, cx, sent } = sized();
  const next = { phase: "live", connects: 1, command: async () => null, stop: async () => {} };
  b.feed.command = async (body) => { sent.push(body); b.feed = next; throw new Error("socket closed"); };
  b.act({ action: "reload" }, cx);
  await drain(cx);
  assert.deepEqual(sent, [{ action: "reload" }]);
  assert.equal(b.feed, next);
  assert.equal(b.note, null);
});

test("Escape in the address cancels the edit and puts back the page's address", () => {
  const { b, cx } = panel("/home/me/shop");
  let stopped = 0;
  const keyCx = { ...cx, stop_propagation: () => { stopped++; } };
  b.shownUrl = "https://a.test/page";
  b.address.set_value("https://a.test/page");
  b.address.focus();
  b.address.set_value("half typed");
  b.addressKey({ key: "escape" }, keyCx);
  assert.equal(b.address.focused, false);
  assert.equal(b.editing, false);
  assert.equal(b.address.value(), "https://a.test/page");
  assert.equal(stopped, 1);
});

test("other keys in the address, and Escape when not editing, are left alone", () => {
  const { b, cx } = panel("/home/me/shop");
  let stopped = 0;
  const keyCx = { ...cx, stop_propagation: () => { stopped++; } };
  b.addressKey({ key: "escape" }, keyCx);
  b.address.focus();
  b.address.set_value("typing");
  b.addressKey({ key: "a" }, keyCx);
  assert.equal(b.address.focused, true);
  assert.equal(b.address.value(), "typing");
  assert.equal(stopped, 0);
});

function refusing() {
  const s = sized();
  let fail = true;
  s.b.feed.command = async (body) => {
    s.sent.push(body);
    if (fail) throw new Error("HTTP 500");
    return null;
  };
  s.succeed = () => { fail = false; };
  s.at = async (ms, area = s.b.area) => {
    const realNow = Date.now;
    Date.now = () => realNow() + ms;
    try {
      s.b.area = area;
      s.b.fit(s.cx);
      await drain(s.cx);
    } finally {
      Date.now = realNow;
    }
  };
  s.b.area = { width: 490, height: 1000 };
  return s;
}

test("a refused viewport is retried after a backoff that doubles, and the note shows once per run of failures", async () => {
  const { b, cx, sent, at } = refusing();
  await at(0);
  assert.equal(sent.length, 1);
  assert.equal(b.note.text, "viewport: HTTP 500");
  b.note = null;
  await at(300);
  assert.equal(sent.length, 1);
  const waits = () => cx.timers.filter((t) => t.ms < 4000).map((t) => t.ms);
  assert.equal(waits().length, 1);
  const first = waits()[0];
  assert.ok(first > 600 && first <= 1000, String(first));
  await at(1100);
  assert.equal(sent.length, 2);
  b.fitting = false;
  await at(1400);
  assert.equal(sent.length, 2);
  const second = waits().at(-1);
  assert.ok(second > first, `${second} after ${first}`);
  await at(3200);
  assert.equal(sent.length, 3);
  assert.equal(b.note, null);
});

test("render's own check does not retry a refused viewport before its backoff ends", async () => {
  const { b, cx, sent, at } = refusing();
  await at(0);
  for (const ms of [300, 600, 900]) {
    const realNow = Date.now;
    Date.now = () => realNow() + ms;
    try { b.fit(cx, false); } finally { Date.now = realNow; }
  }
  await drain(cx);
  assert.equal(sent.length, 1);
  assert.deepEqual(cx.timers.filter((t) => t.ms < 4000), []);
});

test("a retry that succeeds ends the backoff, so the same size is not sent again", async () => {
  const { b, sent, at, succeed } = refusing();
  await at(0);
  succeed();
  await at(1100);
  await at(5000);
  assert.equal(sent.length, 2);
  assert.equal(b.sized.failures, 1);
  assert.equal(b.sized.retryAt, undefined);
});

test("a new area or a new connect sends at once despite a refused viewport's backoff", async () => {
  const area = refusing();
  await area.at(0);
  await area.at(300, { width: 520, height: 1000 });
  assert.deepEqual(area.sent.at(-1), { action: "viewport", width: 520, height: 1000, deviceScaleFactor: 0 });
  assert.equal(area.b.sized.failures, 1);
  const connect = refusing();
  await connect.at(0);
  connect.b.feed.connects = 2;
  await connect.at(300);
  assert.equal(connect.sent.length, 2);
});

test("a feed that reconnects and goes live again gets the viewport again", async () => {
  const { b, cx, sent } = sized();
  b.area = { width: 490, height: 1000 };
  b.fit(cx);
  b.feed.phase = "error";
  b.fit(cx);
  b.feed.phase = "live";
  b.feed.connects = 2;
  b.fit(cx);
  await drain(cx);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], { action: "viewport", width: 490, height: 1000, deviceScaleFactor: 0 });
});

test("a narrow area sends its own width at scale 0 on every platform", async () => {
  globalThis.host.window = () => ({ visible, platform: "macos" });
  const { b, cx, sent } = sized();
  b.area = { width: 361, height: 1228 };
  b.fit(cx);
  await drain(cx);
  assert.deepEqual(sent, [{ action: "viewport", width: 361, height: 1228, deviceScaleFactor: 0 }]);
});

function staleAt(page, clean = false) {
  return { page, frame: { width: page.width, height: page.height }, crop: page, clean };
}

test("a stale frame of the size just sent gets the same viewport again after the gap, at most three times", async () => {
  const { b, cx, sent } = sized();
  b.area = { width: 361, height: 1228 };
  b.fit(cx);
  await drain(cx);
  b.feed.picture = staleAt({ width: 361, height: 1228 });
  const realNow = Date.now;
  try {
    for (let i = 1; i <= 5; i++) {
      Date.now = () => realNow() + 300 * i;
      b.fit(cx, false);
      await drain(cx);
    }
  } finally {
    Date.now = realNow;
  }
  assert.equal(sent.length, 4);
  assert.deepEqual(sent.at(-1), { action: "viewport", width: 361, height: 1228, deviceScaleFactor: 0 });
  assert.equal(b.sized.refits, 3);
});

test("a stale frame schedules its resend when render finds it before the gap ends", async () => {
  const { b, cx, sent } = sized();
  b.area = { width: 361, height: 1228 };
  b.fit(cx);
  b.feed.picture = staleAt({ width: 361, height: 1228 });
  b.fit(cx, true);
  await drain(cx);
  assert.equal(sent.length, 1);
  assert.equal(cx.timers.length, 1);
});

test("a clean frame, or a stale frame of another size, sends no second viewport", async () => {
  for (const picture of [staleAt({ width: 361, height: 1228 }, true), staleAt({ width: 600, height: 800 })]) {
    const { b, cx, sent } = sized();
    b.area = { width: 361, height: 1228 };
    b.fit(cx);
    await drain(cx);
    b.feed.picture = picture;
    const realNow = Date.now;
    Date.now = () => realNow() + 1000;
    try { b.fit(cx, false); } finally { Date.now = realNow; }
    await drain(cx);
    assert.equal(sent.length, 1, JSON.stringify(picture));
  }
});

test("a new area after three resends sends once with the count back at zero, and its own stale frame resends again", async () => {
  const { b, cx, sent } = sized();
  b.area = { width: 361, height: 1228 };
  b.fit(cx);
  await drain(cx);
  b.feed.picture = staleAt({ width: 361, height: 1228 });
  const realNow = Date.now;
  let t = 0;
  const at = async (fn) => {
    t += 300;
    Date.now = () => realNow() + t;
    try { fn(); } finally { Date.now = realNow; }
    await drain(cx);
  };
  try {
    for (let i = 0; i < 4; i++) await at(() => b.fit(cx, false));
    assert.equal(sent.length, 4);
    assert.equal(b.sized.refits, 3);
    b.area = { width: 300, height: 700 };
    await at(() => b.fit(cx, false));
    assert.equal(sent.length, 5);
    assert.deepEqual(sent.at(-1), { action: "viewport", width: 300, height: 700, deviceScaleFactor: 0 });
    assert.equal(b.sized.refits, 0);
    b.feed.picture = staleAt({ width: 300, height: 700 });
    await at(() => b.fit(cx, false));
    assert.equal(sent.length, 6);
    assert.equal(b.sized.refits, 1);
  } finally {
    Date.now = realNow;
  }
});

const closes = () => calls.filter((c) => c.command === "agent-browser" && c.args.at(-1) === "close");
const agentBrowser = () => calls.filter((c) => c.command === "agent-browser");

function showing(b, target) {
  const feed = { phase: "live", connects: 1, frames: { keepAlive: async () => {} }, stopped: 0, stop: async () => { feed.stopped++; events.push("stop"); } };
  b.feed = feed;
  b.feedKey = `${targetKey(target)}|77|4321`;
  return feed;
}

async function until(check) {
  for (let i = 0; !check(); i++) {
    if (i > 200) throw new Error("timed out waiting");
    await new Promise((r) => setImmediate(r));
  }
}

function pending() {
  let release;
  const promise = new Promise((r) => { release = r; });
  return { promise, release };
}

const panelLayout = ({ hidden = false, active = "browser" } = {}) => ({
  id: "root", type: "row",
  children: [
    { id: "terminals", type: "block", content: { mod: "terminals" } },
    { id: "panel", type: "column", hidden, children: [{ id: "panel-body", type: "stack", active, children: [
      { id: "files", type: "block", content: { mod: "files" } },
      { id: "changes", type: "block", content: { mod: "changes" } },
      { id: "browser", type: "block", content: { mod: "browser" } },
    ] }] },
  ],
});
const OTHER = { address: "t7", machine: null, id: "t7", session: "herdr-t7", since: 1 };
const listed = (url = "https://agent.test/", session = "herdr-t6") => ({ session, namespace: null, pid: 77, port: null, engine: "chrome", url });
let shownLayout;

function hideWith(b, cx, hidden) {
  shownLayout = panelLayout();
  globalThis.host.layout = () => shownLayout;
  b.watch(cx);
  shownLayout = panelLayout(hidden);
  b.watch(cx);
}

function running(b, target = TARGET, url = "https://agent.test/") {
  sessions = [{ session: target.session, url }, { session: "herdr-t7", url: "https://other.test/" }];
  b.keep(machineKeyOf(target), { at: Date.now(), os: "Darwin", tools: { agentBrowser: true }, sessions: [listed(url, target.session), listed("https://other.test/", "herdr-t7")], error: null });
}
const machineKeyOf = (target) => target.machine ?? "";

for (const [how, hidden] of [["with the Browser button", { hidden: true }], ["by switching to Files", { active: "files" }], ["by switching to Changes", { active: "changes" }]]) {
  test(`hiding the panel ${how} stops the feed, then closes only the shown terminal's session, and holds no close for it`, async () => {
    const { b, cx } = panel("/home/me/shop");
    running(b);
    const feed = showing(b, TARGET);
    hideWith(b, cx, hidden);
    assert.equal(b.current().kind, "closing");
    await drain(cx);
    assert.deepEqual(events, ["stop", "close"]);
    assert.equal(feed.stopped, 1);
    assert.equal(b.feed, null);
    assert.deepEqual(agentBrowser().map((c) => [c.args, c.on]), [[["--session", "herdr-t6", "close"], null]]);
    assert.equal(b.closes.has(targetKey(TARGET)), false);
    assert.equal(b.current().kind, "start");
  });
}

function closeButtonHides() {
  globalThis.host.run = (name, args) => {
    commands.push([name, args]);
    if (name === "layout.hide" && args?.id === "panel") shownLayout = panelLayout({ hidden: true });
    return null;
  };
}

test("the X hides the side panel, and the hide then stops the feed and closes only the shown terminal's session", async () => {
  const { b, cx } = panel("/home/me/shop");
  running(b);
  const feed = showing(b, TARGET);
  shownLayout = panelLayout();
  globalThis.host.layout = () => shownLayout;
  closeButtonHides();
  b.watch(cx);
  b.closePanel(cx);
  assert.deepEqual(commands, [["layout.hide", { id: "panel" }]]);
  assert.equal(b.current().kind, "closing");
  await drain(cx);
  assert.deepEqual(events, ["stop", "close"]);
  assert.equal(feed.stopped, 1);
  assert.deepEqual(agentBrowser().map((c) => [c.args, c.on]), [[["--session", "herdr-t6", "close"], null]]);
  assert.equal(b.closes.has(targetKey(TARGET)), false);
});

test("showing the panel after the X auto-starts a fresh session at the whole address the page was at", async () => {
  const { b, cx } = panel("/home/me/shop");
  b.space = "s1";
  running(b);
  const feed = showing(b, TARGET);
  feed.url = "https://shop.test/cart?step=2#pay";
  shownLayout = panelLayout();
  globalThis.host.layout = () => shownLayout;
  closeButtonHides();
  b.watch(cx);
  b.closePanel(cx);
  await drain(cx);
  assert.equal(b.closes.has(targetKey(TARGET)), false);
  shownLayout = panelLayout();
  b.watch(cx);
  b.shownAt = Date.now();
  b.keep("", { at: Date.now(), os: "Darwin", tools: { agentBrowser: true }, sessions: [], error: null });
  b.settle(cx);
  await drain(cx);
  assert.deepEqual(opens(), [opening("https://shop.test/cart?step=2#pay")]);
  assert.equal(b.starts.get(targetKey(TARGET)).status, "started");
});

for (const [how, shape] of [["has no panel node", { id: "root", type: "row", children: [{ id: "side", type: "column", children: [{ id: "browser", type: "block", content: { mod: "browser" } }] }] }], ["has a panel node without the Browser block", { id: "root", type: "row", children: [{ id: "panel", type: "column", children: [{ id: "files", type: "block", content: { mod: "files" } }] }, { id: "browser", type: "block", content: { mod: "browser" } }] }], ["is not known", null]]) {
  test(`the X runs no command and closes nothing when the layout ${how}`, async () => {
    const { b, cx } = panel("/home/me/shop");
    running(b);
    showing(b, TARGET);
    globalThis.host.layout = () => shape;
    b.watch(cx);
    assert.doesNotThrow(() => b.closePanel(cx));
    await drain(cx);
    assert.deepEqual(commands, []);
    assert.deepEqual(agentBrowser(), []);
    assert.equal(b.current().kind, "running");
  });
}

for (const [how, answer, error] of [
  ["agent-browser refuses", async () => ({ code: 1, stdout: "", stderr: "daemon busy\n" }), "agent-browser close failed: daemon busy"],
  ["prints its failure only to stdout", async () => ({ code: 1, stdout: "no such session: herdr-t6\n", stderr: "" }), "agent-browser close failed: no such session: herdr-t6"],
  ["ends with no output", async () => ({ code: 3, stdout: "", stderr: "" }), "agent-browser close failed: exit 3"],
  ["cannot run", async () => { throw new Error("machine unreachable"); }, "agent-browser could not run on this computer: machine unreachable"],
]) {
  test(`a hide's close that ${how} shows its error on the next show, waits for Start browser, and Start starts again`, async () => {
    closeResult = answer;
    const { b, cx } = panel("/home/me/shop");
    running(b);
    hideWith(b, cx, { hidden: true });
    await drain(cx);
    assert.deepEqual(b.closes.get(targetKey(TARGET)), { status: "failed", error });
    sessions = [];
    shownLayout = panelLayout();
    b.watch(cx);
    b.shownAt = Date.now();
    b.keep("", { at: Date.now() + 1, os: "Darwin", tools: { agentBrowser: true }, sessions: [], error: null });
    b.settle(cx);
    await drain(cx);
    assert.equal(b.current().kind, "start");
    assert.equal(b.current().error, error);
    assert.deepEqual(opens(), []);
    b.start(TARGET, cx);
    await drain(cx);
    assert.equal(opens().length, 1);
    assert.equal(b.closes.has(targetKey(TARGET)), false);
  });
}

test("hiding the panel on a remote terminal closes its session on that machine", async () => {
  const { b, cx } = panel("/home/me/shop");
  b.target = REMOTE;
  running(b, REMOTE);
  const feed = showing(b, REMOTE);
  hideWith(b, cx, { hidden: true });
  await drain(cx);
  assert.equal(feed.stopped, 1);
  assert.deepEqual(closes().map((c) => [c.args, c.on]), [[["--session", "herdr-t6", "close"], "build_box"]]);
  assert.deepEqual(hcCalls, []);
  assert.equal(b.closes.has(targetKey(REMOTE)), false);
});

test("hiding the panel leaves a feed of another terminal running and does not close that terminal's session", async () => {
  const { b, cx } = panel("/home/me/shop");
  running(b);
  const feed = showing(b, OTHER);
  hideWith(b, cx, { hidden: true });
  await drain(cx);
  assert.equal(feed.stopped, 0);
  assert.deepEqual(closes().map((c) => c.args[1]), ["herdr-t6"]);
});

test("a copy whose block is hidden when it first looks, or stays shown, closes nothing", async () => {
  const { b, cx } = panel("/home/me/shop");
  running(b);
  shownLayout = panelLayout({ hidden: true });
  globalThis.host.layout = () => shownLayout;
  b.watch(cx);
  b.watch(cx);
  shownLayout = panelLayout();
  b.watch(cx);
  b.watch(cx);
  globalThis.host.layout = () => null;
  b.watch(cx);
  await drain(cx);
  assert.deepEqual(agentBrowser(), []);
});

test("hiding the panel when the scan lists no session for the terminal runs no agent-browser command", async () => {
  const { b, cx } = panel("/home/me/shop");
  hideWith(b, cx, { hidden: true });
  await drain(cx);
  assert.deepEqual(agentBrowser(), []);
  assert.equal(b.closes.has(targetKey(TARGET)), false);
});

test("hiding the panel for a terminal with no usable session name does nothing", async () => {
  const { b, cx } = panel("/home/me/shop");
  b.target = { address: "x/y/z", machine: "x", id: "y/z", session: null, since: 1 };
  hideWith(b, cx, { hidden: true });
  await drain(cx);
  assert.deepEqual(calls, []);
});

test("showing the panel again after a hide starts a fresh session, even one auto-started less than 30 seconds before", async () => {
  const { b, cx } = panel("/home/me/shop");
  b.settle(cx);
  await drain(cx);
  running(b);
  b.settle(cx);
  assert.ok(b.runs.has(targetKey(TARGET)));
  hideWith(b, cx, { hidden: true });
  await drain(cx);
  assert.equal(b.runs.has(targetKey(TARGET)), false);
  shownLayout = panelLayout();
  b.shownAt = Date.now();
  b.keep("", { at: Date.now(), os: "Darwin", tools: { agentBrowser: true }, sessions: [], error: null });
  b.settle(cx);
  await drain(cx);
  assert.equal(opens().length, 2);
  assert.equal(b.starts.get(targetKey(TARGET)).status, "started");
});

test("a hide while a local auto-start's open is pending closes the session once the open returns, enables no stream, and probes nothing after", async () => {
  const open = pending();
  openResult = open.promise;
  const { b, cx } = panel("/home/me/shop");
  b.settle(cx);
  await until(() => opens().length === 1);
  b.keep("", { at: Date.now(), os: "Darwin", tools: { agentBrowser: true }, sessions: [listed()], error: null });
  b.settle(cx);
  hideWith(b, cx, { hidden: true });
  assert.deepEqual(closes(), []);
  open.release({ code: 0, stdout: "", stderr: "" });
  await drain(cx);
  assert.deepEqual(agentBrowser().map((c) => [c.args, c.on]), [[["--session", "herdr-t6", "close"], null]]);
  assert.equal(calls.at(-1).args[1], DISCOVER);
  assert.equal(b.starts.has(targetKey(TARGET)), false);
  assert.equal(b.runs.has(targetKey(TARGET)), false);
  assert.equal(b.closes.has(targetKey(TARGET)), false);
  assert.equal(b.launches.has(targetKey(TARGET)), false);
  assert.equal(b.current().kind, "start");
  shownLayout = panelLayout();
  b.shownAt = 0;
  b.settle(cx);
  await drain(cx);
  assert.equal(opens().length, 2);
});

test("a hide while a remote start's open is pending closes the session on that machine once the open returns", async () => {
  const open = pending();
  const answer = await runResult();
  runResult = () => open.promise;
  const { b, cx } = panel("/home/me/shop");
  b.target = REMOTE;
  b.start(REMOTE, cx, true);
  await until(() => hcCalls.length === 1);
  hideWith(b, cx, { hidden: true });
  open.release(answer);
  await drain(cx);
  assert.deepEqual(hcCalls.map((args) => args[0]), ["run", "rm"]);
  assert.deepEqual(agentBrowser().map((c) => [c.args, c.on]), [[["--session", "herdr-t6", "close"], "build_box"]]);
  assert.equal(b.starts.has(targetKey(REMOTE)), false);
});

test("a hide while stream enable is pending closes the session after the stream call returns", async () => {
  const stream = pending();
  const exec = globalThis.host.exec;
  globalThis.host.exec = (command, args, options) => command === "agent-browser" && args.at(-1) === "enable" ? (calls.push({ command, args, on: options?.on ?? null }), events.push("enable"), stream.promise) : exec(command, args, options);
  const { b, cx } = panel("/home/me/shop");
  b.start(TARGET, cx, true);
  await until(() => streams().length === 1);
  hideWith(b, cx, { hidden: true });
  stream.release({ code: 0, stdout: "", stderr: "" });
  await drain(cx);
  assert.deepEqual(events, ["enable", "close"]);
  assert.equal(b.starts.has(targetKey(TARGET)), false);
  assert.equal(b.runs.has(targetKey(TARGET)), false);
});

function holdScan(n) {
  const scan = pending();
  const exec = globalThis.host.exec;
  let seen = 0;
  globalThis.host.exec = (command, args, options) => command === "sh" && args[1] === DISCOVER && ++seen === n ? (calls.push({ command, args, on: options?.on ?? null }), scan.promise.then(() => exec(command, args, options))) : exec(command, args, options);
  return { scan, held: () => seen >= n };
}

test("a hide while a remote start's final scan is pending closes the session on that machine once, and stores no start", async () => {
  const { scan, held } = holdScan(2);
  const { b, cx } = panel("/home/me/shop");
  b.target = REMOTE;
  b.start(REMOTE, cx, true);
  await until(held);
  sessions = [{ session: "herdr-t6", url: "https://agent.test/" }];
  const from = calls.length;
  hideWith(b, cx, { hidden: true });
  scan.release();
  await drain(cx);
  const after = calls.slice(from).filter((c) => c.command === "agent-browser");
  assert.deepEqual(after.map((c) => [c.args, c.on]), [[["--session", "herdr-t6", "close"], "build_box"]]);
  assert.equal(calls.at(-1).args[1], DISCOVER);
  assert.equal(b.starts.has(targetKey(REMOTE)), false);
  assert.equal(b.runs.has(targetKey(REMOTE)), false);
  assert.equal(b.launches.has(targetKey(REMOTE)), false);
  assert.equal(b.closes.has(targetKey(REMOTE)), false);
});

for (const [when, n] of [["its first scan", 1], ["its final scan", 2]]) {
  test(`a hide during ${when} of a start that finds the session already running closes it once, opens nothing, and stores no start`, async () => {
    sessions = [{ session: "herdr-t6", url: "https://agent.test/" }];
    const { scan, held } = holdScan(n);
    const { b, cx } = panel("/home/me/shop");
    b.start(TARGET, cx, true);
    await until(held);
    hideWith(b, cx, { hidden: true });
    scan.release();
    await drain(cx);
    assert.deepEqual(opens(), []);
    assert.deepEqual(agentBrowser().map((c) => [c.args, c.on]), [[["--session", "herdr-t6", "close"], null]]);
    assert.equal(b.starts.has(targetKey(TARGET)), false);
    assert.equal(b.runs.has(targetKey(TARGET)), false);
    assert.equal(b.launches.has(targetKey(TARGET)), false);
  });
}

test("a hide during a start whose open fails closes nothing and keeps the start's error", async () => {
  const open = pending();
  openResult = open.promise;
  const { b, cx } = panel("/home/me/shop");
  b.start(TARGET, cx, true);
  await until(() => opens().length === 1);
  hideWith(b, cx, { hidden: true });
  open.release({ code: 1, stdout: "", stderr: "Chrome failed to launch" });
  await drain(cx);
  assert.deepEqual(agentBrowser(), []);
  assert.deepEqual(b.starts.get(targetKey(TARGET)), { status: "failed", error: "Chrome failed to launch" });
});

test("a hide during a local start whose open fails closes the session the next scan lists, once, and stores no failed start", async () => {
  const open = pending();
  openResult = open.promise;
  const { b, cx } = panel("/home/me/shop");
  b.start(TARGET, cx, true);
  await until(() => opens().length === 1);
  hideWith(b, cx, { hidden: true });
  sessions = [{ session: "herdr-t6", url: "about:blank" }];
  open.release({ code: 1, stdout: "", stderr: "page load failed" });
  await drain(cx);
  assert.deepEqual(agentBrowser().map((c) => [c.args, c.on]), [[["--session", "herdr-t6", "close"], null]]);
  assert.equal(b.starts.has(targetKey(TARGET)), false);
  assert.equal(b.closes.has(targetKey(TARGET)), false);
  assert.equal(b.runs.has(targetKey(TARGET)), false);
  assert.equal(b.launches.has(targetKey(TARGET)), false);
});

test("a hide during a remote start whose open hits its wait limit closes the session the next scan lists, once, on that machine", async () => {
  const open = pending();
  runResult = () => open.promise;
  const { b, cx } = panel("/home/me/shop");
  b.target = REMOTE;
  b.start(REMOTE, cx, true);
  await until(() => hcCalls.length === 1);
  hideWith(b, cx, { hidden: true });
  sessions = [{ session: "herdr-t6", url: "about:blank" }];
  open.release({ code: 0, stderr: "", stdout: JSON.stringify({ address: "build_box/t1q", output: "", wait: { ended: false, exit_code: null, reason: "timeout", signal: null } }) });
  await drain(cx);
  assert.deepEqual(hcCalls.map((args) => args[0]), ["run", "kill", "rm"]);
  assert.deepEqual(agentBrowser().map((c) => [c.args, c.on]), [[["--session", "herdr-t6", "close"], "build_box"]]);
  assert.equal(b.starts.has(targetKey(REMOTE)), false);
  assert.equal(b.closes.has(targetKey(REMOTE)), false);
  assert.equal(b.launches.has(targetKey(REMOTE)), false);
});

test("a hide's close that fails after a pending start shows its error", async () => {
  const open = pending();
  openResult = open.promise;
  closeResult = async () => { throw new Error("machine unreachable"); };
  const { b, cx } = panel("/home/me/shop");
  b.start(TARGET, cx, true);
  await until(() => opens().length === 1);
  hideWith(b, cx, { hidden: true });
  open.release({ code: 0, stdout: "", stderr: "" });
  await drain(cx);
  assert.deepEqual(b.closes.get(targetKey(TARGET)), { status: "failed", error: "agent-browser could not run on this computer: machine unreachable" });
  assert.equal(b.starts.has(targetKey(TARGET)), false);
});

function holdDetect() {
  const detect = pending();
  const exec = globalThis.host.exec;
  let seen = false;
  globalThis.host.exec = (command, args, options) => command === "sh" && args[1] === DETECT && !seen ? (seen = true, detect.promise.then(() => exec(command, args, options))) : exec(command, args, options);
  return { detect, held: () => seen };
}

for (const [when, hold] of [["its address detection", () => { const { detect, held } = holdDetect(); return { release: detect.release, held }; }], ["its first scan", () => { const { scan, held } = holdScan(1); return { release: scan.release, held }; }]]) {
  test(`a hide during ${when} of a start with no session opens nothing, closes nothing, and stores no start`, async () => {
    const { release, held } = hold();
    const { b, cx } = panel("/home/me/shop");
    b.start(TARGET, cx, true);
    await until(held);
    hideWith(b, cx, { hidden: true });
    release();
    await drain(cx);
    assert.deepEqual(opens(), []);
    assert.deepEqual(agentBrowser(), []);
    assert.equal(b.closes.has(targetKey(TARGET)), false);
    assert.equal(b.starts.has(targetKey(TARGET)), false);
    assert.equal(b.launches.has(targetKey(TARGET)), false);
  });
}

test("a hide during address detection of a start whose session is already running closes it once and opens nothing", async () => {
  sessions = [{ session: "herdr-t6", url: "https://agent.test/" }];
  const { detect, held } = holdDetect();
  const { b, cx } = panel("/home/me/shop");
  b.start(TARGET, cx, true);
  await until(held);
  hideWith(b, cx, { hidden: true });
  detect.release();
  await drain(cx);
  assert.deepEqual(opens(), []);
  assert.deepEqual(agentBrowser().map((c) => c.args), [["--session", "herdr-t6", "close"]]);
  assert.equal(b.starts.has(targetKey(TARGET)), false);
});

test("the address the page was at when the panel hid is kept whole for the terminal's space, query and fragment included", async () => {
  const { b, cx } = panel("/home/me/shop");
  b.space = "s1";
  running(b);
  const feed = showing(b, TARGET);
  feed.url = "https://shop.test/cart?token=abc#pay";
  hideWith(b, cx, { hidden: true });
  await drain(cx);
  const memory = JSON.parse(stored.get("hiddenUrls"));
  assert.deepEqual(Object.keys(memory), ["|space:s1"]);
  assert.equal(memory["|space:s1"].url, "https://shop.test/cart?token=abc#pay");
});

test("with no feed, the hide keeps the scanned address whole, under the session's folder when no space is known", async () => {
  const { b, cx } = panel("/home/me/b");
  b.sessionFolders.set(targetKey(TARGET), "/home/me/a");
  running(b, TARGET, "https://shop.test/orders?page=2");
  hideWith(b, cx, { hidden: true });
  await drain(cx);
  const memory = JSON.parse(stored.get("hiddenUrls"));
  assert.deepEqual(Object.keys(memory), ["|/home/me/a"]);
  assert.equal(memory["|/home/me/a"].url, "https://shop.test/orders?page=2");
});

test("a hide with no address known, or none it may open, keeps nothing", async () => {
  for (const url of [null, "about:blank", "https://me:secret@shop.test/"]) {
    stored.delete("hiddenUrls");
    const { b, cx } = panel("/home/me/shop");
    b.space = "s1";
    running(b, TARGET, url);
    hideWith(b, cx, { hidden: true });
    await drain(cx);
    assert.equal(stored.has("hiddenUrls"), false, String(url));
  }
});

test("the folder memory still strips query and fragment while the hidden address keeps them", async () => {
  const { b, cx } = panel("/home/me/shop");
  b.space = "s1";
  running(b, TARGET, "https://shop.test/cart?token=abc#pay");
  b.settle(cx);
  hideWith(b, cx, { hidden: true });
  await drain(cx);
  assert.equal(JSON.parse(stored.get("lastUrls"))["|/home/me/shop"].url, "https://shop.test/cart");
  assert.equal(JSON.parse(stored.get("hiddenUrls"))["|space:s1"].url, "https://shop.test/cart?token=abc#pay");
});

test("the next start in that space opens the hidden address ahead of a listening server, also after a restart", async () => {
  stored.set("hiddenUrls", JSON.stringify({ "|space:s1": { url: "https://shop.test/cart?step=2#pay", at: 1 } }));
  const { b, cx } = panel("/home/me/shop");
  b.space = "s1";
  b.start(TARGET, cx);
  await drain(cx);
  assert.deepEqual(opens(), [opening("https://shop.test/cart?step=2#pay")]);
});

test("a start in another space, or one the terminal is not shown for, opens the listening server", async () => {
  stored.set("hiddenUrls", JSON.stringify({ "|space:s1": { url: "https://shop.test/cart", at: 1 } }));
  const { b, cx } = panel("/home/me/shop");
  b.space = "s2";
  b.start(TARGET, cx);
  await drain(cx);
  b.space = "s1";
  b.start({ ...OTHER }, cx);
  await drain(cx);
  assert.deepEqual(opens().map((args) => [args[4], args.at(-1)]), [["herdr-t6", "http://127.0.0.1:3000/"], ["herdr-t7", "about:blank"]]);
});

test("a start with no space known opens the address hidden in the terminal's folder", async () => {
  stored.set("hiddenUrls", JSON.stringify({ "|/home/me/shop": { url: "https://shop.test/cart", at: 1 } }));
  const { b, cx } = panel("/home/me/shop");
  b.start(TARGET, cx);
  await drain(cx);
  assert.deepEqual(opens(), [opening("https://shop.test/cart")]);
});

function ticking(folder) {
  const ticks = [];
  const cx = { tasks: [], notify() {}, focus_handle: () => ({ is_focused: () => false }), timer: { every: (ms, fn) => ticks.push(fn), after() {} }, spawn(body) { const p = body(cx); cx.tasks.push(p); return p; } };
  const b = new Browser();
  b.init({}, cx);
  cx.tasks.length = 0;
  b.target = TARGET;
  b.folder = folder;
  b.shownAt = 0;
  return { b, cx, tick: () => ticks[0](cx) };
}

test("the scan timer catches a hide on its own, with no render, and only the panel's block hiding closes the session", async () => {
  const { b, cx, tick } = ticking("/home/me/shop");
  running(b);
  shownLayout = panelLayout();
  globalThis.host.layout = () => shownLayout;
  visible = false;
  tick();
  await drain(cx);
  assert.deepEqual(closes(), []);
  visible = true;
  tick();
  shownLayout = panelLayout({ hidden: true });
  tick();
  await drain(cx);
  assert.deepEqual(closes().map((c) => c.args[1]), ["herdr-t6"]);
});

test("render notices a hide too, and reads the terminal's space for the address it keeps", async () => {
  const { b, cx } = panel("/home/me/shop");
  Object.assign(globalThis.host, {
    focused: () => ({ space: "s1", tab: "a1", pane: "p1", terminal: "t6", cwd: "/home/me/shop" }),
    spaces: () => [{ id: "s1", machine: null, tabs: [{ id: "a1" }] }],
    panes: () => [{ pane: "p1", terminal: "t6", tab: "a1", cwd: "/home/me/shop" }],
    theme: () => ({}),
  });
  running(b);
  shownLayout = panelLayout();
  globalThis.host.layout = () => shownLayout;
  b.render(cx);
  assert.equal(b.space, "s1");
  await drain(cx);
  calls = [];
  running(b);
  shownLayout = panelLayout({ active: "files" });
  b.render(cx);
  await drain(cx);
  assert.deepEqual(closes().map((c) => c.args[1]), ["herdr-t6"]);
  assert.equal(JSON.parse(stored.get("hiddenUrls"))["|space:s1"].url, "https://agent.test/");
});

const terminalList = (addresses, machines = [], finished = []) => () => ({ code: 0, stderr: "", stdout: JSON.stringify({ hidden_finished: 0, machines, terminals: [...addresses.map((address) => ({ address, state: "live" })), ...finished.map((address) => ({ address, state: "finished", reason: "killed", rm: false }))] }) });
const closedNames = () => closes().map((c) => `${c.on ?? ""}:${c.args[1]}`);
const discoveries = () => calls.filter((c) => c.command === "sh" && c.args[1] === DISCOVER);

function closesByName() {
  closeResult = async (args, options) => {
    const on = options?.on;
    const drop = (list) => list.filter((s) => s.session !== args[1] || s.dir);
    if (on) remoteSessions[on] = drop(remoteSessions[on] ?? []);
    else sessions = drop(sessions);
    return { code: 0, stdout: "✓ Browser closed", stderr: "" };
  };
}

async function reaped(b, cx, times = 1) {
  for (let i = 0; i < times; i++) {
    b.reap(cx);
    await drain(cx);
  }
}

async function reaper(addresses, machines) {
  const { b, cx } = panel("/home/me/shop");
  closesByName();
  listing = terminalList(addresses, machines);
  await reaped(b, cx, 2);
  return { b, cx };
}

test("a terminal that closes while the panel is hidden gets its local session closed, and nothing else", async () => {
  visible = false;
  sessions = [{ session: "herdr-t6" }, { session: "herdr-t9" }, { session: "notes" }, { session: "herdr-t9", dir: "/tmp/agent-browser/namespaces/qa/run" }];
  const { b, cx } = await reaper(["t6", "t9"]);
  assert.deepEqual(closedNames(), []);
  listing = terminalList(["t6"], [], ["t9"]);
  await reaped(b, cx);
  assert.deepEqual(closedNames(), []);
  await reaped(b, cx);
  assert.deepEqual(closedNames(), [":herdr-t9"]);
  assert.deepEqual(sessions.map((s) => s.session), ["herdr-t6", "notes", "herdr-t9"]);
  await reaped(b, cx);
  assert.deepEqual(closedNames(), [":herdr-t9"]);
});

test("a remote terminal that closes gets its herdr-<id> session closed on its own machine", async () => {
  remoteSessions.build_box = [{ session: "herdr-t8" }, { session: "herdr-t2" }];
  sessions = [{ session: "herdr-t8" }];
  globalThis.host.machines = () => [{ name: null, layout: "ready" }, { name: "build_box", layout: "ready" }];
  const box = [{ name: "build_box", state: "connected" }];
  const { b, cx } = await reaper(["t8", "build_box/t8", "build_box/t2"], box);
  listing = terminalList(["t8", "build_box/t2"], box, ["build_box/t8"]);
  await reaped(b, cx);
  assert.deepEqual(closedNames(), []);
  await reaped(b, cx);
  assert.deepEqual(closedNames(), ["build_box:herdr-t8"]);
  assert.deepEqual(remoteSessions.build_box.map((s) => s.session), ["herdr-t2"]);
});

test("a closed workspace ends the session of each of its terminals", async () => {
  sessions = [{ session: "herdr-t1" }, { session: "herdr-t2" }, { session: "herdr-t3" }];
  const { b, cx } = await reaper(["t1", "t2", "t3"]);
  listing = terminalList(["t1"], [], ["t2", "t3"]);
  await reaped(b, cx, 2);
  assert.deepEqual(closedNames().sort(), [":herdr-t2", ":herdr-t3"]);
});

test("on start the panel ends herdr-<id> sessions whose terminal does not exist, and leaves other names alone", async () => {
  sessions = [{ session: "herdr-t3" }, { session: "herdr-t6" }, { session: "notes" }, { session: "herdr-" }, { session: "herdr-t3", dir: "/tmp/agent-browser/namespaces/qa/run" }];
  const { b, cx } = panel("/home/me/shop");
  closesByName();
  listing = terminalList(["t6"]);
  await reaped(b, cx);
  assert.deepEqual(discoveries(), []);
  await reaped(b, cx);
  assert.deepEqual(closedNames(), [":herdr-t3"]);
  await reaped(b, cx);
  assert.deepEqual(closedNames(), [":herdr-t3"]);
});

test("a finished terminal counts as gone, so its session closes on the sweep that follows", async () => {
  sessions = [{ session: "herdr-t4" }, { session: "herdr-t6" }];
  await reaper(["t6"], [], ["t4"]);
  assert.deepEqual(hcCalls.filter((a) => a[0] === "ls").at(-1), ["ls", "--all", "--json"]);
  assert.deepEqual(closedNames(), [":herdr-t4"]);
});

test("a terminal that shows as finished on one look and live on the next keeps its session", async () => {
  sessions = [{ session: "herdr-t6" }, { session: "herdr-t9" }];
  const { b, cx } = await reaper(["t6", "t9"]);
  listing = terminalList(["t6"], [], ["t9"]);
  await reaped(b, cx);
  listing = terminalList(["t6", "t9"]);
  await reaped(b, cx, 2);
  assert.deepEqual(closedNames(), []);
});

test("a sweep for one gone terminal keeps a session whose terminal is gone on only one look", async () => {
  sessions = [{ session: "herdr-t2" }, { session: "herdr-t6" }, { session: "herdr-t9" }];
  const { b, cx } = await reaper(["t2", "t6", "t9"]);
  listing = terminalList(["t6", "t9"], [], ["t2"]);
  await reaped(b, cx);
  listing = terminalList(["t6"], [], ["t2", "t9"]);
  await reaped(b, cx);
  assert.deepEqual(closedNames(), [":herdr-t2"]);
  await reaped(b, cx);
  assert.deepEqual(closedNames(), [":herdr-t2", ":herdr-t9"]);
});

test("a sweep whose machine has no record of its last looks closes nothing", async () => {
  sessions = [{ session: "herdr-t3" }];
  const { b, cx } = panel("/home/me/shop");
  closesByName();
  listing = terminalList(["t6"]);
  b.sweepMachine("", cx);
  await drain(cx);
  assert.equal(discoveries().length, 1);
  assert.deepEqual(closedNames(), []);
});

test("a pane that shows a finished terminal blocks its machine's sweep", async () => {
  sessions = [{ session: "herdr-t3" }];
  globalThis.host.spaces = () => [{ id: "s1", machine: null, tabs: [{ id: "a1" }] }];
  globalThis.host.panes = () => [{ pane: "p1", terminal: "t5", tab: "a1" }];
  await reaper(["t6"], [], ["t5"]);
  assert.deepEqual(discoveries(), []);
  assert.deepEqual(closedNames(), []);
});

test("the scan timer closes a stale session while the panel is hidden", async () => {
  visible = false;
  sessions = [{ session: "herdr-t6" }, { session: "herdr-t9" }];
  const { cx, tick } = ticking("/home/me/shop");
  closesByName();
  listing = terminalList(["t6"]);
  tick();
  await drain(cx);
  assert.deepEqual(closedNames(), []);
  tick();
  await drain(cx);
  assert.deepEqual(closedNames(), [":herdr-t9"]);
});

test("a reap asked for while one is listing waits, and the next reap lists again", async () => {
  const { b, cx } = panel("/home/me/shop");
  let release;
  listing = () => new Promise((resolve) => { release = () => resolve(terminalList(["t6"])()); });
  const lists = () => hcCalls.filter((a) => a[0] === "ls").length;
  b.reap(cx);
  b.reap(cx);
  await Promise.resolve();
  assert.equal(lists(), 1);
  assert.equal(b.reaping, true);
  release();
  await drain(cx);
  assert.equal(b.reaping, false);
  listing = terminalList(["t6"]);
  b.reap(cx);
  assert.equal(lists(), 2);
  await drain(cx);
});

test("nothing closes while a machine's layout is still loading or unavailable", async () => {
  sessions = [{ session: "herdr-t3" }];
  for (const layout of ["loading", "unavailable"]) {
    globalThis.host.machines = () => [{ name: null, layout }];
    const { b, cx } = await reaper(["t6"]);
    await reaped(b, cx, 2);
    assert.deepEqual(discoveries(), []);
  }
  assert.deepEqual(closedNames(), []);
});

test("a remote machine that is disconnected, not listed, or not in Herdr's machines is never swept", async () => {
  remoteSessions.build_box = [{ session: "herdr-t3" }];
  globalThis.host.machines = () => [{ name: null, layout: "ready" }, { name: "build_box", layout: "ready" }];
  for (const machines of [[{ name: "build_box", state: "disconnected" }], []]) {
    const { b, cx } = await reaper(["build_box/t6"], machines);
    await reaped(b, cx, 2);
  }
  globalThis.host.machines = () => [{ name: null, layout: "ready" }];
  const { b, cx } = await reaper(["build_box/t6"], [{ name: "build_box", state: "connected" }]);
  await reaped(b, cx, 2);
  assert.deepEqual(discoveries().filter((c) => c.on === "build_box"), []);
  assert.deepEqual(closedNames(), []);
});

test("a remote machine that drops out of the list does not have its sessions closed, and is swept once it is back", async () => {
  remoteSessions.build_box = [{ session: "herdr-t6" }, { session: "herdr-t7" }];
  globalThis.host.machines = () => [{ name: null, layout: "ready" }, { name: "build_box", layout: "ready" }];
  const box = [{ name: "build_box", state: "connected" }];
  const { b, cx } = await reaper(["build_box/t6", "build_box/t7"], box);
  listing = terminalList([], [{ name: "build_box", state: "connecting" }]);
  await reaped(b, cx, 2);
  assert.deepEqual(closedNames(), []);
  listing = terminalList(["build_box/t6"], box);
  await reaped(b, cx);
  assert.deepEqual(closedNames(), []);
  await reaped(b, cx);
  assert.deepEqual(closedNames(), ["build_box:herdr-t7"]);
});

test("nothing closes when the terminal list fails, cannot be read, or holds an entry with no address", async () => {
  sessions = [{ session: "herdr-t3" }];
  for (const bad of [
    () => ({ code: 1, stdout: "", stderr: "core down" }),
    () => ({ code: 0, stdout: "not json", stderr: "" }),
    () => ({ code: 0, stdout: JSON.stringify({ machines: [] }), stderr: "" }),
    () => ({ code: 0, stdout: JSON.stringify({ machines: [], terminals: [{ state: "live" }] }), stderr: "" }),
    async () => { throw new Error("no hc"); },
  ]) {
    const { b, cx } = panel("/home/me/shop");
    listing = bad;
    await reaped(b, cx, 3);
  }
  assert.deepEqual(discoveries(), []);
  assert.deepEqual(closedNames(), []);
});

test("nothing closes on a machine while a pane shows a terminal the list lacks", async () => {
  sessions = [{ session: "herdr-t3" }];
  globalThis.host.spaces = () => [{ id: "s1", machine: null, tabs: [{ id: "a1" }] }];
  globalThis.host.panes = () => [{ pane: "p1", terminal: "t5", tab: "a1" }, { pane: "p2", terminal: null, tab: "a1", mod: "files" }];
  const { b, cx } = await reaper(["t6"]);
  await reaped(b, cx);
  assert.deepEqual(closedNames(), []);
  globalThis.host.panes = () => [{ pane: "p1", terminal: "t5", tab: "a9" }];
  listing = terminalList(["t5"]);
  await reaped(b, cx, 2);
  assert.deepEqual(discoveries(), []);
  globalThis.host.panes = () => [{ pane: "p1", terminal: "t5", tab: "a1" }];
  await reaped(b, cx, 2);
  assert.deepEqual(closedNames(), [":herdr-t3"]);
});

test("a remote pane that the list lacks blocks only its own machine", async () => {
  sessions = [{ session: "herdr-t3" }];
  remoteSessions.build_box = [{ session: "herdr-t3" }];
  globalThis.host.machines = () => [{ name: null, layout: "ready" }, { name: "build_box", layout: "ready" }];
  globalThis.host.spaces = () => [{ id: "build_box/s1", machine: "build_box", tabs: [{ id: "build_box/a1" }] }];
  globalThis.host.panes = () => [{ pane: "build_box/p1", terminal: "t9", tab: "build_box/a1" }, { pane: "build_box/p2", terminal: "build_box/t8", tab: "build_box/a1" }];
  await reaper(["t6", "build_box/t9"], [{ name: "build_box", state: "connected" }]);
  assert.deepEqual(closedNames(), [":herdr-t3"]);
});

test("a sweep whose discovery fails closes nothing, and tries again on the next tick", async () => {
  sessions = [{ session: "herdr-t3" }];
  const { b, cx } = panel("/home/me/shop");
  closesByName();
  listing = terminalList(["t6"]);
  const exec = globalThis.host.exec;
  globalThis.host.exec = async (command, args, options) => {
    if (command === "sh" && args[1] === DISCOVER) throw new Error("machine unreachable");
    return exec(command, args, options);
  };
  await reaped(b, cx, 3);
  assert.deepEqual(closedNames(), []);
  globalThis.host.exec = exec;
  await reaped(b, cx);
  assert.deepEqual(closedNames(), [":herdr-t3"]);
});

test("a sweep keeps a session whose terminal appears between its look and its recheck", async () => {
  const { b, cx } = await reaper(["t1", "t2"]);
  sessions = [{ session: "herdr-t6" }];
  let lists = 0;
  listing = () => terminalList(lists++ < 2 ? ["t1"] : ["t1", "t6"])();
  await reaped(b, cx, 2);
  assert.equal(discoveries().length, 2);
  assert.deepEqual(closedNames(), []);
});

test("a recheck that finds the machine incomplete closes nothing, and the sweep runs again", async () => {
  sessions = [{ session: "herdr-t3" }];
  const { b, cx } = panel("/home/me/shop");
  closesByName();
  let lists = 0;
  listing = () => (lists++ === 2 ? { code: 1, stdout: "", stderr: "busy" } : terminalList(["t6"])());
  await reaped(b, cx, 2);
  assert.deepEqual(closedNames(), []);
  await reaped(b, cx);
  assert.deepEqual(closedNames(), [":herdr-t3"]);
});

test("a failed close is tried again on the next tick", async () => {
  sessions = [{ session: "herdr-t3" }];
  const { b, cx } = panel("/home/me/shop");
  listing = terminalList(["t6"]);
  closeResult = async () => ({ code: 1, stdout: "", stderr: "daemon busy" });
  await reaped(b, cx, 2);
  assert.equal(closes().length, 1);
  closesByName();
  await reaped(b, cx);
  assert.equal(closes().length, 2);
  assert.deepEqual(sessions, []);
  await reaped(b, cx);
  assert.equal(closes().length, 2);
});

test("a sweep asked for while one runs on that machine waits for the next tick", async () => {
  const { b, cx } = panel("/home/me/shop");
  b.known = new Map([["", { ids: new Set(), held: new Set(), swept: true }]]);
  b.sweeping.add("");
  b.sweepMachine("", cx);
  assert.equal(b.known.get("").swept, false);
  assert.deepEqual(discoveries(), []);
});

test("the shown terminal's stream stops before its session is closed, and it is not started again", async () => {
  sessions = [{ session: "herdr-t6" }];
  const { b, cx } = await reaper(["t6"]);
  b.feedKey = `${targetKey(TARGET)}|77|9`;
  b.feed = { stop: async () => { events.push("stop"); } };
  listing = terminalList([], [], ["t6"]);
  await reaped(b, cx, 2);
  assert.deepEqual(events, ["stop", "close"]);
  assert.equal(b.feed, null);
  b.keep("", { at: Date.now(), os: "Darwin", tools: { agentBrowser: true }, sessions: [], error: null });
  b.settle(cx);
  await drain(cx);
  assert.deepEqual(opens(), []);
});

test("a remote terminal's shown stream, keyed by its bare address, stops before its session is closed", async () => {
  remoteSessions.build_box = [{ session: "herdr-t6" }];
  globalThis.host.machines = () => [{ name: null, layout: "ready" }, { name: "build_box", layout: "ready" }];
  const box = [{ name: "build_box", state: "connected" }];
  const { b, cx } = await reaper(["build_box/t6"], box);
  b.feedKey = `${targetKey({ machine: "build_box", address: "t6" })}|77|9`;
  b.feed = { stop: async () => { events.push("stop"); } };
  listing = terminalList([], box, ["build_box/t6"]);
  await reaped(b, cx, 2);
  assert.deepEqual(events, ["stop", "close"]);
  assert.equal(b.feed, null);
  assert.deepEqual(closedNames(), ["build_box:herdr-t6"]);
});

test("a terminal id that shows up again may start its session again", async () => {
  sessions = [{ session: "herdr-t6" }];
  const { b, cx } = await reaper(["t6"]);
  listing = terminalList([], [], ["t6"]);
  await reaped(b, cx, 2);
  assert.ok(b.gone.has("|t6"));
  listing = terminalList(["t6"]);
  await reaped(b, cx);
  assert.equal(b.gone.has("|t6"), false);
  b.keep("", { at: Date.now(), os: "Darwin", tools: { agentBrowser: true }, sessions: [], error: null });
  b.settle(cx);
  await drain(cx);
  assert.equal(opens().length, 1);
});

test("a session whose start is still running is left to that start, which then closes it", async () => {
  const { b } = panel("/home/me/shop");
  const launch = { end: null, closing: false };
  b.launches.set("build_box|build_box/t6", launch);
  assert.deepEqual(await b.endOrphan("build_box", "herdr-t6"), { status: "closed" });
  assert.equal(launch.end, "hidden");
  const bare = { end: "hidden", closing: true };
  b.launches.set("build_box|t7", bare);
  await b.endOrphan("build_box", "herdr-t7");
  assert.equal(bare.end, "hidden");
  assert.deepEqual(closes(), []);
});
