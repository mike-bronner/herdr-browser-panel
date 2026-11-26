import { test } from "node:test";
import assert from "node:assert/strict";
import { LIST_ARGS, parseListing, completeMachines, sweepPlan, orphans, goneKey } from "../mods/browser/reap.js";

const ok = (doc) => ({ code: 0, stderr: "", stdout: JSON.stringify(doc) });
const sets = (map) => Object.fromEntries([...map].map(([k, v]) => [k, [...v].sort()]));

test("the panel asks Herdr for every terminal, so it can read each one's state", () => {
  assert.deepEqual(LIST_ARGS, ["ls", "--all", "--json"]);
});

test("parseListing groups live terminal ids by machine, for this computer and connected machines only", () => {
  const listing = parseListing(ok({
    machines: [{ name: "build_box", state: "connected" }, { name: "lab", state: "disconnected" }, { name: "", state: "connected" }, { state: "connected" }],
    terminals: [{ address: "t1", state: "live" }, { address: "t3" }, { address: "build_box/t1" }, { address: "lab/t4" }, { address: "elsewhere/t5" }],
  }));
  assert.deepEqual(sets(listing), { "": ["t1", "t3"], build_box: ["t1"] });
});

test("parseListing counts a finished terminal as gone, here and on a remote machine", () => {
  const listing = parseListing(ok({
    machines: [{ name: "build_box", state: "connected" }],
    terminals: [
      { address: "t1", state: "live" }, { address: "t2", state: "finished", reason: "killed", rm: false },
      { address: "t3", state: "starting" }, { address: "build_box/t1", state: "finished" }, { address: "build_box/t2", state: "live" },
    ],
  }));
  assert.deepEqual(sets(listing), { "": ["t1", "t3"], build_box: ["t2"] });
});

test("parseListing still refuses a finished entry with no address", () => {
  assert.equal(parseListing(ok({ machines: [], terminals: [{ address: "t1", state: "live" }, { state: "finished" }] })), null);
});

test("parseListing lists this computer with no terminals when it has none", () => {
  assert.deepEqual(sets(parseListing(ok({ machines: [], terminals: [] }))), { "": [] });
});

test("parseListing gives no listing for a failed, unreadable or partial answer", () => {
  assert.equal(parseListing({ code: 1, stdout: ok({ machines: [], terminals: [] }).stdout, stderr: "" }), null);
  assert.equal(parseListing({ code: 0, stdout: "nope", stderr: "" }), null);
  assert.equal(parseListing(ok({ machines: [] })), null);
  assert.equal(parseListing(ok({ terminals: [] })), null);
  assert.equal(parseListing(ok({ machines: [], terminals: [{ address: "t1" }, { address: "" }] })), null);
  assert.equal(parseListing(ok({ machines: [], terminals: [null] })), null);
  assert.equal(parseListing(undefined), null);
});

const listing = () => new Map([["", new Set(["t1"])], ["build_box", new Set(["t1", "t2"])]]);
const bothReady = [{ name: null, layout: "ready" }, { name: "build_box", layout: "ready" }];

test("completeMachines keeps only machines whose Herdr layout is ready", () => {
  assert.deepEqual(sets(completeMachines(listing(), bothReady, [], [])), { "": ["t1"], build_box: ["t1", "t2"] });
  assert.deepEqual(sets(completeMachines(listing(), [{ name: null, layout: "ready" }, { name: "build_box", layout: "loading" }], [], [])), { "": ["t1"] });
  assert.deepEqual(sets(completeMachines(listing(), [{ name: null, layout: "unavailable" }, { name: "build_box", layout: "ready" }], [], [])), { build_box: ["t1", "t2"] });
  assert.deepEqual(sets(completeMachines(listing(), undefined, [], [])), {});
  assert.deepEqual(sets(completeMachines(null, bothReady, [], [])), {});
});

