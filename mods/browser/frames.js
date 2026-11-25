import { image, div } from "gpui-kit";
import { appHome, watchFolder } from "herdr";
import { drawPlan } from "./page.js";
import { writeFile, unlink, mkdir, readdir } from "fs/promises";

export const FOLDER = "mods/browser-frames";
const AFTER_REPORT_MS = 100;
const MAX_HOLD_MS = 500;
const SETTLE_MS = 300;
const MAX_LAYERS = 8;
const abs = (rel) => `${appHome()}/${rel}`;
const stamp = (name) => parseInt(name.split("-").at(-2) ?? "", 36);
const TAG = "CACHEDIR.TAG";

function reported(name, cx) {
  let done = false;
  const heard = (async () => {
    while (!done) {
      const paths = await watchFolder(abs(FOLDER));
      if (paths.some((p) => p.endsWith(`/${name}`) || p.endsWith(`/${FOLDER}`))) return;
    }
  })().catch(() => cx.sleep(MAX_HOLD_MS));
  return Promise.race([heard, cx.sleep(MAX_HOLD_MS)]).finally(() => { done = true; });
}

export async function sweep(maxAgeMs) {
  try {
    await mkdir(abs(FOLDER), { recursive: true }).catch(() => {});
    const names = await readdir(abs(FOLDER));
    if (!names.includes(TAG)) await writeFile(abs(`${FOLDER}/${TAG}`), "Signature: 8a477f597d28d172789f06886806bc55\n# live page pictures from the browser Herdr mod\n");
    const now = Date.now();
    for (const name of names) {
      if (name === TAG) continue;
      const t = stamp(name);
      if (!Number.isFinite(t) || now - t > maxAgeMs) await unlink(abs(`${FOLDER}/${name}`)).catch(() => {});
    }
  } catch {}
}

export class Frames {
  constructor(prefix) {
    this.prefix = prefix;
    this.seq = 0;
    this.shownSeq = 0;
    this.shown = [];
    this.last = null;
    this.lastPicture = null;
    this.lastAt = 0;
    this.cleared = false;
  }

  async push(bytes, cx, written = () => {}, picture = null) {
    const seq = ++this.seq;
    const name = `${this.prefix}-${Date.now().toString(36)}-${seq}.jpg`;
    const rel = `${FOLDER}/${name}`;
    const heard = reported(name, cx);
    try {
      await mkdir(abs(FOLDER), { recursive: true }).catch(() => {});
      await writeFile(abs(rel), bytes);
    } catch {
      return false;
    } finally {
      written();
    }
    this.last = bytes;
    this.lastPicture = picture;
    this.lastAt = Date.now();
    await heard;
    await cx.sleep(AFTER_REPORT_MS);
    if (this.cleared || seq < this.shownSeq || this.shown.length >= MAX_LAYERS) {
      unlink(abs(rel)).catch(() => {});
      return false;
    }
    this.shownSeq = seq;
    this.shown.push({ rel, at: Date.now(), picture });
    cx.notify();
    this.trim();
    cx.spawn(async (cx) => {
      await cx.sleep(SETTLE_MS);
      this.trim();
    });
    return true;
  }

  trim() {
    const now = Date.now();
    while (this.shown.length > 1 && now - this.shown[1].at >= SETTLE_MS) {
      unlink(abs(this.shown.shift().rel)).catch(() => {});
    }
  }

  async keepAlive(cx, olderThanMs) {
    if (this.last && Date.now() - this.lastAt > olderThanMs) await this.push(this.last, cx, () => {}, this.lastPicture);
  }

  get empty() {
    return this.shown.length === 0;
  }

  view(box) {
    return this.shown.map(({ rel, picture }) => {
      const plan = drawPlan(picture, box);
      if (!plan) return div().id(rel).absolute().inset_0().child(image(rel).size_full());
      return div().id(rel).absolute().left(plan.left).top(plan.top).w(plan.width).h(plan.height).overflow_hidden()
        .child(div().absolute().left(0).top(0).w(plan.imageWidth).h(plan.imageHeight).child(image(rel).size_full()));
    });
  }

  clear() {
    this.cleared = true;
    for (const { rel } of this.shown) unlink(abs(rel)).catch(() => {});
    this.shown = [];
    this.last = null;
  }
}
