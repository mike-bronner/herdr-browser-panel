import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionName, resolveTarget, follow, targetKey, machineLabel, findSession, startArgs, streamArgs, feedKey, takesKeys, panelState, settledStart, blockShown, headerHeight, terminalFolder, sessionFolder, autoStart, trackRun, endedQuickly, screenText } from "../mods/browser/panel.js";

const SPACES = [{ id: "sp-local", machine: null }, { id: "sp-remote", machine: "build_box" }];

test("sessionName prefixes a terminal id with herdr-", () => {
  assert.equal(sessionName("t1b"), "herdr-t1b");
  assert.equal(sessionName("T_9-x"), "herdr-T_9-x");
});

test("sessionName refuses ids agent-browser would reject or a shell could misread", () => {
  for (const id of ["", "t 1", "t1;rm", "../t1", "t1/x", null, undefined, 7]) assert.equal(sessionName(id), null, String(id));
});

test("resolveTarget reads a remote machine from the address prefix", () => {
  assert.deepEqual(resolveTarget({ terminal: "build_box/t6", space: "sp-local" }, SPACES),
    { address: "build_box/t6", machine: "build_box", id: "t6", session: "herdr-t6" });
});

test("resolveTarget treats a bare address as the focused space's machine", () => {
  assert.deepEqual(resolveTarget({ terminal: "t1b", space: "sp-local" }, SPACES),
    { address: "t1b", machine: null, id: "t1b", session: "herdr-t1b" });
  assert.equal(resolveTarget({ terminal: "t3", space: "sp-remote" }, SPACES).machine, "build_box");
});

test("resolveTarget leaves a bare address unresolved while its space is unknown", () => {
  assert.equal(resolveTarget({ terminal: "t3", space: "gone" }, SPACES), null);
  assert.equal(resolveTarget({ terminal: "t3" }, undefined), null);
});

test("follow keeps the last terminal while the focused space is not listed yet", () => {
  const first = follow(null, { terminal: "build_box/t6", space: "sp-remote" }, SPACES, 1);
  assert.equal(follow(first, { terminal: "t3", space: "new-space" }, SPACES, 2), first);
});

test("resolveTarget has no target without a focused terminal", () => {
  assert.equal(resolveTarget(null, SPACES), null);
  assert.equal(resolveTarget({ terminal: null, pane: "p1" }, SPACES), null);
  assert.equal(resolveTarget({ terminal: "" }, SPACES), null);
});

test("resolveTarget gives no session name for an address with an empty machine or a bad id", () => {
  assert.equal(resolveTarget({ terminal: "/t1" }, SPACES).session, null);
  assert.equal(resolveTarget({ terminal: "box/t 1" }, SPACES).session, null);
});

test("follow switches to the newly focused terminal", () => {
  const first = follow(null, { terminal: "t1", space: "sp-local" }, SPACES);
  const second = follow(first, { terminal: "build_box/t6", space: "sp-remote" }, SPACES);
  assert.equal(second.session, "herdr-t6");
  assert.equal(second.machine, "build_box");
});

test("follow keeps the same object while focus stays on one terminal", () => {
  const first = follow(null, { terminal: "t1", space: "sp-local" }, SPACES);
  assert.equal(follow(first, { terminal: "t1", space: "sp-local" }, SPACES), first);
});

test("follow keeps the last terminal when focus moves to something that is not a terminal", () => {
  const first = follow(null, { terminal: "t1", space: "sp-local" }, SPACES);
  assert.equal(follow(first, { terminal: null, pane: "p-mod" }, SPACES), first);
  assert.equal(follow(first, null, SPACES), first);
});

test("follow gives a new target on the remote machine when the same bare id moves there", () => {
  const local = follow(null, { terminal: "t6", space: "sp-local" }, SPACES, 1);
  const moved = follow(local, { terminal: "t6", space: "sp-remote" }, SPACES, 2);
  assert.notEqual(moved, local);
  assert.equal(moved.address, local.address);
  assert.equal(moved.machine, "build_box");
  assert.equal(moved.since, 2);
});

