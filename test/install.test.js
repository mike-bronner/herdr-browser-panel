import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeMajor, commandLine, needsSudoCheck, installPlan, installStep, installFailure, installDone, outputTail, settledInstall } from "../mods/browser/install.js";

test("nodeMajor reads the major version with or without a leading v", () => {
  assert.equal(nodeMajor("v22.3.0"), 22);
  assert.equal(nodeMajor("24.20.0"), 24);
  assert.equal(nodeMajor("9"), 9);
});

test("nodeMajor gives null for a missing or unreadable version", () => {
  assert.equal(nodeMajor(null), null);
  assert.equal(nodeMajor(""), null);
  assert.equal(nodeMajor("lts"), null);
  assert.equal(nodeMajor("22a"), null);
});

test("commandLine joins each step's argv and chains the steps", () => {
  assert.equal(commandLine([["brew", ["install", "agent-browser"]], ["agent-browser", ["install"]]]), "brew install agent-browser && agent-browser install");
  assert.equal(commandLine([]), "");
});

test("installPlan prefers Homebrew, then downloads the browser", () => {
  const plan = installPlan("Darwin", { agentBrowser: false, brew: true, npm: true, node: "24.1.0" });
  assert.equal(plan.via, "brew");
  assert.deepEqual(plan.steps, [["brew", ["install", "agent-browser"]], ["agent-browser", ["install"]]]);
  assert.equal(plan.command, "brew install agent-browser && agent-browser install");
  assert.equal(plan.reason, null);
  assert.equal(plan.hint, null);
});

test("installPlan uses npm without Homebrew when Node.js is 22 or later", () => {
  const plan = installPlan("Darwin", { brew: false, npm: true, node: "22.0.0" });
  assert.equal(plan.via, "npm");
  assert.deepEqual(plan.steps, [["npm", ["install", "-g", "agent-browser"]], ["agent-browser", ["install"]]]);
});

test("needsSudoCheck asks sudo only for a non-root Linux user", () => {
  assert.equal(needsSudoCheck("Linux", { root: false }), true);
  assert.equal(needsSudoCheck("Linux", {}), true);
  assert.equal(needsSudoCheck("Linux", null), true);
  assert.equal(needsSudoCheck("Linux", { root: true }), false);
  assert.equal(needsSudoCheck("Darwin", { root: false }), false);
  assert.equal(needsSudoCheck(null, {}), false);
});

test("installPlan adds the browser's system libraries on Linux for root or when the click-time sudo check passed", () => {
  for (const [tools, sudo] of [[{ brew: true, root: true }, undefined], [{ npm: true, node: "22.1.0", root: false }, true]]) {
    const plan = installPlan("Linux", tools, sudo);
    assert.deepEqual(plan.steps[1], ["agent-browser", ["install", "--with-deps"]]);
    assert.equal(plan.hint, null);
  }
});

test("installPlan downloads only the browser on Linux before or after a failed sudo check, and hints at the libraries step", () => {
  for (const sudo of [undefined, false]) {
    const plan = installPlan("Linux", { brew: true, root: false }, sudo);
    assert.deepEqual(plan.steps, [["brew", ["install", "agent-browser"]], ["agent-browser", ["install"]]]);
    assert.equal(plan.command, "brew install agent-browser && agent-browser install");
    assert.equal(plan.hint, "agent-browser install --with-deps");
  }
  assert.equal(installPlan("Linux", { npm: true, node: "24.0.0" }).hint, "agent-browser install --with-deps");
});

test("installPlan ignores root and sudo outside Linux", () => {
  const plan = installPlan("Darwin", { brew: true, root: true }, true);
  assert.deepEqual(plan.steps[1], ["agent-browser", ["install"]]);
  assert.equal(plan.hint, null);
});

test("installPlan's hand command for a Linux machine without a route keeps the libraries step", () => {
  const plan = installPlan("Linux", {});
  assert.equal(plan.command, "npm install -g agent-browser && agent-browser install --with-deps");
  assert.equal(plan.hint, null);
});

test("installPlan has no route when Node.js is older than 22, and names the version", () => {
  const plan = installPlan("Darwin", { brew: false, npm: true, node: "21.9.0" });
  assert.equal(plan.via, null);
  assert.deepEqual(plan.steps, []);
  assert.match(plan.reason, /Node\.js 21\.9\.0 is older than the 22/);
  assert.equal(plan.command, "npm install -g agent-browser && agent-browser install");
});

test("installPlan has no route without Homebrew or npm, or when the node version is unknown", () => {
  for (const tools of [{ brew: false, npm: false, node: null }, { brew: false, npm: true, node: null }, null]) {
    const plan = installPlan("Darwin", tools);
    assert.equal(plan.via, null);
    assert.match(plan.reason, /Neither Homebrew nor npm with Node\.js 22 or later/);
  }
});

