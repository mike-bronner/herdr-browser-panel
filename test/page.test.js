import { test } from "node:test";
import assert from "node:assert/strict";
import { slug, normalizeUrl, jpegSize, pictureOf, drawPlan, toPage, cdpModifiers, keyMessages, textMessages, mouseMessage, wheelMessage, followUrl, sshFor, tunnelArgs, viewportFor, resizeStep, retryDelay, addressAtRest, pageTitle } from "../mods/browser/page.js";

test("slug keeps only lowercase letters, digits and dashes", () => {
  const s = slug("build_box|build_box/t6|77|4321");
  assert.match(s, /^[a-z0-9-]+$/);
  assert.notEqual(s, slug("build_box|build_box/t6|77|4322"));
});

test("normalizeUrl adds https to a bare host and keeps a known scheme", () => {
  assert.equal(normalizeUrl(" example.com/a "), "https://example.com/a");
  for (const url of ["http://x.test/", "HTTPS://x.test", "about:blank", "data:text/plain,hi", "file:///tmp/a", "chrome://version"]) assert.equal(normalizeUrl(url), url);
});

test("normalizeUrl gives nothing for empty input", () => {
  for (const v of ["", "   ", null, undefined]) assert.equal(normalizeUrl(v), null, String(v));
});

test("normalizeUrl treats an unknown scheme as a host", () => {
  assert.equal(normalizeUrl("javascript:alert(1)"), "https://javascript:alert(1)");
});

function jpeg(width, height) {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0, 0, 0, 0]);
}

test("jpegSize reads the frame header after other segments", () => {
  assert.deepEqual(jpegSize(jpeg(1280, 720)), { width: 1280, height: 720 });
});

test("jpegSize gives null for bytes without a frame header", () => {
  assert.equal(jpegSize(Uint8Array.from([0xff, 0xd8, 0x00, 0x01, 0x02])), null);
});

const meta = (w, h) => ({ deviceWidth: w, deviceHeight: h });

test("pictureOf takes the page size from the metadata, and a frame of the whole page at full size is clean", () => {
  assert.deepEqual(pictureOf({ width: 361, height: 1228 }, meta(361, 1228)),
    { page: { width: 361, height: 1228 }, frame: { width: 361, height: 1228 }, crop: { width: 361, height: 1228 }, clean: true });
  const sharp = pictureOf({ width: 722, height: 2456 }, meta(361, 1228));
  assert.deepEqual([sharp.page, sharp.crop, sharp.clean], [{ width: 361, height: 1228 }, { width: 722, height: 2456 }, true]);
});

test("pictureOf finds the page in the top left of a frame of Chrome's 500 px window, and marks it stale", () => {
  const p = pictureOf({ width: 361, height: 887 }, meta(361, 1228));
  assert.deepEqual(p.page, { width: 361, height: 1228 });
  assert.ok(Math.abs(p.crop.width - 260.75) < 0.01 && p.crop.height === 887, JSON.stringify(p.crop));
  assert.equal(p.clean, false);
  const sharp = pictureOf({ width: 1000, height: 2456 }, meta(361, 1228));
  assert.deepEqual([sharp.crop, sharp.clean], [{ width: 722, height: 2456 }, false]);
});

test("pictureOf counts a frame shrunk by the stream cap as clean, since it is the whole page", () => {
  const p = pictureOf({ width: 261, height: 887 }, meta(361, 1228));
  assert.ok(p.frame.width - p.crop.width <= 1);
  assert.equal(p.clean, true);
});

test("pictureOf uses the frame itself without metadata, and gives nothing without a frame size", () => {
  assert.deepEqual(pictureOf({ width: 800, height: 600 }, {}), { page: { width: 800, height: 600 }, frame: { width: 800, height: 600 }, crop: { width: 800, height: 600 }, clean: true });
  assert.equal(pictureOf({ width: 800, height: 600 }).clean, true);
  for (const m of [meta(Infinity, 600), meta(800, Infinity), { deviceWidth: "800", deviceHeight: "600" }, meta(-800, 600), meta(NaN, 600)]) {
    assert.deepEqual(pictureOf({ width: 400, height: 300 }, m).page, { width: 400, height: 300 }, JSON.stringify(m));
  }
  for (const size of [null, undefined, { width: 0, height: 600 }, { width: 800 }]) assert.equal(pictureOf(size, meta(800, 600)), null, JSON.stringify(size));
});

const near = (a, b) => Object.keys(b).every((k) => Math.abs(a[k] - b[k]) < 0.01);