test("completeMachines drops a machine with a pane whose terminal the listing lacks", () => {
  const spaces = [{ id: "s1", machine: null, tabs: [{ id: "a1" }] }, { id: "build_box/s1", machine: "build_box", tabs: [{ id: "build_box/a1" }] }];
  const panes = [{ terminal: "t1", tab: "a1" }, { terminal: "build_box/t3", tab: "build_box/a1" }, { terminal: null, tab: "a1" }, { terminal: "", tab: "a1" }];
  assert.deepEqual(sets(completeMachines(listing(), bothReady, panes, spaces)), { "": ["t1"] });
  assert.deepEqual(sets(completeMachines(listing(), bothReady, [{ terminal: "t2", tab: "build_box/a1" }], spaces)), { "": ["t1"], build_box: ["t1", "t2"] });
  assert.deepEqual(sets(completeMachines(listing(), bothReady, [{ terminal: "t2", tab: "a1" }], spaces)), { build_box: ["t1", "t2"] });
});

test("completeMachines drops a machine with a pane whose terminal is listed as finished", () => {
  const finished = parseListing(ok({ machines: [], terminals: [{ address: "t1", state: "live" }, { address: "t2", state: "finished" }] }));
  const spaces = [{ id: "s1", machine: null, tabs: [{ id: "a1" }] }];
  assert.deepEqual(sets(completeMachines(finished, [{ name: null, layout: "ready" }], [{ terminal: "t2", tab: "a1" }], spaces)), {});
  assert.deepEqual(sets(completeMachines(finished, [{ name: null, layout: "ready" }], [{ terminal: "t1", tab: "a1" }], spaces)), { "": ["t1"] });
});

test("completeMachines trusts no machine when a pane's machine cannot be told", () => {
  assert.deepEqual(sets(completeMachines(listing(), bothReady, [{ terminal: "t1", tab: "gone" }], [])), {});
});

test("sweepPlan sweeps a machine on its second complete look, then only when a terminal is gone on two looks in a row", () => {
  const ids = (...a) => new Map([["", new Set(a)]]);
  let plan = sweepPlan(new Map(), ids("t1", "t2"));
  assert.deepEqual(plan.due, []);
  assert.equal(plan.known.get("").swept, false);
  plan = sweepPlan(plan.known, ids("t1", "t2"));
  assert.deepEqual(plan.due, [""]);
  assert.equal(plan.known.get("").swept, true);
  plan = sweepPlan(plan.known, ids("t1", "t2", "t3"));
  assert.deepEqual(plan.due, []);
  plan = sweepPlan(plan.known, ids("t1"));
  assert.deepEqual(plan.due, []);
  assert.deepEqual([...plan.known.get("").held].sort(), ["t1", "t2", "t3"]);
  plan = sweepPlan(plan.known, ids("t1"));
  assert.deepEqual(plan.due, [""]);
  assert.deepEqual([...plan.known.get("").held], ["t1"]);
  plan = sweepPlan(plan.known, new Map());
  assert.deepEqual([...plan.known.keys()], []);
  plan = sweepPlan(plan.known, ids("t1"));
  assert.deepEqual(plan.due, []);
});

test("sweepPlan does not sweep for a terminal that is gone on one look and back on the next", () => {
  const ids = (...a) => new Map([["", new Set(a)]]);
  let plan = sweepPlan(new Map(), ids("t1", "t2"));
  plan = sweepPlan(plan.known, ids("t1", "t2"));
  plan = sweepPlan(plan.known, ids("t1"));
  assert.deepEqual(plan.due, []);
  plan = sweepPlan(plan.known, ids("t1", "t2"));
  assert.deepEqual(plan.due, []);
  plan = sweepPlan(plan.known, ids("t1"));
  assert.deepEqual(plan.due, []);
});

test("orphans names each herdr-<id> session whose terminal is not listed, once", () => {
  const sessions = [
    { session: "herdr-t1", namespace: null }, { session: "herdr-t9", namespace: null }, { session: "herdr-t9", namespace: null },
    { session: "herdr-t8", namespace: "qa" }, { session: "notes", namespace: null }, { session: "herdr-", namespace: null },
    { session: "herdr-t1/x", namespace: null }, { session: "my-herdr-t7", namespace: null }, null,
  ];
  assert.deepEqual(orphans(sessions, new Set(["t1"])), ["herdr-t9"]);
  assert.deepEqual(orphans(undefined, new Set()), []);
});

test("goneKey names a terminal by machine and id", () => {
  assert.equal(goneKey(null, "t6"), "|t6");
  assert.equal(goneKey("", "t6"), "|t6");
  assert.equal(goneKey("build_box", "t6"), "build_box|t6");
});