test("follow stamps a new target with the time focus reached it", () => {
  assert.equal(follow(null, { terminal: "t1", space: "sp-local" }, SPACES, 42).since, 42);
});

test("targetKey tells the same address on two machines apart", () => {
  assert.notEqual(targetKey({ address: "t6", machine: null }), targetKey({ address: "t6", machine: "build_box" }));
  assert.equal(targetKey({ address: "t6", machine: "build_box" }), "build_box|t6");
});

test("follow treats the same id on another machine as another terminal", () => {
  const local = follow(null, { terminal: "t6", space: "sp-local" }, SPACES);
  const remote = follow(local, { terminal: "build_box/t6", space: "sp-remote" }, SPACES);
  assert.notEqual(remote, local);
  assert.equal(remote.machine, "build_box");
});

test("machineLabel names this computer for a null machine", () => {
  assert.equal(machineLabel(null), "this computer");
  assert.equal(machineLabel("build_box"), "build_box");
});

test("findSession matches the exact name outside any namespace", () => {
  const sessions = [
    { session: "herdr-t10", namespace: null },
    { session: "herdr-t1", namespace: "ns" },
    { session: "herdr-t1", namespace: null, port: 9 },
  ];
  assert.equal(findSession(sessions, "herdr-t1").port, 9);
  assert.equal(findSession(sessions.slice(0, 2), "herdr-t1"), null);
  assert.equal(findSession(undefined, "herdr-t1"), null);
});

test("startArgs opens a blank page in the named session", () => {
  assert.deepEqual(startArgs("herdr-t1b"), ["--session", "herdr-t1b", "open", "about:blank"]);
  assert.deepEqual(startArgs("herdr-t1b", "about:blank"), ["--session", "herdr-t1b", "open", "about:blank"]);
});

test("startArgs opens a detected http or https address as one argument", () => {
  assert.deepEqual(startArgs("herdr-t1b", "https://shop.test"), ["--session", "herdr-t1b", "open", "https://shop.test/"]);
  assert.deepEqual(startArgs("herdr-t1b", "http://127.0.0.1:3000"), ["--session", "herdr-t1b", "open", "http://127.0.0.1:3000/"]);
});

test("startArgs refuses an address that is not http, https or the blank page", () => {
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "--help", "shop.test", "about:config", null]) assert.throws(() => startArgs("herdr-t1b", url), /not an address to open/, String(url));
});

test("startArgs refuses any name that is not a terminal session name", () => {
  for (const name of ["t1b", "herdr-", "herdr-t 1", "other", null]) assert.throws(() => startArgs(name), /not a terminal session name/, String(name));
});

const remote = { address: "build_box/t6", machine: "build_box", id: "t6", session: "herdr-t6" };
const running = { session: "herdr-t6", namespace: null, pid: 77, port: 4321, url: "https://example.com/", engine: "chrome" };

test("panelState is idle with no target", () => {
  assert.deepEqual(panelState({ target: null }), { kind: "idle" });
});

test("panelState is unsupported when the terminal has no session name", () => {
  assert.equal(panelState({ target: { address: "x/t 1", machine: "x", id: "t 1", session: null } }).kind, "unsupported");
});

test("panelState is looking until the terminal's machine has answered", () => {
  assert.equal(panelState({ target: remote, scan: undefined }).kind, "looking");
});

test("panelState is running with session, machine, port and page when the session exists", () => {
  assert.deepEqual(panelState({ target: remote, scan: { at: 5, os: "Darwin", sessions: [running], error: null } }), {
    kind: "running", session: "herdr-t6", machine: "build_box", address: "build_box/t6",
    at: 5, pid: 77, port: 4321, url: "https://example.com/", engine: "chrome", os: "Darwin",
  });
});

test("panelState gives a null os when the machine did not report one", () => {
  assert.equal(panelState({ target: remote, scan: { sessions: [running] } }).os, null);
});

test("streamArgs enables the stream in the named session", () => {
  assert.deepEqual(streamArgs("herdr-t1b"), ["--session", "herdr-t1b", "stream", "enable"]);
});

