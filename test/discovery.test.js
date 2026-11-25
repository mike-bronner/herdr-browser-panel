import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DISCOVER, parseDiscovery, brief } from "../mods/browser/discovery.js";
import { findSession } from "../mods/browser/panel.js";

const root = mkdtempSync(join(tmpdir(), "browser-discovery-"));
after(() => rmSync(root, { recursive: true, force: true }));

function runDiscover(env) {
  return execFileSync("sh", ["-c", DISCOVER], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
}

function discoverIn(dir) {
  return parseDiscovery(runDiscover({ HOME: join(root, "nohome"), TMPDIR: join(root, "notmp"), AGENT_BROWSER_SOCKET_DIR: dir })).sessions;
}

test("DISCOVER reports a namespaced session that findSession then skips", () => {
  const dir = join(root, "spaced");
  const run = join(dir, "namespaces", "ns", "run");
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "herdr-t1.pid"), String(process.pid));
  const sessions = discoverIn(dir);
  assert.deepEqual(sessions.map((s) => [s.session, s.namespace, s.dir]), [["herdr-t1", "ns", run]]);
  assert.equal(findSession(sessions, "herdr-t1"), null);
});

test("DISCOVER lists one session when two pid files hold the same live pid", () => {
  const dir = join(root, "twice");
  mkdirSync(dir);
  writeFileSync(join(dir, "herdr-t1.pid"), String(process.pid));
  writeFileSync(join(dir, "herdr-t2.pid"), String(process.pid));
  assert.deepEqual(discoverIn(dir).map((s) => s.session), ["herdr-t1"]);
});

test("DISCOVER gives no port when the session has no stream file", () => {
  const dir = join(root, "nostream");
  mkdirSync(dir);
  writeFileSync(join(dir, "herdr-t3.pid"), String(process.pid));
  const sessions = discoverIn(dir);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].port, null);
});

test("DISCOVER reports a live session with its stream port and page", () => {
  const dir = join(root, "live");
  mkdirSync(dir);
  writeFileSync(join(dir, "herdr-t1.pid"), String(process.pid));
  writeFileSync(join(dir, "herdr-t1.stream"), "4567");
  writeFileSync(join(dir, "herdr-t1.target"), JSON.stringify({ url: "https://example.com/a" }));
  const { sessions } = parseDiscovery(runDiscover({ HOME: join(root, "nohome"), TMPDIR: join(root, "notmp"), AGENT_BROWSER_SOCKET_DIR: dir }));
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0], { session: "herdr-t1", dir, namespace: null, pid: process.pid, port: 4567, engine: "chrome", url: "https://example.com/a" });
});

test("DISCOVER skips a session whose process is gone and the dashboard", () => {
  const dir = join(root, "dead");
  mkdirSync(dir);
  const exited = execFileSync("sh", ["-c", "echo $$"], { encoding: "utf8" }).trim();
  writeFileSync(join(dir, "herdr-t2.pid"), exited);
  writeFileSync(join(dir, "dashboard.pid"), String(process.pid));
  const { sessions } = parseDiscovery(runDiscover({ HOME: join(root, "nohome"), TMPDIR: join(root, "notmp"), AGENT_BROWSER_SOCKET_DIR: dir }));
  assert.deepEqual(sessions, []);
});

test("parseDiscovery reads the os line and sessions, and marks namespaces", () => {
  const out = [
    '{"os":"Darwin"}',
    '{"session":"herdr-t9","dir":"/h/.agent-browser/namespaces/work/run","pid":5,"port":0,"engine":"","target":null}',
    '{"session":"herdr-t1","dir":"/h/.agent-browser","pid":4,"port":80,"engine":"lightpanda","target":{"url":"https://a.test/"}}',
  ].join("\n");
  const { os, sessions } = parseDiscovery(out);
  assert.equal(os, "Darwin");
  assert.deepEqual(sessions.map((s) => [s.session, s.namespace, s.port, s.engine, s.url]), [
    ["herdr-t1", null, 80, "lightpanda", "https://a.test/"],
    ["herdr-t9", "work", null, "chrome", null],
  ]);
});

