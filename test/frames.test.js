import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const element = "const el = (kind, arg) => { const calls = []; const e = new Proxy({ kind, arg, calls, children: [] }, { get(t, name) { if (name in t) return t[name]; return (...a) => { if (name === 'child') t.children.push(a[0]); calls.push([name, ...a]); return e; }; } }); return e; };";
const stubs = {
  "gpui-kit": `${element} export const div = () => el('div'); export const image = (path) => el('image', path);`,
  herdr: "export const appHome = () => globalThis.framesHome; export const watchFolder = () => new Promise(() => {});",
};
const hooks = `const stubs = ${JSON.stringify(stubs)};
export async function resolve(specifier, context, next) {
  if (Object.hasOwn(stubs, specifier)) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]), shortCircuit: true };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
const { Frames } = await import("../mods/browser/frames.js");
const { pictureOf, drawPlan } = await import("../mods/browser/page.js");

before(async () => { globalThis.framesHome = await mkdtemp(join(tmpdir(), "frames-test-")); });
after(async () => { await rm(globalThis.framesHome, { recursive: true, force: true }); });

const cx = () => ({ notify() {}, sleep: async () => {}, spawn() {} });
const call = (e, name) => e.calls.find((c) => c[0] === name)?.slice(1);
const stale = pictureOf({ width: 361, height: 887 }, { deviceWidth: 361, deviceHeight: 1228 });

test("view draws a stale frame clipped to its page region, with the image scaled past it", async () => {
  const frames = new Frames("v");
  assert.equal(await frames.push(Buffer.from([1]), cx(), () => {}, stale), true);
  const box = { width: 361, height: 1228 };
  const plan = drawPlan(stale, box);
  const [outer] = frames.view(box);
  assert.deepEqual([call(outer, "left"), call(outer, "top"), call(outer, "w"), call(outer, "h")], [[plan.left], [plan.top], [plan.width], [plan.height]]);
  assert.ok(call(outer, "overflow_hidden"));
  const [inner] = outer.children;
  assert.deepEqual([call(inner, "w"), call(inner, "h")], [[plan.imageWidth], [plan.imageHeight]]);
  assert.equal(inner.children[0].kind, "image");
  frames.clear();
});

test("view falls back to filling the box when the picture or the box is missing", async () => {
  const frames = new Frames("f");
  await frames.push(Buffer.from([1]), cx(), () => {}, null);
  await frames.push(Buffer.from([2]), cx(), () => {}, stale);
  for (const [box, count] of [[{ width: 361, height: 1228 }, 1], [null, 2]]) {
    const views = frames.view(box);
    const fallback = views.filter((v) => call(v, "inset_0"));
    assert.equal(fallback.length, count, JSON.stringify(box));
    for (const v of fallback) assert.equal(call(v, "left"), undefined);
  }
  frames.clear();
});

test("keepAlive repeats the last frame with its picture", async () => {
  const frames = new Frames("k");
  await frames.push(Buffer.from([1]), cx(), () => {}, stale);
  frames.lastAt = Date.now() - 1000;
  await frames.keepAlive(cx(), 500);
  assert.equal(frames.shown.length, 2);
  assert.equal(frames.shown.at(-1).picture, stale);
  frames.clear();
});