test("drawPlan draws a clean frame over the whole box at either scale", () => {
  const box = { width: 361, height: 1228 };
  const whole = { left: 0, top: 0, width: 361, height: 1228, imageWidth: 361, imageHeight: 1228 };
  assert.ok(near(drawPlan(pictureOf({ width: 361, height: 1228 }, meta(361, 1228)), box), whole));
  assert.ok(near(drawPlan(pictureOf({ width: 722, height: 2456 }, meta(361, 1228)), box), whole));
});

test("drawPlan scales a stale frame up so its page part fills the box and the window strip falls outside it", () => {
  const plan = drawPlan(pictureOf({ width: 361, height: 887 }, meta(361, 1228)), { width: 361, height: 1228 });
  assert.ok(near(plan, { left: 0, top: 0, width: 361, height: 1228, imageWidth: 361 * 1228 / 887, imageHeight: 1228 }), JSON.stringify(plan));
});

test("drawPlan centres the page in a box of another shape, as toPage maps it", () => {
  const plan = drawPlan(pictureOf({ width: 800, height: 400 }, meta(800, 400)), { width: 400, height: 400 });
  assert.ok(near(plan, { left: 0, top: 100, width: 400, height: 200, imageWidth: 400, imageHeight: 200 }), JSON.stringify(plan));
  assert.deepEqual(toPage({ x: 0, y: 100 }, { width: 400, height: 400 }, 800, 400), { x: 0, y: 0 });
});

test("a click on a stale frame's drawing lands on the page point drawn under it", () => {
  const box = { width: 361, height: 1228 };
  const picture = pictureOf({ width: 361, height: 887 }, meta(361, 1228));
  const plan = drawPlan(picture, box);
  const at = { x: 180, y: 614 };
  const framePx = { x: (at.x - plan.left) * picture.frame.width / plan.imageWidth, y: (at.y - plan.top) * picture.frame.height / plan.imageHeight };
  const s = picture.crop.width / picture.page.width;
  assert.deepEqual(toPage(at, box, picture.page.width, picture.page.height), { x: Math.round(framePx.x / s), y: Math.round(framePx.y / s) });
  assert.equal(drawPlan(picture, null), null);
  assert.equal(drawPlan(null, box), null);
});

const bounds = { width: 400, height: 400 };

test("toPage maps a point through the letterboxed picture", () => {
  assert.deepEqual(toPage({ x: 200, y: 200 }, bounds, 800, 400), { x: 400, y: 200 });
  assert.deepEqual(toPage({ x: 0, y: 100 }, bounds, 800, 400), { x: 0, y: 0 });
});

test("toPage gives null in the letterbox unless clamped to the page edge", () => {
  assert.equal(toPage({ x: 200, y: 50 }, bounds, 800, 400), null);
  assert.deepEqual(toPage({ x: 200, y: 50 }, bounds, 800, 400, true), { x: 400, y: 0 });
});

test("toPage gives null without a size to map through", () => {
  assert.equal(toPage({ x: 1, y: 1 }, { width: 0, height: 10 }, 800, 400), null);
  assert.equal(toPage(undefined, bounds, 800, 400), null);
  assert.equal(toPage({ x: 1, y: 1 }, bounds, 0, 400), null);
});

test("cdpModifiers keeps Command as Meta on a Mac browser", () => {
  assert.equal(cdpModifiers({ platform: true, shift: true }, "Darwin"), 4 | 8);
});

test("cdpModifiers turns Command into Control on a Linux browser", () => {
  assert.equal(cdpModifiers({ platform: true, alt: true }, "Linux"), 2 | 1);
  assert.equal(cdpModifiers(null, "Linux"), 0);
});

test("keyMessages types a character with its code", () => {
  const [down, up] = keyMessages({ key: "a", key_char: "A", modifiers: { shift: true } }, "Darwin");
  assert.deepEqual(down, { type: "input_keyboard", eventType: "keyDown", key: "A", text: "A", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 8 });
  assert.deepEqual(up, { type: "input_keyboard", eventType: "keyUp", key: "A", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 8 });
});

test("keyMessages sends a named key, with text only when it types", () => {
  assert.equal(keyMessages({ key: "enter", modifiers: {} }, "Darwin")[0].text, "\r");
  assert.equal(keyMessages({ key: "backspace", modifiers: {} }, "Darwin")[0].eventType, "rawKeyDown");
});

test("keyMessages sends a shortcut as a raw key without text", () => {
  const [down] = keyMessages({ key: "a", key_char: "a", modifiers: { platform: true } }, "Linux");
  assert.equal(down.eventType, "rawKeyDown");
  assert.equal(down.text, undefined);
  assert.equal(down.modifiers, 2);
});

