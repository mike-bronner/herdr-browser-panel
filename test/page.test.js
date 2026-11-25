import { test } from "node:test";
import assert from "node:assert/strict";
import { slug, normalizeUrl, jpegSize, pageOf, toPage, cdpModifiers, keyMessages, textMessages, mouseMessage, wheelMessage, followUrl, sshFor, tunnelArgs } from "../mods/browser/page.js";

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

test("pageOf scales the frame to the device width in CSS pixels", () => {
  assert.deepEqual(pageOf({ width: 2560, height: 1440 }, 1280), { width: 1280, height: 720 });
  assert.deepEqual(pageOf({ width: 800, height: 600 }), { width: 800, height: 600 });
  assert.equal(pageOf(null, 1280), null);
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
    { type: "input_mouse", eventType: "mouseWheel", x: 400, y: 200, deltaX: -3, deltaY: 40, modifiers: 0 });
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