test("installStep numbers the step from one and names its command", () => {
  const plan = installPlan("Darwin", { brew: true });
  assert.deepEqual(installStep(plan, 0), { status: "installing", via: "brew", step: 1, of: 2, label: "brew install agent-browser" });
  assert.deepEqual(installStep(plan, 1), { status: "installing", via: "brew", step: 2, of: 2, label: "agent-browser install" });
});

test("installFailure names the failed command and the steps left to run by hand", () => {
  const plan = installPlan("Darwin", { brew: true });
  assert.deepEqual(installFailure(plan, 0, "no network"), {
    status: "failed", stage: "package", error: "brew install agent-browser failed: no network",
    command: "brew install agent-browser && agent-browser install",
  });
  assert.deepEqual(installFailure(plan, 1, "disk full"), {
    status: "failed", stage: "browser", error: "agent-browser install failed: disk full", command: "agent-browser install",
  });
});

test("installFailure points to sudo or a user-owned prefix when npm cannot write its global folder", () => {
  const plan = installPlan("Darwin", { npm: true, node: "22.0.0" });
  for (const error of ["npm error code EACCES", "npm ERR! Error: EPERM: operation not permitted", "Permission denied"]) {
    const failure = installFailure(plan, 0, error);
    assert.match(failure.error, /npm cannot write to its global folder\. Run the command with sudo, or .*npm config set prefix ~\/\.npm-global/, error);
    assert.equal(failure.command, "npm install -g agent-browser && agent-browser install");
  }
});

test("installFailure adds no npm advice to other failures", () => {
  const npm = installPlan("Darwin", { npm: true, node: "22.0.0" }), brew = installPlan("Darwin", { brew: true });
  assert.doesNotMatch(installFailure(npm, 0, "ETIMEDOUT").error, /global folder/);
  assert.doesNotMatch(installFailure(brew, 0, "Permission denied").error, /global folder/);
  assert.doesNotMatch(installFailure(npm, 1, "Permission denied").error, /global folder/);
});

test("installDone carries the plan's hint", () => {
  assert.deepEqual(installDone(installPlan("Linux", { brew: true })), { status: "installed", hint: "agent-browser install --with-deps" });
  assert.deepEqual(installDone(installPlan("Darwin", { brew: true })), { status: "installed", hint: null });
});

test("outputTail keeps the last lines of stderr, then stdout, then the exit code", () => {
  assert.equal(outputTail({ code: 1, stderr: "a\nb\nc\n", stdout: "x" }, 2), "b\nc");
  assert.equal(outputTail({ code: 1, stderr: "  ", stdout: "only out\n" }), "only out");
  assert.equal(outputTail({ code: 7, stderr: "", stdout: "" }), "exit 7");
});

test("settledInstall keeps a running install whatever the panel shows", () => {
  const installing = { status: "installing" };
  assert.equal(settledInstall({ kind: "running" }, installing), installing);
  assert.equal(settledInstall({ kind: "start" }, installing), installing);
  assert.equal(settledInstall({ kind: "start" }, undefined), null);
});

test("settledInstall drops every finished install once the session runs", () => {
  assert.equal(settledInstall({ kind: "running" }, { status: "failed", stage: "browser" }), null);
  assert.equal(settledInstall({ kind: "running" }, { status: "installed" }), null);
});

test("settledInstall keeps only a browser download failure once agent-browser is found", () => {
  const browser = { status: "failed", stage: "browser" };
  assert.equal(settledInstall({ kind: "start" }, browser), browser);
  assert.equal(settledInstall({ kind: "start" }, { status: "failed", stage: "package" }), null);
  assert.equal(settledInstall({ kind: "start" }, { status: "installed" }), null);
  assert.equal(settledInstall({ kind: "start" }, { status: "installed", hint: null }), null);
});

test("settledInstall keeps a finished install's libraries hint in the start state", () => {
  const hinted = { status: "installed", hint: "agent-browser install --with-deps" };
  assert.equal(settledInstall({ kind: "start" }, hinted), hinted);
  assert.equal(settledInstall({ kind: "running" }, hinted), null);
});

test("settledInstall keeps a finished install while agent-browser is missing or the machine is being checked", () => {
  const installed = { status: "installed" }, failed = { status: "failed", stage: "package" };
  assert.equal(settledInstall({ kind: "missing" }, installed), installed);
  assert.equal(settledInstall({ kind: "missing" }, failed), failed);
  assert.equal(settledInstall({ kind: "looking" }, failed), failed);
  assert.equal(settledInstall({ kind: "unreachable" }, installed), installed);
});