test("keyMessages sends nothing for a key it cannot name", () => {
  assert.deepEqual(keyMessages({ key: "f13", modifiers: {} }, "Darwin"), []);
});

test("textMessages types each character and turns a newline into Enter", () => {
  assert.deepEqual(textMessages("a\n").map((m) => m.text), ["a", "\r"]);
  assert.equal(textMessages("abc", 2).length, 2);
  assert.deepEqual(textMessages(undefined), []);
});

const page = { width: 800, height: 400 };

test("mouseMessage maps a press onto the page with a click count", () => {
  assert.deepEqual(mouseMessage({ local_position: { x: 200, y: 200 }, bounds, click_count: 2, modifiers: {} }, "mousePressed", "left", page, "Darwin", null),
    { type: "input_mouse", eventType: "mousePressed", x: 400, y: 200, button: "left", modifiers: 0, clickCount: 2 });
});

test("mouseMessage sends a move without a click count", () => {
  const msg = mouseMessage({ local_position: { x: 200, y: 200 }, bounds }, "mouseMoved", "none", page, "Darwin", null);
  assert.equal("clickCount" in msg, false);
});

test("mouseMessage drops a press in the letterbox but clamps a release and a drag", () => {
  const e = { local_position: { x: 200, y: 50 }, bounds };
  assert.equal(mouseMessage(e, "mousePressed", "left", page, "Darwin", null), null);
  assert.equal(mouseMessage(e, "mouseMoved", "none", page, "Darwin", null), null);
  assert.deepEqual([mouseMessage(e, "mouseReleased", "left", page, "Darwin", null).y, mouseMessage(e, "mouseMoved", "left", page, "Darwin", "left").y], [0, 0]);
});

test("mouseMessage sends nothing before the first frame gives a page size", () => {
  assert.equal(mouseMessage({ local_position: { x: 1, y: 1 }, bounds }, "mousePressed", "left", null, "Darwin", null), null);
});

test("wheelMessage turns GPUI's wheel direction into the page's", () => {
  assert.deepEqual(wheelMessage({ local_position: { x: 200, y: 200 }, bounds, delta: { x: 3, y: -40 }, modifiers: {} }, page, "Darwin"),
    { type: "input_mouse", eventType: "mouseWheel", x: 400, y: 200, deltaX: -6, deltaY: 80, modifiers: 0 });
});

test("wheelMessage scales the scroll distance by the drawing scale, so the page follows the pointer", () => {
  const area = { width: 250, height: 500 };
  const msg = wheelMessage({ local_position: { x: 125, y: 250 }, bounds: area, delta: { x: 5, y: -40 }, modifiers: {} }, { width: 500, height: 1000 }, "Darwin");
  assert.deepEqual([msg.x, msg.y, msg.deltaX, msg.deltaY], [250, 500, -10, 80]);
});

test("wheelMessage divides the scroll distance by the drawing scale at every scale", () => {
  const at = (bounds) => {
    const msg = wheelMessage({ local_position: { x: bounds.width / 2, y: bounds.height / 2 }, bounds, delta: { x: 3, y: -40 }, modifiers: {} }, page, "Darwin");
    return [msg.deltaX, msg.deltaY];
  };
  assert.deepEqual(at({ width: 800, height: 400 }), [-3, 40]);
  assert.deepEqual(at({ width: 200, height: 100 }), [-12, 160]);
});

test("wheelMessage sends nothing outside the page or without one", () => {
  assert.equal(wheelMessage({ local_position: { x: 200, y: 50 }, bounds, delta: { x: 0, y: 1 } }, page, "Darwin"), null);
  assert.equal(wheelMessage({ local_position: { x: 200, y: 200 }, bounds, delta: { x: 0, y: 1 } }, null, "Darwin"), null);
});

test("followUrl moves the address field to the page's new address", () => {
  assert.equal(followUrl("https://a.test/", "https://a.test/", "https://b.test/"), "https://b.test/");
  assert.equal(followUrl("", "", "https://b.test/"), "https://b.test/");
});

test("followUrl leaves the field alone while it is being edited or already current", () => {
  assert.equal(followUrl("https://typing", "https://a.test/", "https://b.test/"), null);
  assert.equal(followUrl("https://b.test/", "https://b.test/", "https://b.test/"), null);
  assert.equal(followUrl("", "", null), null);
});

test("sshFor gives the machine's own ssh target", () => {
  assert.equal(sshFor({ name: "build_box", target: "user@203.0.113.5", via: false }), "user@203.0.113.5");
});

