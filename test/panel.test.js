import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionName, resolveTarget, follow, targetKey, machineLabel, findSession, startArgs, panelState, settledStart, blockShown } from "../mods/browser/panel.js";

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
});

test("startArgs refuses any name that is not a terminal session name", () => {
  for (const name of ["t1b", "herdr-", "herdr-t 1", "other", null]) assert.throws(() => startArgs(name), /not a terminal session name/, String(name));
});

const remote = { address: "build_box/t6", machine: "build_box", id: "t6", session: "herdr-t6" };
const running = { session: "herdr-t6", namespace: null, port: 4321, url: "https://example.com/", engine: "chrome" };

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
  assert.deepEqual(panelState({ target: remote, scan: { sessions: [running], error: null } }), {
    kind: "running", session: "herdr-t6", machine: "build_box", address: "build_box/t6",
    port: 4321, url: "https://example.com/", engine: "chrome",
  });
});

test("panelState shows running even while a start is still pending", () => {
  assert.equal(panelState({ target: remote, scan: { sessions: [running] }, start: { status: "starting" } }).kind, "running");
});

test("panelState offers the start control when the machine answered with no session", () => {
  const other = { ...running, session: "herdr-t7" };
  assert.deepEqual(panelState({ target: remote, scan: { sessions: [other], error: null } }),
    { kind: "start", session: "herdr-t6", machine: "build_box", address: "build_box/t6", error: null });
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