test("streamArgs refuses any name that is not a terminal session name", () => {
  for (const name of ["t1b", "herdr-", "herdr-t;1", "--session", undefined]) assert.throws(() => streamArgs(name), /not a terminal session name/, String(name));
});

const live = { kind: "running", at: 100, pid: 77, port: 4321 };

test("feedKey names the terminal, daemon and port of a visible running session", () => {
  assert.equal(feedKey(live, remote, true), "build_box|build_box/t6|77|4321");
});

test("feedKey is null while the panel is hidden", () => {
  assert.equal(feedKey(live, remote, false), null);
});

test("feedKey is null when the session is not running or has no stream port", () => {
  for (const kind of ["idle", "looking", "start", "starting", "unreachable", "unsupported"]) assert.equal(feedKey({ ...live, kind }, remote, true), null, kind);
  assert.equal(feedKey({ ...live, port: null }, remote, true), null);
  assert.equal(feedKey(null, remote, true), null);
});

test("feedKey changes when focus, daemon or port changes", () => {
  const local = { address: "t6", machine: null, id: "t6", session: "herdr-t6" };
  const keys = new Set([
    feedKey(live, remote, true),
    feedKey(live, local, true),
    feedKey({ ...live, pid: 78 }, remote, true),
    feedKey({ ...live, port: 4322 }, remote, true),
  ]);
  assert.equal(keys.size, 4);
});

test("panelState shows running even while a start is still pending", () => {
  assert.equal(panelState({ target: remote, scan: { sessions: [running] }, start: { status: "starting" } }).kind, "running");
});

test("panelState offers the start control when the machine answered with no session", () => {
  const other = { ...running, session: "herdr-t7" };
  assert.deepEqual(panelState({ target: remote, scan: { at: 9, sessions: [other], error: null } }),
    { kind: "start", session: "herdr-t6", machine: "build_box", address: "build_box/t6", at: 9, error: null, command: null, hint: null });
});

test("panelState withholds the start control when the machine could not be asked", () => {
  const state = panelState({ target: remote, scan: { sessions: [], error: "machine unreachable" } });
  assert.equal(state.kind, "unreachable");
  assert.equal(state.error, "machine unreachable");
});

test("panelState is starting while a start runs and no session shows yet", () => {
  assert.equal(panelState({ target: remote, scan: { sessions: [] }, start: { status: "starting" } }).kind, "starting");
  assert.equal(panelState({ target: remote, scan: undefined, start: { status: "starting" } }).kind, "starting");
});

test("panelState carries a failed start's error back to the start state", () => {
  const state = panelState({ target: remote, scan: { sessions: [] }, start: { status: "failed", error: "no chrome" } });
  assert.equal(state.kind, "start");
  assert.equal(state.error, "no chrome");
});

test("panelState says so when a start succeeded but the session never showed", () => {
  const state = panelState({ target: remote, scan: { sessions: [] }, start: { status: "started" } });
  assert.equal(state.kind, "start");
  assert.match(state.error, /no session named herdr-t6/);
});

test("panelState shows starting when a start is pending and the scan failed", () => {
  assert.equal(panelState({ target: remote, scan: { sessions: [], error: "down" }, start: { status: "starting" } }).kind, "starting");
});

test("panelState shows unreachable, not the start control, when the scan failed after a failed start", () => {
  const state = panelState({ target: remote, scan: { sessions: [], error: "down" }, start: { status: "failed", error: "no chrome" } });
  assert.equal(state.kind, "unreachable");
  assert.equal(state.error, "down");
});

test("panelState looks again instead of using a scan older than the focus change", () => {
  const focusedAt = { ...remote, since: 100 };
  assert.equal(panelState({ target: focusedAt, scan: { at: 99, sessions: [] } }).kind, "looking");
  assert.equal(panelState({ target: focusedAt, scan: { at: 99, sessions: [running] } }).kind, "looking");
  assert.equal(panelState({ target: focusedAt, scan: { at: 100, sessions: [running] } }).kind, "running");
  assert.equal(panelState({ target: focusedAt, scan: { at: 101, sessions: [] } }).kind, "start");
});