test("sshFor refuses a machine reached through a command or with no usable target", () => {
  for (const m of [{ name: "a", target: "x", via: true }, { name: "b", target: "" }, { name: "c" }, { name: "d", target: "-oProxyCommand=x" }, null]) {
    assert.throws(() => sshFor(m), /not reached by a plain ssh target/);
  }
});

test("tunnelArgs forwards loopback to loopback on a connection of its own", () => {
  const argv = tunnelArgs("user@host", 24000, 4321, "/logs/ssh.log");
  assert.equal(argv[0], "ssh");
  assert.equal(argv[argv.indexOf("-L") + 1], "127.0.0.1:24000:127.0.0.1:4321");
  for (const opt of ["ControlPath=none", "BatchMode=yes", "ExitOnForwardFailure=yes"]) assert.ok(argv.includes(opt), opt);
  assert.deepEqual(argv.slice(-4), ["--", "user@host", "sleep", "30"]);
});

test("tunnelArgs refuses a port that is not a whole number in range", () => {
  for (const [local, remote] of [[0, 4321], [24000, 70000], [24000, "4321"], [24000, null], [1.5, 4321]]) {
    assert.throws(() => tunnelArgs("h", local, remote, "/l"), /not a port/, `${local} ${remote}`);
  }
});

test("cdpModifiers keeps a real Control as Control on a Mac browser", () => {
  assert.equal(cdpModifiers({ control: true }, "Darwin"), 2);
});

test("cdpModifiers keeps Command as Meta when the browser's OS is unknown", () => {
  assert.equal(cdpModifiers({ platform: true }, undefined), 4);
});

test("keyMessages sends a named key with a shortcut held as a raw key without text", () => {
  const [down] = keyMessages({ key: "enter", modifiers: { control: true } }, "Darwin");
  assert.equal(down.eventType, "rawKeyDown");
  assert.equal("text" in down, false);
});

test("keyMessages gives a digit its Digit code and key code", () => {
  const [down] = keyMessages({ key: "1", key_char: "1", modifiers: {} }, "Darwin");
  assert.equal(down.code, "Digit1");
  assert.equal(down.windowsVirtualKeyCode, 49);
});

test("jpegSize skips a Huffman table segment before the frame header", () => {
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xc4, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00, 0x03, 0, 0, 0, 0]);
  assert.deepEqual(jpegSize(bytes), { width: 1280, height: 720 });
});

test("jpegSize gives null for a long buffer with no frame header", () => {
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xe1, 0x00, 0x04, 0x00, 0x00, 0xff, 0xfe, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.ok(bytes.length >= 20);
  assert.equal(jpegSize(bytes), null);
});

test("sshFor refuses a target that is not a string", () => {
  assert.throws(() => sshFor({ name: "e", target: 42 }), /not reached by a plain ssh target/);
});

test("viewportFor takes the picture area in whole CSS pixels, at any width, at scale 1", () => {
  assert.deepEqual(viewportFor({ width: 489.5, height: 1000.4 }), { width: 490, height: 1000, deviceScaleFactor: 1 });
  assert.deepEqual(viewportFor({ width: 265, height: 895 }), { width: 265, height: 895, deviceScaleFactor: 1 });
  assert.deepEqual(viewportFor({ width: 100, height: 100 }), { width: 100, height: 100, deviceScaleFactor: 1 });
});

test("viewportFor gives nothing for an area too small, missing or not a number", () => {
  for (const size of [{ width: 99, height: 500 }, { width: 500, height: 99 }, { width: 0, height: 0 }, null, undefined, {}, { width: NaN, height: 500 }, { width: Infinity, height: 500 }, { width: "490", height: undefined }]) {
    assert.equal(viewportFor(size), null, JSON.stringify(size));
  }
});

test("resizeStep sends a new size at once when nothing was sent, or the last send is old enough", () => {
  const want = { width: 490, height: 1000 };
  assert.deepEqual(resizeStep(want, null, 1000, 250), { send: want });
  assert.deepEqual(resizeStep(want, { width: 400, height: 1000, at: 750 }, 1000, 250), { send: want });
});

test("resizeStep waits out the rest of the gap after a recent send", () => {
  assert.deepEqual(resizeStep({ width: 490, height: 1000 }, { width: 400, height: 1000, at: 900 }, 1000, 250), { wait: 150 });
});

