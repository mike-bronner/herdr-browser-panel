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
    settings: () => ({ zoom: 1 }),
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
  assert.deepEqual(sent, [{ action: "viewport", width: 490, height: 1000, deviceScaleFactor: 1 }]);
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
  assert.deepEqual(sent.at(-1), { action: "viewport", width: 520, height: 990, deviceScaleFactor: 1 });
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
  assert.deepEqual(area.sent.at(-1), { action: "viewport", width: 520, height: 1000, deviceScaleFactor: 1 });
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
  assert.deepEqual(sent[1], { action: "viewport", width: 490, height: 1000, deviceScaleFactor: 1 });
});

test("a narrow area sends its own width at scale 1 on every platform", async () => {
  globalThis.host.window = () => ({ visible, platform: "macos" });
  const { b, cx, sent } = sized();
  b.area = { width: 361, height: 1228 };
  b.fit(cx);
  await drain(cx);
  assert.deepEqual(sent, [{ action: "viewport", width: 361, height: 1228, deviceScaleFactor: 1 }]);
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
  assert.deepEqual(sent.at(-1), { action: "viewport", width: 361, height: 1228, deviceScaleFactor: 1 });
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
    assert.deepEqual(sent.at(-1), { action: "viewport", width: 300, height: 700, deviceScaleFactor: 1 });
    assert.equal(b.sized.refits, 0);
    b.feed.picture = staleAt({ width: 300, height: 700 });
    await at(() => b.fit(cx, false));
    assert.equal(sent.length, 6);
    assert.equal(b.sized.refits, 1);
  } finally {
    Date.now = realNow;
  }
});
