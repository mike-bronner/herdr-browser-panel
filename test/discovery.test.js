import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
  assert.deepEqual(parseDiscovery(undefined), { os: null, sessions: [] });
});

test("brief drops credentials, query and fragment from an address", () => {
  assert.equal(brief("https://user:pw@example.com/path?token=1#x"), "https://example.com/path");
  assert.equal(brief(null), "");
});