test("settledStart drops a start result once the session runs", () => {
  assert.equal(settledStart({ kind: "running" }, { status: "failed", error: "x" }), null);
  assert.equal(settledStart({ kind: "running" }, { status: "started" }), null);
});

test("settledStart keeps a start result while the session is not running", () => {
  const start = { status: "failed", error: "x" };
  assert.equal(settledStart({ kind: "start" }, start), start);
  assert.equal(settledStart({ kind: "starting" }, undefined), null);
});

const panelLayout = (active, hidden = false) => ({
  id: "root", type: "row", children: [
    { id: "main", type: "block", content: { tab: "active" } },
    { id: "panel", type: "column", hidden, children: [
      { id: "panel-body", type: "stack", active, children: [
        { id: "files", type: "block", content: { mod: "files" } },
        { id: "browser", type: "block", content: { mod: "browser" } },
      ] },
    ] },
  ],
});

test("blockShown is true when the stack shows the browser block", () => {
  assert.equal(blockShown(panelLayout("browser"), "browser"), true);
});

test("blockShown is false when another stack child is shown", () => {
  assert.equal(blockShown(panelLayout("files"), "browser"), false);
});

test("blockShown treats a stack with no active child as showing its first child", () => {
  assert.equal(blockShown(panelLayout(undefined), "browser"), false);
  assert.equal(blockShown(panelLayout(undefined), "files"), true);
});

test("blockShown is false when a hidden ancestor holds the browser block", () => {
  assert.equal(blockShown(panelLayout("browser", true), "browser"), false);
});

test("blockShown is null when the layout has no browser block", () => {
  assert.equal(blockShown(panelLayout("files"), "other"), null);
  assert.equal(blockShown(null, "browser"), null);
});

const framed = (pane, stack) => ({
  id: "root", type: "row", children: [
    { id: "work", type: "stack", active: stack?.active, children: [
      ...(stack?.before ?? []),
      { id: "main", type: "block", content: { tab: "active", pane } },
    ] },
    { id: "panel", type: "column", children: [{ id: "browser", type: "block", content: { mod: "browser" } }] },
  ],
});

test("headerHeight reads the layout's pane header height", () => {
  assert.equal(headerHeight(framed({ header: { height: 34, content: { mod: "pane" } } })), 34);
});

test("headerHeight is 30 when the layout frames no pane header", () => {
  assert.equal(headerHeight(null), 30);
  assert.equal(headerHeight(panelLayout("browser")), 30);
  assert.equal(headerHeight(framed({ header: { content: { mod: "pane" } } })), 30);
});

test("headerHeight is 30 when the header height is not a positive number", () => {
  for (const height of [0, -4, "34", NaN, Infinity, null]) assert.equal(headerHeight(framed({ header: { height } })), 30, String(height));
});

test("headerHeight reads the stack's active child, past hidden ones", () => {
  const other = { id: "other", type: "block", content: { tab: "active", pane: { header: { height: 50 } } } };
  assert.equal(headerHeight(framed({ header: { height: 34 } }, { active: "main", before: [other] })), 34);
  assert.equal(headerHeight(framed({ header: { height: 34 } }, { active: "gone", before: [{ ...other, hidden: true }] })), 34);
});

const tabPane = (id, height, extra) => ({ id, type: "block", content: { tab: "active", pane: { header: { height } } }, ...extra });

test("headerHeight skips a hidden node under a row", () => {
  assert.equal(headerHeight({ id: "root", type: "row", children: [tabPane("hid", 50, { hidden: true }), tabPane("main", 34)] }), 34);
});

test("headerHeight is 30 for an empty stack and for a stack with every child hidden", () => {
  assert.equal(headerHeight({ id: "work", type: "stack", children: [] }), 30);
  assert.equal(headerHeight({ id: "work", type: "stack", active: "a", children: [tabPane("a", 50, { hidden: true }), tabPane("b", 44, { hidden: true })] }), 30);
});

