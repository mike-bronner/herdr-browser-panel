import { test } from "node:test";
import assert from "node:assert/strict";
import { panelIds } from "../mods/tabs-browser/panels.js";

const stack = (...ids) => ({ id: "panel-body", type: "stack", children: ids.map((id) => ({ id, type: "block" })) });

test("panelIds adds browser after the picked panels when panel-body holds a browser child", () => {
  assert.deepEqual(panelIds(["files", "changes"], stack("files", "changes", "browser")), ["files", "changes", "browser"]);
  assert.deepEqual(panelIds(["changes"], stack("files", "changes", "browser")), ["changes", "browser"]);
});

test("panelIds keeps the picked panels as they are when panel-body has no browser child", () => {
  assert.deepEqual(panelIds(["files", "changes"], stack("files", "changes")), ["files", "changes"]);
  assert.deepEqual(panelIds([], stack("files", "changes")), []);
});

test("panelIds drops a picked browser that panel-body cannot show", () => {
  assert.deepEqual(panelIds(["files", "browser", "changes"], stack("files", "changes")), ["files", "changes"]);
});

test("panelIds lists browser once when it is picked and present", () => {
  assert.deepEqual(panelIds(["browser", "files"], stack("files", "browser")), ["files", "browser"]);
});

test("panelIds shows no browser without a panel-body stack", () => {
  for (const body of [null, undefined, { id: "panel-body", type: "column", children: [{ id: "browser" }] }, { id: "panel-body", type: "stack" }]) {
    assert.deepEqual(panelIds(["files", "changes"], body), ["files", "changes"]);
  }
});