test("parseDiscovery keeps a session whose target file is not JSON", () => {
  const { sessions } = parseDiscovery('{"session":"herdr-t1","dir":"/d","pid":4,"port":1,"engine":"chrome","target":not json}');
  assert.deepEqual(sessions, [{ session: "herdr-t1", dir: "/d", namespace: null, pid: 4, port: 1, engine: "chrome", url: null }]);
});

test("parseDiscovery skips unreadable lines and rows without a session", () => {
  assert.deepEqual(parseDiscovery("garbage\n{\"pid\":3}\n\n").sessions, []);
  assert.deepEqual(parseDiscovery(undefined), { os: null, tools: null, sessions: [] });
});

const NEEDED = ["uname", "head", "tr", "cat", "id"];
const real = Object.fromEntries(NEEDED.map((bin) => [bin, execFileSync("/bin/sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).trim()]));

function toolsWith(name, stubs) {
  const dir = join(root, name);
  mkdirSync(dir);
  for (const bin of NEEDED) if (!(bin in stubs)) symlinkSync(real[bin], join(dir, bin));
  for (const [bin, body] of Object.entries(stubs)) {
    writeFileSync(join(dir, bin), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, bin), 0o755);
  }
  const out = execFileSync("/bin/sh", ["-c", DISCOVER], { env: { PATH: dir, HOME: join(root, "nohome"), TMPDIR: join(root, "notmp") }, encoding: "utf8" });
  return parseDiscovery(out);
}

const NONE = { agentBrowser: false, brew: false, npm: false, node: null, root: false };
const SUDO_MARK = join(root, "sudo-called");
const SUDO = `echo called >> "${SUDO_MARK}"\nexit 0`;

test("DISCOVER reports agent-browser found and checks nothing else", () => {
  assert.deepEqual(toolsWith("found", { "agent-browser": "echo 0.44.0", brew: "exit 0", uname: "echo Linux", id: "echo 0" }).tools,
    { agentBrowser: true, brew: false, npm: false, node: null, root: false });
});

test("DISCOVER reports agent-browser missing with Homebrew, npm and the node version", () => {
  const { os, tools } = toolsWith("routes", { brew: "exit 0", npm: "exit 0", node: "echo v22.3.0" });
  assert.equal(os, execFileSync("uname", ["-s"], { encoding: "utf8" }).trim());
  assert.deepEqual(tools, { ...NONE, brew: true, npm: true, node: "22.3.0" });
});

test("DISCOVER reports agent-browser missing with no install tools", () => {
  assert.deepEqual(toolsWith("bare", {}).tools, NONE);
});

test("DISCOVER reports root on Linux when the user id is 0", () => {
  assert.equal(toolsWith("root", { uname: "echo Linux", id: "echo 0" }).tools.root, true);
});

test("DISCOVER reports no root on Linux for another user id", () => {
  assert.deepEqual(toolsWith("user", { uname: "echo Linux", id: "echo 1000" }), { os: "Linux", tools: NONE, sessions: [] });
});

test("DISCOVER reports no root outside Linux", () => {
  assert.equal(toolsWith("mac", { uname: "echo Darwin", id: "echo 0" }).tools.root, false);
});

test("DISCOVER never calls sudo, even on Linux for a user who could use it", () => {
  rmSync(SUDO_MARK, { force: true });
  for (const [name, id] of [["sudo-user", "echo 1000"], ["sudo-root", "echo 0"]]) {
    const { tools } = toolsWith(name, { uname: "echo Linux", id, sudo: SUDO });
    assert.equal(tools.agentBrowser, false);
  }
  assert.equal(existsSync(SUDO_MARK), false);
  execFileSync(join(root, "sudo-user", "sudo"));
  assert.equal(existsSync(SUDO_MARK), true);
});

test("parseDiscovery fails closed on tool fields of the wrong type", () => {
  const { tools } = parseDiscovery('{"os":"Linux","agentBrowser":"no","brew":"true","npm":1,"node":7,"root":"true"}');
  assert.deepEqual(tools, { agentBrowser: null, brew: false, npm: false, node: null, root: false });
});

test("brief drops credentials, query and fragment from an address", () => {
  assert.equal(brief("https://user:pw@example.com/path?token=1#x"), "https://example.com/path");
  assert.equal(brief(null), "");
});