test("headerHeight moves past a first child that frames no pane to a later child", () => {
  const files = { id: "side", type: "column", children: [{ id: "files", type: "block", content: { mod: "files" } }] };
  assert.equal(headerHeight({ id: "root", type: "row", children: [files, tabPane("main", 34)] }), 34);
});

test("headerHeight uses a visible stack child when the active id names a hidden child", () => {
  assert.equal(headerHeight({ id: "work", type: "stack", active: "hid", children: [tabPane("hid", 50, { hidden: true }), tabPane("main", 34)] }), 34);
});

test("headerHeight does not take a block with a pane but no tab as the pane frame", () => {
  const untabbed = { id: "loose", type: "block", content: { pane: { header: { height: 50 } } } };
  assert.equal(headerHeight({ id: "root", type: "row", children: [untabbed, tabPane("main", 34)] }), 34);
});

test("feedKey is null for a running state from a scan older than the panel's show time", () => {
  const state = panelState({ target: { ...remote, since: 10 }, scan: { at: 50, sessions: [running] } });
  assert.equal(state.kind, "running");
  assert.equal(feedKey(state, remote, true, 60), null);
});

test("feedKey accepts a scan taken at or after the panel's show time", () => {
  assert.equal(feedKey(live, remote, true, 100), "build_box|build_box/t6|77|4321");
  assert.equal(feedKey(live, remote, true, 99), "build_box|build_box/t6|77|4321");
});

test("takesKeys is true only while the picture has focus and the stream is live", () => {
  assert.equal(takesKeys(true, "live"), true);
  assert.equal(takesKeys(false, "live"), false);
});

test("takesKeys leaves keys to Herdr while the stream connects, retries or is absent", () => {
  for (const phase of ["connecting", "error", undefined, null]) assert.equal(takesKeys(true, phase), false, String(phase));
});

const missing = (tools = {}, os = "Darwin") => ({ at: 5, os, sessions: [], error: null, tools: { agentBrowser: false, brew: true, npm: false, node: null, ...tools } });

test("panelState shows agent-browser missing, with its Homebrew route, instead of the start control", () => {
  assert.deepEqual(panelState({ target: remote, scan: missing() }), {
    kind: "missing", session: "herdr-t6", machine: "build_box", address: "build_box/t6", via: "brew",
    plan: "brew install agent-browser && agent-browser install", command: "brew install agent-browser && agent-browser install", error: null, hint: null, ifSudo: null,
  });
});

test("panelState keeps the start control when the scan found agent-browser or did not say", () => {
  assert.equal(panelState({ target: remote, scan: { ...missing(), tools: { agentBrowser: true } } }).kind, "start");
  assert.equal(panelState({ target: remote, scan: { ...missing(), tools: { agentBrowser: null } } }).kind, "start");
  assert.equal(panelState({ target: remote, scan: { ...missing(), tools: null } }).kind, "start");
});

test("panelState shows a running session even when the scan says agent-browser is missing", () => {
  assert.equal(panelState({ target: remote, scan: { ...missing(), sessions: [running] } }).kind, "running");
});

test("panelState gives no install route and names the reason and the command when the machine lacks one", () => {
  const state = panelState({ target: remote, scan: missing({ brew: false, npm: true, node: "18.0.0" }, "Linux") });
  assert.equal(state.kind, "missing");
  assert.equal(state.via, null);
  assert.match(state.error, /Node\.js 18\.0\.0 is older than the 22/);
  assert.equal(state.command, "npm install -g agent-browser && agent-browser install --with-deps");
});

test("panelState shows the install's step while it runs, before the scan answers and over a failed scan", () => {
  const install = { status: "installing", via: "npm", step: 2, of: 2, label: "agent-browser install" };
  const expected = { kind: "installing", session: "herdr-t6", machine: "build_box", address: "build_box/t6", via: "npm", step: 2, of: 2, label: "agent-browser install" };
  assert.deepEqual(panelState({ target: remote, scan: undefined, install }), expected);
  assert.deepEqual(panelState({ target: remote, scan: { ...missing(), error: "down" }, install }), expected);
  assert.deepEqual(panelState({ target: remote, scan: { ...missing(), tools: { agentBrowser: true } }, install }), expected);
});

