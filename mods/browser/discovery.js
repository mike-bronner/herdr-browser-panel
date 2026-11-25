export const DISCOVER = [
  `if command -v agent-browser >/dev/null 2>&1; then`,
  `  printf '{"os":"%s","agentBrowser":true}\\n' "$(uname -s)"`,
  `else`,
  `  brew=false; command -v brew >/dev/null 2>&1 && brew=true`,
  `  npm=false; command -v npm >/dev/null 2>&1 && npm=true`,
  `  node=$(node -v 2>/dev/null | head -n 1 | tr -cd '0-9.')`,
  `  root=false`,
  `  [ "$(uname -s)" = Linux ] && [ "$(id -u 2>/dev/null)" = 0 ] && root=true`,
  `  printf '{"os":"%s","agentBrowser":false,"brew":%s,"npm":%s,"node":"%s","root":%s}\\n' "$(uname -s)" "$brew" "$npm" "$node" "$root"`,
  `fi`,
  `seen=" "`,
  `for d in "\${AGENT_BROWSER_SOCKET_DIR:-}" "\${XDG_RUNTIME_DIR:+$XDG_RUNTIME_DIR/agent-browser}" "$HOME/.agent-browser" "\${TMPDIR:-/tmp}/agent-browser"; do`,
  `  [ -n "$d" ] && [ -d "$d" ] && [ -O "$d" ] || continue`,
  `  for p in "$d"/*.pid "$d"/namespaces/*/run/*.pid; do`,
  `    case $p in */dashboard.pid) continue ;; esac`,
  `    [ -f "$p" ] || continue`,
  `    pid=$(cat "$p" 2>/dev/null)`,
  `    case $pid in ''|*[!0-9]*) continue ;; esac`,
  `    case $seen in *" $pid "*) continue ;; esac`,
  `    kill -0 "$pid" 2>/dev/null || continue`,
  `    seen="$seen$pid "`,
  `    b=\${p%.pid}`,
  `    port=$(cat "$b.stream" 2>/dev/null)`,
  `    case $port in ''|*[!0-9]*) port=0 ;; esac`,
  `    engine=$(cat "$b.engine" 2>/dev/null | tr -cd 'a-z0-9_-')`,
  `    target=$(cat "$b.target" 2>/dev/null | tr -d '\\n\\r')`,
  `    [ -n "$target" ] || target=null`,
  `    name=$(printf %s "\${b##*/}" | tr -d '"\\\\')`,
  `    dir=$(printf %s "\${p%/*}" | tr -d '"\\\\')`,
  `    printf '{"session":"%s","dir":"%s","pid":%s,"port":%s,"engine":"%s","target":%s}\\n' "$name" "$dir" "$pid" "$port" "$engine" "$target"`,
  `  done`,
  `done`,
].join("\n");

export function parseDiscovery(stdout) {
  let os = null, tools = null;
  const sessions = [];
  for (const line of String(stdout ?? "").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      try { row = JSON.parse(line.replace(/,"target":.*\}$/, ',"target":null}')); } catch { continue; }
    }
    if (row.os !== undefined) { os = row.os; tools = readTools(row); continue; }
    if (!row.session) continue;
    const dir = typeof row.dir === "string" ? row.dir : "";
    sessions.push({
      session: row.session,
      dir,
      namespace: /\/namespaces\/([^/]+)\/run$/.exec(dir)?.[1] ?? null,
      pid: row.pid,
      port: row.port || null,
      engine: row.engine || "chrome",
      url: typeof row.target?.url === "string" ? row.target.url : null,
    });
  }
  sessions.sort((a, b) => a.session.localeCompare(b.session) || a.dir.localeCompare(b.dir));
  return { os, tools, sessions };
}

function readTools(row) {
  return {
    agentBrowser: typeof row.agentBrowser === "boolean" ? row.agentBrowser : null,
    brew: row.brew === true,
    npm: row.npm === true,
    node: typeof row.node === "string" && row.node ? row.node : null,
    root: row.root === true,
  };
}

export function brief(url) {
  if (typeof url !== "string") return "";
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i, "$1").replace(/[?#].*$/, "");
}