test("resizeStep sends the same size again after the gap while the frame of that size is stale, up to three times", () => {
  const want = { width: 361, height: 1228, deviceScaleFactor: 1 };
  const stale = pictureOf({ width: 361, height: 887 }, meta(361, 1228));
  assert.deepEqual(resizeStep(want, { ...want, at: 0 }, 300, 250, stale), { send: want, refit: true });
  assert.deepEqual(resizeStep(want, { ...want, at: 0, refits: 2 }, 100, 250, stale), { wait: 150 });
  assert.equal(resizeStep(want, { ...want, at: 0, refits: 3 }, 300, 250, stale), null);
});

test("resizeStep sends nothing again for a whole-page frame shrunk by the stream cap", () => {
  const want = { width: 361, height: 1228, deviceScaleFactor: 1 };
  assert.equal(resizeStep(want, { ...want, at: 0 }, 300, 250, pictureOf({ width: 261, height: 887 }, meta(361, 1228))), null);
});

test("resizeStep sends nothing again for a clean frame, a stale frame of another size, or no frame", () => {
  const want = { width: 361, height: 1228, deviceScaleFactor: 1 };
  const sent = { ...want, at: 0 };
  for (const picture of [pictureOf({ width: 361, height: 1228 }, meta(361, 1228)), pictureOf({ width: 600, height: 700 }, meta(600, 800)), null]) {
    assert.equal(resizeStep(want, sent, 300, 250, picture), null, JSON.stringify(picture));
  }
});

test("resizeStep does nothing for the size already sent, or for no size", () => {
  assert.equal(resizeStep({ width: 490, height: 1000 }, { width: 490, height: 1000, at: 0 }, 1000, 250), null);
  assert.equal(resizeStep(null, null, 1000, 250), null);
  assert.deepEqual(resizeStep({ width: 490, height: 1000 }, { width: 490, height: 999, at: 0 }, 1000, 250), { send: { width: 490, height: 1000 } });
});

test("addressAtRest shows only the domain, without www, and a lock for https", () => {
  assert.deepEqual(addressAtRest("https://www.google.com/search?q=x#top"), { text: "google.com", secure: true });
  assert.deepEqual(addressAtRest("http://crossbible.test/john/3"), { text: "crossbible.test", secure: false });
  assert.deepEqual(addressAtRest("http://127.0.0.1:3000/"), { text: "127.0.0.1:3000", secure: false });
  assert.deepEqual(addressAtRest("https://user:pw@shop.test/"), { text: "shop.test", secure: true });
});

test("addressAtRest keeps another scheme's address without its query, credentials or excess length", () => {
  assert.deepEqual(addressAtRest("about:blank"), { text: "about:blank", secure: false });
  assert.deepEqual(addressAtRest("file:///tmp/a.html?x=1"), { text: "file:///tmp/a.html", secure: false });
  assert.equal(addressAtRest(`data:text/html,${"a".repeat(1000)}`).text.length, 300);
});

test("addressAtRest gives empty text and no lock for no address, and the text itself when it is not a URL", () => {
  for (const v of ["", "  ", null, undefined, 42]) assert.deepEqual(addressAtRest(v), { text: "", secure: false }, String(v));
  assert.deepEqual(addressAtRest(" not a url "), { text: "not a url", secure: false });
});

test("pageTitle takes the active tab's title on one line", () => {
  const tabs = [{ active: false, title: "Other" }, { active: true, title: "  John 3 \n\t· CrossBible  " }];
  assert.equal(pageTitle(tabs, "https://crossbible.test/"), "John 3 · CrossBible");
});

test("pageTitle caps a very long title", () => {
  assert.equal(pageTitle([{ active: true, title: "x".repeat(1000) }], null).length, 300);
});

test("pageTitle falls back to the domain with no active tab, no title or no tab list", () => {
  const url = "https://www.google.com/?q=1";
  for (const tabs of [[{ active: false, title: "Other" }], [{ active: true, title: "   " }], [{ active: true, title: 7 }], [{ active: true }], [null], "tabs", null, undefined]) {
    assert.equal(pageTitle(tabs, url), "google.com", JSON.stringify(tabs));
  }
  assert.equal(pageTitle(null, null), "");
});

test("resizeStep retries a refused size only once its retry time has come", () => {
  const want = { width: 490, height: 1000 };
  const refused = { width: 490, height: 1000, at: 0, failures: 1, retryAt: 2000 };
  assert.deepEqual(resizeStep(want, refused, 1500, 250), { wait: 500 });
  assert.deepEqual(resizeStep(want, refused, 2000, 250), { send: want });
  assert.deepEqual(resizeStep({ width: 520, height: 1000 }, refused, 300, 250), { send: { width: 520, height: 1000 } });
});

test("retryDelay doubles from one second and stops at fifteen", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(retryDelay), [1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  assert.equal(retryDelay(0), 1000);
});