test("panelState carries a failed install's error and hand command back to the missing state", () => {
  const install = { status: "failed", stage: "package", error: "brew install agent-browser failed: offline", command: "brew install agent-browser && agent-browser install" };
  const state = panelState({ target: remote, scan: missing(), install });
  assert.equal(state.kind, "missing");
  assert.equal(state.via, "brew");
  assert.equal(state.error, install.error);
  assert.equal(state.command, install.command);
});

test("panelState says so when an install finished but agent-browser is still not found", () => {
  const state = panelState({ target: remote, scan: missing(), install: { status: "installed" } });
  assert.equal(state.kind, "missing");
  assert.match(state.error, /PATH still does not find agent-browser/);
});

test("panelState offers start with the browser download's error and command when only that step failed", () => {
  const install = { status: "failed", stage: "browser", error: "agent-browser install failed: disk full", command: "agent-browser install" };
  const scan = { ...missing(), tools: { agentBrowser: true } };
  const state = panelState({ target: remote, scan, install });
  assert.equal(state.kind, "start");
  assert.equal(state.error, install.error);
  assert.equal(state.command, "agent-browser install");
  const after = panelState({ target: remote, scan, install, start: { status: "failed", error: "no chrome" } });
  assert.equal(after.error, "no chrome");
  assert.equal(after.command, null);
});

test("panelState looks again instead of offering an install from a scan older than the focus change", () => {
  assert.equal(panelState({ target: { ...remote, since: 6 }, scan: missing() }).kind, "looking");
});

test("panelState shows the libraries hint for a non-root Linux user, before and after the install", () => {
  const scan = missing({ root: false }, "Linux");
  const before = panelState({ target: remote, scan });
  assert.equal(before.kind, "missing");
  assert.equal(before.plan, "brew install agent-browser && agent-browser install");
  assert.equal(before.hint, "agent-browser install --with-deps");
  const found = { ...scan, tools: { agentBrowser: true } };
  const install = { status: "installed", hint: "agent-browser install --with-deps" };
  assert.equal(panelState({ target: remote, scan: found, install }).hint, "agent-browser install --with-deps");
  assert.equal(panelState({ target: remote, scan: found, install, start: { status: "failed", error: "x" } }).hint, null);
});

test("panelState plans the libraries step and gives no hint for root on Linux", () => {
  const state = panelState({ target: remote, scan: missing({ root: true }, "Linux") });
  assert.equal(state.plan, "brew install agent-browser && agent-browser install --with-deps");
  assert.equal(state.hint, null);
});

test("panelState names the sudo-only libraries step before the click for a non-root Linux user", () => {
  assert.equal(panelState({ target: remote, scan: missing({ root: false }, "Linux") }).ifSudo, "agent-browser install --with-deps");
  assert.equal(panelState({ target: remote, scan: missing({}, "Linux") }).ifSudo, "agent-browser install --with-deps");
});

test("panelState names no sudo-only step for root, outside Linux, or without an install route", () => {
  assert.equal(panelState({ target: remote, scan: missing({ root: true }, "Linux") }).ifSudo, null);
  assert.equal(panelState({ target: remote, scan: missing({ root: false }, "Darwin") }).ifSudo, null);
  assert.equal(panelState({ target: remote, scan: missing({ brew: false, npm: false }, "Linux") }).ifSudo, null);
});

test("terminalFolder reads the focused terminal's live folder", () => {
  assert.equal(terminalFolder(remote, { terminal: "build_box/t6", cwd: "/srv/shop" }, []), "/srv/shop");
});

test("terminalFolder reads the pane's folder when focus has moved off the terminal", () => {
  const panes = [{ terminal: "t1", cwd: "/a" }, { terminal: "build_box/t6", cwd: "/srv/shop/app" }];
  assert.equal(terminalFolder(remote, { terminal: null, cwd: null }, panes), "/srv/shop/app");
  assert.equal(terminalFolder(remote, null, panes), "/srv/shop/app");
});

