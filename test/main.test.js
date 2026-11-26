import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const stubs = {
  "gpui-kit": "export class View {} export const div = () => null; export const image = () => null; export const svg = () => null;",
  "gpui-base": "export const v_flex = () => null; export const h_flex = () => null; export const Input = { new: () => null }; export const InputState = { new: () => { let v = ''; const handlers = {}; const s = { handlers, range: null, focused: false, on(name, h) { handlers[name] = h; }, value: () => v, set_value(x) { v = x; }, set_selected_range(r) { s.range = r; }, focus() { if (s.focused) return; s.focused = true; handlers.focus?.({}, { notify() {} }); }, blur() { if (!s.focused) return; s.focused = false; handlers.blur?.({}, { notify() {} }); } }; return s; } };",
  herdr: ["exec", "focused", "spaces", "panes", "theme", "window", "layout", "checking", "settings", "hc", "appHome", "readTextFile", "watchFolder"]
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
let calls, sessions, visible, stored, openResult, detectFails, hcCalls, runResult, closeResult, events;

function discovery() {
  return ['{"os":"Darwin","agentBrowser":true}', ...sessions.map((s) => JSON.stringify({ session: s.session, dir: "/tmp/agent-browser", pid: 77, port: 0, engine: "chrome", target: { url: s.url } }))].join("\n");
}

beforeEach(() => {
  calls = [];
  sessions = [];
  visible = true;
  openResult = { code: 0, stdout: "", stderr: "" };
  detectFails = false;
  hcCalls = [];
  events = [];
  closeResult = async () => { sessions = []; return { code: 0, stdout: "✓ Browser closed", stderr: "" }; };
  runResult = async () => ({ code: 0, stderr: "", stdout: JSON.stringify({ address: "build_box/t1q", output: "", state: "live", wait: { ended: true, exit_code: 0, reason: "exit", signal: null } }) });
  stored = new Map();
  globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)) };
  globalThis.host = {
    checking: () => false,
    window: () => ({ visible }),
    settings: () => ({ zoom: 1 }),
    layout: () => null,
    exec: async (command, args, options) => {
      calls.push({ command, args, on: options?.on ?? null });
      if (command === "sh" && args[1] === DISCOVER) return { code: 0, stdout: discovery(), stderr: "" };
      if (command === "sh" && args[1] === DETECT) {
        if (detectFails) throw new Error("machine unreachable");
        return { code: 0, stderr: "", stdout: ["home\t/home/me", `folder\t${args[3]}`, "lsof\tp9", "lsof\tf3", "lsof\tn*:3000", "lsofcwd\tp9", "lsofcwd\tfcwd", `lsofcwd\tn${args[3]}`].join("\n") };
      }
      if (command === "env" && args.includes("open")) return openResult;
      if (command === "agent-browser" && args.at(-1) === "close") {
        events.push("close");
        return closeResult();
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    hc: async (args) => {
      hcCalls.push(args);
      if (args[0] === "run") return runResult(args);
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

test("closing a session stops its feed, then runs agent-browser close for it, and shows Closing until that ends", async () => {
  sessions = [{ session: "herdr-t6", url: "https://agent.test/" }];
  const { b, cx } = panel("/home/me/shop");
  const feed = showing(b, TARGET);
  assert.equal(b.current().kind, "running");
  b.end(TARGET, cx);
  assert.equal(b.current().kind, "closing");
  b.end(TARGET, cx);
  await drain(cx);
  assert.deepEqual(events, ["stop", "close"]);
  assert.equal(feed.stopped, 1);
  assert.equal(b.feed, null);
  assert.deepEqual(closes().map((c) => [c.args, c.on]), [[["--session", "herdr-t6", "close"], null]]);
  assert.deepEqual(b.closes.get(targetKey(TARGET)), { status: "closed" });
});

test("a closed session shows Start and is neither restarted nor probed again", async () => {
  sessions = [{ session: "herdr-t6", url: "https://agent.test/" }];
  const { b, cx } = panel("/home/me/shop");
  showing(b, TARGET);
  b.end(TARGET, cx);
  await drain(cx);
  for (let i = 0; i < 3; i++) {
    b.keep("", { at: Date.now() + i, os: "Darwin", tools: { agentBrowser: true }, sessions: [], error: null });
    b.settle(cx);
    b.sync(b.current(), true, cx);
    await drain(cx);
  }
  const state = b.current();
  assert.equal(state.kind, "start");
  assert.equal(state.closed, true);
  assert.equal(state.error, null);
  assert.deepEqual(opens(), []);
  assert.equal(b.feed, null);
  assert.deepEqual(agentBrowser().map((c) => c.args), [["--session", "herdr-t6", "close"]]);
});

test("closing a remote session runs the close on that machine and stops its feed, which closes the tunnel", async () => {
  sessions = [{ session: "herdr-t6", url: "https://agent.test/" }];
  const { b, cx } = panel("/home/me/shop");
  b.target = REMOTE;
  const feed = showing(b, REMOTE);
  b.end(REMOTE, cx);
  await drain(cx);
  assert.equal(feed.stopped, 1);
  assert.deepEqual(closes().map((c) => [c.args, c.on]), [[["--session", "herdr-t6", "close"], "build_box"]]);
  assert.deepEqual(hcCalls, []);
  assert.equal(b.current().kind, "start");
  assert.equal(b.current().closed, true);
});

test("closing a session leaves a feed that belongs to another terminal running", async () => {
  const { b, cx } = panel("/home/me/shop");
  const other = { address: "t7", machine: null, id: "t7", session: "herdr-t7", since: 1 };
  const feed = showing(b, other);
  b.end(TARGET, cx);
  await drain(cx);
  assert.equal(feed.stopped, 0);
  assert.equal(b.feed, feed);
  assert.equal(closes().length, 1);
});

test("a close that agent-browser refuses shows its error over the still-running session, and starts nothing", async () => {
  sessions = [{ session: "herdr-t6", url: "https://agent.test/" }];
  closeResult = async () => ({ code: 1, stdout: "", stderr: "daemon busy\n" });
  const { b, cx } = panel("/home/me/shop");
  showing(b, TARGET);
  b.end(TARGET, cx);
  await drain(cx);
  const state = b.current();
  assert.equal(state.kind, "running");
  assert.equal(state.error, "agent-browser close failed: daemon busy");
  sessions = [];
  b.keep("", { at: Date.now() + 1, os: "Darwin", tools: { agentBrowser: true }, sessions: [], error: null });
  b.settle(cx);
  await drain(cx);
  assert.equal(b.current().kind, "start");
  assert.equal(b.current().error, "agent-browser close failed: daemon busy");
  assert.deepEqual(opens(), []);
});

test("a close that cannot run names the machine and the reason", async () => {
  closeResult = async () => { throw new Error("machine unreachable"); };
  const { b, cx } = panel("/home/me/shop");
  b.end(TARGET, cx);
  await drain(cx);
  assert.deepEqual(b.closes.get(targetKey(TARGET)), { status: "failed", error: "agent-browser could not run on this computer: machine unreachable" });
  assert.equal(b.current().error, "agent-browser could not run on this computer: machine unreachable");
});

test("a close with no output reports its exit code", async () => {
  closeResult = async () => ({ code: 3, stdout: "", stderr: "" });
  const { b, cx } = panel("/home/me/shop");
  b.end(TARGET, cx);
  await drain(cx);
  assert.equal(b.current().error, "agent-browser close failed: exit 3");
});

test("Start after a close starts the session again and lets it auto-start once more", async () => {
  sessions = [{ session: "herdr-t6", url: "https://agent.test/" }];
  const { b, cx } = panel("/home/me/shop");
  b.end(TARGET, cx);
  await drain(cx);
  b.start(TARGET, cx);
  await drain(cx);
  assert.equal(opens().length, 1);
  assert.equal(b.closes.has(targetKey(TARGET)), false);
  b.keep("", { at: Date.now(), os: "Darwin", tools: { agentBrowser: true }, sessions: [{ session: "herdr-t6", namespace: null, pid: 77, port: null, engine: "chrome", url: "https://agent.test/" }], error: null });
  b.settle(cx);
  assert.equal(b.current().kind, "running");
  b.keep("", { at: Date.now() + 1, os: "Darwin", tools: { agentBrowser: true }, sessions: [], error: null });
  b.settle(cx);
  await drain(cx);
  assert.equal(opens().length, 2);
});

test("a close that prints its failure only to stdout shows that text", async () => {
  closeResult = async () => ({ code: 1, stdout: "no such session: herdr-t6\n", stderr: "" });
  const { b, cx } = panel("/home/me/shop");
  b.end(TARGET, cx);
  await drain(cx);
  assert.equal(b.current().error, "agent-browser close failed: no such session: herdr-t6");
});

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

async function closeWhileStarting(b, cx, target, started) {
  await until(started.check);
  b.target = target;
  b.keep(target.machine ?? "", { at: Date.now(), os: "Darwin", tools: { agentBrowser: true }, sessions: [{ session: "herdr-t6", namespace: null, pid: 77, port: null, engine: "chrome", url: "https://agent.test/" }], error: null });
  sessions = [{ session: "herdr-t6", url: "https://agent.test/" }];
  b.settle(cx);
  assert.equal(b.current().kind, "running");
  assert.equal(b.starts.has(targetKey(target)), false);
  b.end(target, cx);
  await cx.tasks.at(-1);
  assert.deepEqual(b.closes.get(targetKey(target)), { status: "closed" });
  started.release();
  await drain(cx);
  const state = b.current();
  assert.equal(state.kind, "start");
  assert.equal(state.closed, true);
  assert.equal(state.error, null);
  assert.equal(b.starts.has(targetKey(target)), false);
  assert.equal(b.runs.has(targetKey(target)), false);
  assert.deepEqual(agentBrowser().map((c) => [c.args, c.on]), [[["--session", "herdr-t6", "close"], target.machine]]);
}

test("a close made while a local auto-start's open is pending stays closed when the open returns", async () => {
  const open = pending();
  openResult = open.promise;
  const { b, cx } = panel("/home/me/shop");
  b.settle(cx);
  await closeWhileStarting(b, cx, TARGET, { check: () => opens().length === 1, release: () => open.release({ code: 0, stdout: "", stderr: "" }) });
  b.keep("", { at: Date.now() + 1, os: "Darwin", tools: { agentBrowser: true }, sessions: [], error: null });
  b.settle(cx);
  await drain(cx);
  assert.equal(opens().length, 1);
});

test("a close made while a remote start's open is pending stays closed when the open returns", async () => {
  const open = pending();
  const answer = await runResult();
  runResult = () => open.promise;
  const { b, cx } = panel("/home/me/shop");
  b.start(REMOTE, cx, true);
  await closeWhileStarting(b, cx, REMOTE, { check: () => hcCalls.length === 1, release: () => open.release(answer) });
  assert.deepEqual(hcCalls, [remoteRun, ["rm", "build_box/t1q"]]);
});

test("a close made while stream enable is pending stores no start over the close", async () => {
  const stream = pending();
  const exec = globalThis.host.exec;
  globalThis.host.exec = (command, args, options) => command === "agent-browser" && args.at(-1) === "enable" ? (calls.push({ command, args, on: options?.on ?? null }), stream.promise) : exec(command, args, options);
  const { b, cx } = panel("/home/me/shop");
  b.start(TARGET, cx, true);
  await until(() => streams().length === 1);
  sessions = [{ session: "herdr-t6", url: "https://agent.test/" }];
  b.keep("", { at: Date.now(), os: "Darwin", tools: { agentBrowser: true }, sessions: [{ session: "herdr-t6", namespace: null, pid: 77, port: null, engine: "chrome", url: "https://agent.test/" }], error: null });
  b.settle(cx);
  b.end(TARGET, cx);
  await cx.tasks.at(-1);
  stream.release({ code: 0, stdout: "", stderr: "" });
  await drain(cx);
  assert.equal(b.current().kind, "start");
  assert.equal(b.current().closed, true);
  assert.equal(b.current().error, null);
  assert.equal(b.starts.has(targetKey(TARGET)), false);
  assert.equal(b.runs.has(targetKey(TARGET)), false);
});

test("after one terminal's close, another terminal with no session still auto-starts", async () => {
  sessions = [{ session: "herdr-t6", url: "https://agent.test/" }];
  const { b, cx } = panel("/home/me/shop");
  b.end(TARGET, cx);
  await drain(cx);
  b.target = { address: "t7", machine: null, id: "t7", session: "herdr-t7", since: 1 };
  b.settle(cx);
  await drain(cx);
  assert.deepEqual(opens().map((args) => args[4]), ["herdr-t7"]);
});
