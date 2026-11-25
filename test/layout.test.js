import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { addBrowser } from "../tools/layout.js";

const layout = () => ({
  id: "root",
  type: "column",
  children: [{
    id: "work",
    type: "column",
    children: [
      { id: "tabs", type: "block", size: { px: 42 }, window_drag: true, content: { mod: "tabs" } },
      {
        id: "work-body",
        type: "row",
        children: [
          { id: "main", type: "block", content: { tab: "active" } },
          {
            id: "panel",
            type: "column",
            hidden: true,
            children: [{
              id: "panel-body",
              type: "stack",
              active: "changes",
              children: [
                { id: "files", type: "block", content: { mod: "files" } },
                { id: "changes", type: "block", content: { mod: "changes" } },
              ],
            }],
          },
        ],
      },
    ],
  }],
});

const at = (root, id) => root.id === id ? root : (root.children ?? []).map((child) => at(child, id)).find(Boolean);

test("addBrowser points the tabs block at the clone and keeps its other fields", () => {
  const tabs = at(addBrowser(layout()), "tabs");
  assert.deepEqual(tabs, { id: "tabs", type: "block", size: { px: 42 }, window_drag: true, content: { mod: "tabs-browser" } });
});

test("addBrowser appends a browser block after files and changes and keeps the stack's state", () => {
  const body = at(addBrowser(layout()), "panel-body");
  assert.deepEqual(body.children.map((child) => child.id), ["files", "changes", "browser"]);
  assert.deepEqual(body.children[2], { id: "browser", type: "block", content: { mod: "browser" } });
  assert.equal(body.active, "changes");
});

test("addBrowser leaves its input untouched", () => {
  const input = layout();
  addBrowser(input);
  assert.deepEqual(input, layout());
});

test("addBrowser applied twice changes nothing more", () => {
  const once = addBrowser(layout());
  assert.deepEqual(addBrowser(once), once);
});

test("addBrowser refuses a layout without a tabs block", () => {
  const input = layout();
  at(input, "tabs").content.mod = "terminals-bar";
  assert.throws(() => addBrowser(input), /no tabs block/);
});

test("addBrowser refuses a layout without a panel-body stack", () => {
  const missing = layout();
  at(missing, "panel").children = [];
  assert.throws(() => addBrowser(missing), /no panel-body stack/);
  const column = layout();
  at(column, "panel-body").type = "column";
  assert.throws(() => addBrowser(column), /no panel-body stack/);
});

test("addBrowser refuses a browser child that is not the browser mod's block", () => {
  const input = layout();
  at(input, "panel-body").children.push({ id: "browser", type: "block", content: { mod: "agent-browser" } });
  assert.throws(() => addBrowser(input), /not the browser mod's block/);
});

test("addBrowser refuses a layout that uses the id browser outside panel-body", () => {
  const input = layout();
  at(input, "work-body").children.push({ id: "browser", type: "block", content: { mod: "browser" } });
  assert.throws(() => addBrowser(input), /id browser outside panel-body/);
});

const script = fileURLToPath(new URL("../tools/add-browser.js", import.meta.url));
const scratch = (t, name) => {
  const dir = mkdtempSync(join(tmpdir(), "add-browser-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, name);
};

test("add-browser prints the changed layout and leaves the file as it was", (t) => {
  const file = scratch(t, "mine.json");
  const text = JSON.stringify(layout(), null, 2) + "\n";
  writeFileSync(file, text);
  const out = JSON.parse(execFileSync(process.execPath, [script, file], { encoding: "utf8" }));
  assert.deepEqual(out, addBrowser(layout()));
  assert.equal(readFileSync(file, "utf8"), text);
});

test("add-browser exits nonzero with the reason and prints no layout when it refuses", (t) => {
  const file = scratch(t, "bad.json");
  writeFileSync(file, JSON.stringify({ id: "root", type: "column", children: [] }));
  const run = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /no tabs block/);
});

test("addBrowser points every tabs block at the clone and adds one browser block", () => {
  const input = layout();
  at(input, "work").children.push({ id: "tabs-2", type: "block", content: { mod: "tabs" } }, { id: "tabs-3", type: "block", content: { mod: "tabs-browser" } });
  const out = addBrowser(input);
  assert.equal(at(out, "tabs").content.mod, "tabs-browser");
  assert.equal(at(out, "tabs-2").content.mod, "tabs-browser");
  assert.equal(at(out, "tabs-3").content.mod, "tabs-browser");
  assert.equal(at(out, "panel-body").children.filter((child) => child.id === "browser").length, 1);
});

test("addBrowser gives a panel-body stack without children the browser block", () => {
  const input = layout();
  delete at(input, "panel-body").children;
  assert.deepEqual(at(addBrowser(input), "panel-body").children, [{ id: "browser", type: "block", content: { mod: "browser" } }]);
});

test("addBrowser refuses a second browser id beside a valid browser child", () => {
  const elsewhere = addBrowser(layout());
  at(elsewhere, "work-body").children.push({ id: "browser", type: "block", content: { mod: "browser" } });
  assert.throws(() => addBrowser(elsewhere), /id browser more than once/);
  const twice = addBrowser(layout());
  at(twice, "panel-body").children.push({ id: "browser", type: "block", content: { mod: "browser" } });
  assert.throws(() => addBrowser(twice), /id browser more than once/);
});

test("add-browser prints usage and exits 2 without a layout path", () => {
  const run = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /^usage:/);
});

test("add-browser exits 1 and names the file when it cannot read or parse it", (t) => {
  const missing = scratch(t, "missing.json");
  const broken = scratch(t, "broken.json");
  writeFileSync(broken, "{not json");
  for (const file of [missing, broken]) {
    const run = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
    assert.equal(run.status, 1, file);
    assert.equal(run.stdout, "", file);
    assert.ok(run.stderr.startsWith(`${file}: `), run.stderr);
  }
});