test("terminalFolder is null with no target or no folder known", () => {
  assert.equal(terminalFolder(null, { terminal: "t1", cwd: "/a" }, []), null);
  assert.equal(terminalFolder(remote, { terminal: "build_box/t6", cwd: "" }, []), null);
  assert.equal(terminalFolder(remote, { terminal: "t1", cwd: "/a" }, [{ terminal: "t1", cwd: "/a" }]), null);
  assert.equal(terminalFolder(remote, null, undefined), null);
});

const startState = (extra = {}) => panelState({ target: remote, scan: { at: 10, sessions: [], tools: { agentBrowser: true }, error: null }, ...extra });
const ready = (extra = {}) => ({ visible: true, shownAt: 5, start: undefined, ...extra });

test("autoStart starts a shown terminal with no session once a fresh scan says so", () => {
  assert.equal(startState().kind, "start");
  assert.equal(autoStart(startState(), ready()), true);
  assert.equal(autoStart(startState(), ready({ shownAt: 10 })), true);
});

test("autoStart restarts a terminal whose session ended, whoever started it", () => {
  const runningState = panelState({ target: remote, scan: { at: 10, sessions: [running] } });
  assert.equal(runningState.kind, "running");
  assert.equal(settledStart(runningState, { status: "started" }), null);
  const ended = panelState({ target: remote, scan: { at: 20, sessions: [], tools: { agentBrowser: true }, error: null }, start: undefined });
  assert.equal(ended.kind, "start");
  assert.equal(autoStart(ended, ready()), true);
});

test("autoStart does not restart after a failed start, so the Start button shows instead", () => {
  const failed = { status: "failed", error: "no chrome" };
  const state = startState({ start: failed });
  assert.equal(state.kind, "start");
  assert.equal(state.error, "no chrome");
  assert.equal(autoStart(state, ready({ start: failed })), false);
  const quiet = { status: "started" };
  assert.equal(startState({ start: quiet }).error, "agent-browser started, but no session named herdr-t6 showed up");
  assert.equal(autoStart(startState({ start: quiet }), ready({ start: quiet })), false);
});

test("autoStart does nothing while the panel is hidden or from a scan older than the show", () => {
  assert.equal(autoStart(startState(), ready({ visible: false })), false);
  assert.equal(autoStart(startState(), ready({ shownAt: 11 })), false);
});

test("autoStart leaves a running, missing, unreachable or still-looking terminal alone", () => {
  assert.equal(autoStart(panelState({ target: remote, scan: { at: 10, sessions: [running] } }), ready()), false);
  assert.equal(autoStart(panelState({ target: remote, scan: { at: 10, os: "Darwin", sessions: [], tools: { agentBrowser: false, brew: true, npm: false, node: null, root: false } } }), ready()), false);
  assert.equal(autoStart(panelState({ target: remote, scan: { at: 10, sessions: [], error: "down" } }), ready()), false);
  assert.equal(autoStart(panelState({ target: remote, scan: undefined }), ready()), false);
  assert.equal(autoStart(panelState({ target: null }), ready()), false);
});

test("autoStart waits for a click after a start or an install step failed", () => {
  const failedStart = { status: "failed", error: "no chrome" };
  assert.equal(autoStart(startState({ start: failedStart }), ready({ start: failedStart })), false);
  const install = { status: "failed", step: 1, error: "download failed", command: "npx agent-browser install" };
  const state = startState({ install });
  assert.equal(state.kind, "start");
  assert.equal(autoStart(state, ready()), false);
});

test("autoStart does not start again while a start result is still held", () => {
  assert.equal(autoStart(startState(), ready({ start: { status: "started" } })), false);
});

test("screenText says the session has no live view, with the stream error when there is one", () => {
  assert.equal(screenText({ port: null, streamError: null, feed: null }), "This session has no live view.");
  assert.equal(screenText({ port: null, streamError: "stream refused", feed: { phase: "live", empty: false } }), "This session has no live view. stream refused");
});

