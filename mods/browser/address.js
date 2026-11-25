export const DETECT = [
  `case $1 in "~") d=$HOME ;; "~/"*) d=$HOME/\${1#"~/"} ;; *) d=$1 ;; esac`,
  `r=$(cd "$d" 2>/dev/null && pwd -P)`,
  `hr=$(cd "$HOME" 2>/dev/null && pwd -P)`,
  `printf 'home\\t%s\\n' "$hr"`,
  `printf 'folder\\t%s\\n' "$r"`,
  `if command -v ss >/dev/null 2>&1; then`,
  `  ss -tlnp 2>/dev/null | while IFS= read -r l; do printf 'ss\\t%s\\n' "$l"; done`,
  `  for p in $(ss -tlnp 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do`,
  `    printf 'cwd\\t%s\\t%s\\n' "$p" "$(readlink "/proc/$p/cwd" 2>/dev/null)"`,
  `  done`,
  `elif command -v lsof >/dev/null 2>&1; then`,
  `  lsof -nP -iTCP -sTCP:LISTEN -Fpn 2>/dev/null | while IFS= read -r l; do printf 'lsof\\t%s\\n' "$l"; done`,
  `  p=$(lsof -nP -iTCP -sTCP:LISTEN -Fp 2>/dev/null | sed -n 's/^p//p' | sort -u | paste -sd, -)`,
  `  [ -n "$p" ] && lsof -a -p "$p" -d cwd -Fpn 2>/dev/null | while IFS= read -r l; do printf 'lsofcwd\\t%s\\n' "$l"; done`,
  `fi`,
  `if [ -n "$r" ] && [ -f "$r/public/hot" ]; then printf 'hot\\t%s\\n' "$(head -n 1 "$r/public/hot" | tr -d '\\r')"; fi`,
  `e=$r`,
  `while [ -n "$e" ] && [ "$e" != / ] && [ "$e" != "$hr" ]; do`,
  `  if [ -f "$e/.env" ]; then`,
  `    printf 'appurl\\t%s\\n' "$(grep -m 1 -E '^[[:space:]]*(export[[:space:]]+)?APP_URL[[:space:]]*=' "$e/.env" 2>/dev/null)"`,
  `    break`,
  `  fi`,
  `  e=\${e%/*}`,
  `done`,
  `h="$HOME/Library/Application Support/Herd/config/valet"`,
  `if [ -f "$h/config.json" ]; then`,
  `  printf 'herd\\t%s\\n' "$h"`,
  `  printf 'herdconfig\\t%s\\n' "$(tr -d '\\r\\n' < "$h/config.json")"`,
  `fi`,
].join("\n");

export const HERD_SITES = [
  `h=$1`,
  `shift`,
  `for f in "$h"/Certificates/*.crt; do [ -f "$f" ] && printf 'cert\\t%s\\n' "\${f##*/}"; done`,
  `for p in "$@"; do`,
  `  for e in "\${p%/}"/*; do`,
  `    [ -d "$e" ] || continue`,
  `    r=$(cd "$e" 2>/dev/null && pwd -P) || continue`,
  `    k=dir`,
  `    [ -L "$e" ] && k=link`,
  `    printf '%s\\t%s\\t%s\\n' "$k" "\${e##*/}" "$r"`,
  `  done`,
  `done`,
].join("\n");

const rows = (stdout) => String(stdout ?? "").split("\n").map((line) => {
  const parts = line.replace(/\r$/, "").split("\t");
  return { kind: parts[0], value: parts.slice(1).join("\t"), parts };
});

export function openable(url) {
  if (typeof url !== "string" || url.length > 2048 || /\s/.test(url)) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  return (u.protocol === "http:" || u.protocol === "https:") && u.hostname && !u.username && !u.password ? u.href : null;
}

