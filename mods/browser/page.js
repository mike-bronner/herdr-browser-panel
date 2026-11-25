export function slug(text) {
  const s = String(text ?? "here");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "x";
  return `${base}-${h.toString(36)}`;
}

export function normalizeUrl(text) {
  const v = String(text ?? "").trim();
  if (!v) return null;
  return /^(https?:\/\/|about:|data:|file:|chrome(-extension)?:\/\/)/i.test(v) ? v : `https://${v}`;
}

export function jpegSize(bytes) {
  let i = 2;
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: (bytes[i + 7] << 8) | bytes[i + 8], height: (bytes[i + 5] << 8) | bytes[i + 6] };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}

export function pageOf(size, deviceWidth) {
  if (!size?.width || !size?.height) return null;
  const width = deviceWidth || size.width;
  return { width, height: Math.round((size.height * width) / size.width) };
}

export function toPage(local, bounds, pageW, pageH, clamp = false) {
  if (!local || !bounds || !pageW || !pageH || !bounds.width || !bounds.height) return null;
  const s = Math.min(bounds.width / pageW, bounds.height / pageH);
  let x = (local.x - (bounds.width - pageW * s) / 2) / s;
  let y = (local.y - (bounds.height - pageH * s) / 2) / s;
  if (x < 0 || y < 0 || x > pageW || y > pageH) {
    if (!clamp) return null;
    x = Math.min(Math.max(x, 0), pageW);
    y = Math.min(Math.max(y, 0), pageH);
  }
  return { x: Math.round(x), y: Math.round(y) };
}

export function cdpModifiers(m, browserOs) {
  if (!m) return 0;
  const cmdIsCtrl = browserOs && browserOs !== "Darwin";
  return (m.alt ? 1 : 0) | (m.control || (m.platform && cmdIsCtrl) ? 2 : 0) | (m.platform && !cmdIsCtrl ? 4 : 0) | (m.shift ? 8 : 0);
}

const NAMED = {
  enter: ["Enter", "Enter", 13, "\r"],
  tab: ["Tab", "Tab", 9],
  backspace: ["Backspace", "Backspace", 8],
  escape: ["Escape", "Escape", 27],
  delete: ["Delete", "Delete", 46],
  insert: ["Insert", "Insert", 45],
  left: ["ArrowLeft", "ArrowLeft", 37],
  up: ["ArrowUp", "ArrowUp", 38],
  right: ["ArrowRight", "ArrowRight", 39],
  down: ["ArrowDown", "ArrowDown", 40],
  home: ["Home", "Home", 36],
  end: ["End", "End", 35],
  pageup: ["PageUp", "PageUp", 33],
  pagedown: ["PageDown", "PageDown", 34],
  space: [" ", "Space", 32, " "],
};

function codeFor(ch) {
  if (/^[a-z]$/i.test(ch)) return [`Key${ch.toUpperCase()}`, ch.toUpperCase().charCodeAt(0)];
  if (/^[0-9]$/.test(ch)) return [`Digit${ch}`, ch.charCodeAt(0)];
  return [undefined, 0];
}

export function keyMessages(e, browserOs) {
  const modifiers = cdpModifiers(e.modifiers, browserOs);
  const shortcut = e.modifiers?.control || e.modifiers?.platform;
  const named = NAMED[e.key];
  let key, code, vk, text;
  if (named) {
    [key, code, vk, text] = named;
    if (shortcut) text = undefined;
  } else if (e.key_char && !shortcut) {
    key = text = e.key_char;
    [code, vk] = codeFor(e.key);
  } else if (e.key && [...e.key].length === 1) {
    key = e.key;
    [code, vk] = codeFor(e.key);
  } else {
    return [];
  }
  const down = { type: "input_keyboard", eventType: text ? "keyDown" : "rawKeyDown", key, windowsVirtualKeyCode: vk, modifiers };
  if (code) down.code = code;
  if (text) down.text = text;
  const up = { type: "input_keyboard", eventType: "keyUp", key, windowsVirtualKeyCode: vk, modifiers };
  if (code) up.code = code;
  return [down, up];
}

export function textMessages(text, limit = 2000) {
  return [...String(text ?? "")].slice(0, limit).map((ch) => ch === "\n"
    ? { type: "input_keyboard", eventType: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }
    : { type: "input_keyboard", eventType: "keyDown", key: ch, text: ch });
}

export function mouseMessage(e, eventType, button, page, browserOs, pressed) {
  if (!page) return null;
  const clamp = eventType === "mouseReleased" || (eventType === "mouseMoved" && Boolean(pressed));
  const at = toPage(e.local_position, e.bounds, page.width, page.height, clamp);
  if (!at) return null;
  const msg = { type: "input_mouse", eventType, x: at.x, y: at.y, button, modifiers: cdpModifiers(e.modifiers, browserOs) };
  if (eventType !== "mouseMoved") msg.clickCount = Math.max(1, e.click_count ?? 1);
  return msg;
}

export function wheelMessage(e, page, browserOs) {
  const at = page ? toPage(e.local_position, e.bounds, page.width, page.height) : null;
  if (!at) return null;
  return { type: "input_mouse", eventType: "mouseWheel", x: at.x, y: at.y, deltaX: -e.delta.x, deltaY: -e.delta.y, modifiers: cdpModifiers(e.modifiers, browserOs) };
}

export function followUrl(field, shown, current) {
  return current && field === shown && current !== shown ? current : null;
}

export function sshFor(machine) {
  if (machine?.via || typeof machine?.target !== "string" || !machine.target || machine.target.startsWith("-")) {
    throw new Error(`${machine?.name ?? "This machine"} is not reached by a plain ssh target, so its browser cannot be shown here`);
  }
  return machine.target;
}

const isPort = (n) => Number.isInteger(n) && n > 0 && n < 65536;

export function tunnelArgs(target, localPort, remotePort, log, seconds = 30) {
  if (!isPort(localPort) || !isPort(remotePort)) throw new Error(`not a port: ${isPort(localPort) ? remotePort : localPort}`);
  return [
    "ssh",
    "-o", "ControlPath=none",
    "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
    "-o", "LogLevel=DEBUG1", "-E", log,
    "-L", `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    "--", target, "sleep", String(seconds),
  ];
}