test("screenText says connecting until a feed exists or while it connects with no picture", () => {
  assert.equal(screenText({ port: 4321, feed: null }), "Connecting…");
  assert.equal(screenText({ port: 4321, feed: { phase: "connecting", error: null, empty: true } }), "Connecting…");
});

test("screenText gives the feed's error, or disconnected when it has none", () => {
  assert.equal(screenText({ port: 4321, feed: { phase: "error", error: "connection refused", empty: true } }), "Cannot reach the live view: connection refused");
  assert.equal(screenText({ port: 4321, feed: { phase: "error", error: null, empty: false } }), "Cannot reach the live view: disconnected");
});

test("screenText waits for paint on a live feed with no picture, and shows nothing over a picture", () => {
  assert.equal(screenText({ port: 4321, feed: { phase: "live", error: null, empty: true } }), "Waiting for the page to paint…");
  assert.equal(screenText({ port: 4321, feed: { phase: "live", error: null, empty: false } }), null);
  assert.equal(screenText({ port: 4321, feed: { phase: "connecting", error: null, empty: false } }), null);
});

test("sessionFolder records the folder when a session is first seen and keeps it after the terminal moves", () => {
  const run = panelState({ target: remote, scan: { at: 10, sessions: [running] } });
  const first = sessionFolder(undefined, run, "/srv/a");
  assert.equal(first, "/srv/a");
  assert.equal(sessionFolder(first, run, "/srv/b"), "/srv/a");
});

test("sessionFolder keeps the folder a start recorded while the session starts or is looked for", () => {
  assert.equal(sessionFolder("/srv/a", { kind: "starting" }, "/srv/b"), "/srv/a");
  assert.equal(sessionFolder("/srv/a", { kind: "looking" }, "/srv/b"), "/srv/a");
  assert.equal(sessionFolder(undefined, { kind: "looking" }, "/srv/b"), null);
});

test("sessionFolder forgets the folder once the terminal has no session, so the next one records afresh", () => {
  assert.equal(sessionFolder("/srv/a", startState(), "/srv/b"), null);
  assert.equal(sessionFolder(null, panelState({ target: remote, scan: { at: 30, sessions: [running] } }), "/srv/b"), "/srv/b");
});

test("autoStart does not restart an auto-started session that ended within 30 seconds", () => {
  assert.equal(autoStart(startState(), ready({ run: { at: 1000, endedAt: 30000 } })), false);
  assert.equal(autoStart(startState(), ready({ run: { at: 1000, endedAt: 1000 } })), false);
});

test("autoStart restarts an auto-started session that ended after 30 seconds", () => {
  assert.equal(autoStart(startState(), ready({ run: { at: 1000, endedAt: 32000 } })), true);
  assert.equal(autoStart(startState(), ready({ run: { at: 1000, endedAt: 31000 } })), true);
  assert.equal(autoStart(startState(), ready({ run: { at: 1000 } })), true);
});

test("endedQuickly needs an end time", () => {
  assert.equal(endedQuickly(null), false);
  assert.equal(endedQuickly({ at: 5 }), false);
  assert.equal(endedQuickly({ at: 0, endedAt: 29000 }), true);
  assert.equal(endedQuickly({ at: 0, endedAt: 31000 }), false);
});

test("trackRun stamps the end the first time the terminal shows no session, and keeps that stamp", () => {
  const ended = trackRun({ at: 1000 }, startState(), 30000);
  assert.deepEqual(ended, { at: 1000, endedAt: 30000 });
  assert.equal(trackRun(ended, startState(), 90000), ended);
  assert.equal(autoStart(startState(), ready({ run: trackRun(ended, startState(), 90000) })), false);
});

test("trackRun keeps a run while its session runs or starts, and forgets it when a session runs again after the end", () => {
  const run = { at: 1000 };
  const live = panelState({ target: remote, scan: { at: 10, sessions: [running] } });
  assert.equal(trackRun(run, live, 5000), run);
  assert.equal(trackRun(run, { kind: "starting" }, 5000), run);
  assert.equal(trackRun({ at: 1000, endedAt: 2000 }, live, 5000), null);
  assert.equal(trackRun(null, startState(), 5000), null);
});