function unquote(raw) {
  const v = raw.trim();
  const q = v[0];
  if (q === '"' || q === "'") {
    const end = v.indexOf(q, 1);
    return end > 0 ? v.slice(1, end) : null;
  }
  return v.replace(/\s+#.*$/, "").trim();
}

export function appUrl(content) {
  for (const line of String(content ?? "").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?APP_URL\s*=(.*)$/.exec(line);
    if (!m) continue;
    const value = unquote(m[1]);
    return value && !value.includes("$") ? openable(value) : null;
  }
  return null;
}

export function inside(path, folder) {
  if (typeof path !== "string" || typeof folder !== "string" || !path.startsWith("/") || !folder.startsWith("/")) return false;
  return path === folder || path.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
}

export function loopback(host) {
  const h = String(host ?? "").replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (h === "*" || h === "0.0.0.0" || h === "::" || h === "::ffff:0.0.0.0" || /^127\.\d+\.\d+\.\d+$/.test(h)) return "127.0.0.1";
  return h === "::1" ? "[::1]" : null;
}

const port = (text) => {
  const n = Number(text);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
};

function hostPort(text) {
  const m = /^(.*):(\d+)$/.exec(text ?? "");
  return m && port(m[2]) ? { host: m[1], port: port(m[2]) } : null;
}

function lsofListeners(lines, cwdLines) {
  const cwds = new Map();
  let pid = null;
  for (const l of cwdLines) {
    if (l[0] === "p") pid = l.slice(1);
    else if (l[0] === "n" && pid) cwds.set(pid, l.slice(1));
  }
  const out = [];
  pid = null;
  for (const l of lines) {
    if (l[0] === "p") pid = l.slice(1);
    else if (l[0] === "n" && pid) {
      const at = hostPort(l.slice(1));
      if (at) out.push({ ...at, pid, cwd: cwds.get(pid) ?? null });
    }
  }
  return out;
}

function ssListeners(lines, cwds) {
  const out = [];
  for (const l of lines) {
    const at = l.trim().split(/\s+/).map(hostPort).find(Boolean);
    if (!at) continue;
    for (const [, pid] of l.matchAll(/pid=(\d+)/g)) out.push({ ...at, pid, cwd: cwds.get(pid) ?? null });
  }
  return out;
}

export function herdConfig(json) {
  let c;
  try { c = JSON.parse(json); } catch { return null; }
  if (typeof c?.tld !== "string" || !/^[a-z0-9-]+$/i.test(c.tld) || !Array.isArray(c.paths)) return null;
  return { tld: c.tld.toLowerCase(), paths: c.paths.filter((p) => typeof p === "string" && p.startsWith("/")) };
}

export function parseDetection(stdout) {
  const found = { home: null, folder: null, hot: null, appUrl: null, herd: null };
  const ss = [], lsof = [], lsofCwd = [], cwds = new Map();
  let herdDir = null, herdJson = null;
  for (const { kind, value, parts } of rows(stdout)) {
    if (kind === "home") found.home = value || null;
    else if (kind === "folder") found.folder = value || null;
    else if (kind === "ss") ss.push(value);
    else if (kind === "cwd" && parts[1]) cwds.set(parts[1], parts.slice(2).join("\t") || null);
    else if (kind === "lsof") lsof.push(value);
    else if (kind === "lsofcwd") lsofCwd.push(value);
    else if (kind === "hot") found.hot = value || null;
    else if (kind === "appurl") found.appUrl = appUrl(value);
    else if (kind === "herd") herdDir = value || null;
    else if (kind === "herdconfig") herdJson = value;
  }
  const config = herdDir && herdJson ? herdConfig(herdJson) : null;
  if (config) found.herd = { dir: herdDir, ...config };
  found.listeners = [...ssListeners(ss, cwds), ...lsofListeners(lsof, lsofCwd)];
  return found;
}

export function herdArgs(herd) {
  if (!herd?.dir?.startsWith("/")) throw new Error("not a Herd folder");
  return ["-c", HERD_SITES, "sh", herd.dir, ...herd.paths];
}

export function parseHerdSites(stdout) {
  const certs = new Set(), entries = [];
  for (const { kind, parts } of rows(stdout)) {
    if (kind === "cert" && parts[1]) certs.add(parts[1].toLowerCase());
    else if ((kind === "dir" || kind === "link") && parts[1] && parts[2]) entries.push({ name: parts[1], link: kind === "link", path: parts.slice(2).join("\t") });
  }
  return { certs, entries };
}

function hotPort(hot) {
  try { return port(new URL(hot).port); } catch { return null; }
}

export function listenerUrl({ folder, home, listeners, hot }) {
  if (!folder || folder === "/" || !home || inside(home, folder)) return null;
  const skip = hot ? hotPort(hot) : null;
  const urls = (listeners ?? [])
    .filter((l) => l.port !== skip && inside(l.cwd, folder) && loopback(l.host))
    .map((l) => ({ port: l.port, host: loopback(l.host) }))
    .sort((a, b) => a.port - b.port || (a.host === "127.0.0.1" ? -1 : b.host === "127.0.0.1" ? 1 : 0));
  return urls.length ? `http://${urls[0].host}:${urls[0].port}` : null;
}

const SITE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;

export function herdUrl({ folder, herd, sites }) {
  if (!folder || !herd?.tld || !sites) return null;
  const match = sites.entries
    .filter((e) => SITE.test(e.name) && !e.name.includes("..") && inside(folder, e.path))
    .sort((a, b) => b.path.length - a.path.length || b.link - a.link)[0];
  if (!match) return null;
  const host = `${match.name.toLowerCase()}.${herd.tld}`;
  return `${sites.certs.has(`${host}.crt`) ? "https" : "http"}://${host}`;
}

const MEMORY = 200;
const memoryKey = (machine, folder) => `${machine ?? ""}|${folder}`;

export function recall(memory, machine, folder) {
  return folder ? openable(memory?.[memoryKey(machine, folder)]?.url) : null;
}

function withoutQuery(url) {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  return u.href;
}

export function remember(memory, machine, folder, url, at) {
  const page = openable(url);
  const safe = page && withoutQuery(page);
  const key = memoryKey(machine, folder);
  if (!folder || !safe || memory?.[key]?.url === safe) return null;
  const next = { ...(memory ?? {}), [key]: { url: safe, at } };
  const keys = Object.keys(next);
  if (keys.length > MEMORY) {
    keys.sort((a, b) => (next[a]?.at ?? 0) - (next[b]?.at ?? 0));
    for (const k of keys.slice(0, keys.length - MEMORY)) delete next[k];
  }
  return next;
}

export function readMemory(text) {
  try {
    const m = JSON.parse(text ?? "null");
    return m && typeof m === "object" && !Array.isArray(m) ? m : {};
  } catch {
    return {};
  }
}

export function pickAddress({ detected, sites, last }) {
  return listenerUrl(detected ?? {})
    ?? openable(last)
    ?? herdUrl({ folder: detected?.folder, herd: detected?.herd, sites })
    ?? openable(detected?.appUrl)
    ?? "about:blank";
}
