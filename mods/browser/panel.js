import { installPlan, outputTail } from "./install.js";
import { openable } from "./address.js";

export function sessionName(terminalId) {
  return typeof terminalId === "string" && /^[A-Za-z0-9_-]+$/.test(terminalId) ? `herdr-${terminalId}` : null;
}

export function resolveTarget(focus, spaces) {
  const address = focus?.terminal;
  if (typeof address !== "string" || !address) return null;
  const slash = address.indexOf("/");
  if (slash >= 0) {
    const machine = address.slice(0, slash), id = address.slice(slash + 1);
    return { address, machine: machine || null, id, session: machine ? sessionName(id) : null };
  }
  const space = spaces?.find((s) => s.id === focus.space);
  if (!space) return null;
  return { address, machine: space.machine ?? null, id: address, session: sessionName(address) };
}

export function follow(previous, focus, spaces, now) {
  const next = resolveTarget(focus, spaces);
  if (!next) return previous;
  return previous?.address === next.address && previous.machine === next.machine ? previous : { ...next, since: now };
}

export function targetKey(target) {
  return `${target?.machine ?? ""}|${target?.address ?? ""}`;
}

export function machineLabel(machine) {
  return machine ?? "this computer";
}

export function findSession(sessions, name) {
  return sessions?.find((s) => s.session === name && !s.namespace) ?? null;
}

function checked(session) {
  if (typeof session !== "string" || !/^herdr-[A-Za-z0-9_-]+$/.test(session)) throw new Error(`not a terminal session name: ${session}`);
  return session;
}

const STREAM_CAP = 8192;

export function startCommand(session, url = "about:blank") {
  const page = url === "about:blank" ? url : openable(url);
  if (!page) throw new Error(`not an address to open: ${url}`);
  return ["env", [
    `AGENT_BROWSER_STREAM_MAX_WIDTH=${STREAM_CAP}`, `AGENT_BROWSER_STREAM_MAX_HEIGHT=${STREAM_CAP}`,
    "agent-browser", "--session", checked(session), "--args", "--force-device-scale-factor=2", "open", page,
  ]];
}

const START_WAIT_S = 60;

export function remoteStartArgs(machine, session, url) {
  if (typeof machine !== "string" || !machine) throw new Error(`not a machine name: ${machine}`);
  const [command, args] = startCommand(session, url);
  return ["run", "--json", "--on", machine, "--no-parent", "--no-notify", "--timeout", String(START_WAIT_S), "--label", "browser=start", "--", command, ...args];
}

function parsed(text) {
  try { return JSON.parse(text); } catch { return null; }
}

export function remoteStartResult(r) {
  const run = r?.code === 0 ? parsed(r.stdout) : null;
  const address = typeof run?.address === "string" && run.address ? run.address : null;
  if (!run) return { status: "failed", address, error: parsed(r?.stderr)?.error?.message || outputTail(r) };
  const wait = run.wait;
  if (wait?.ended !== true) {
    return { status: "failed", address, running: true, error: wait ? `agent-browser open did not finish within ${START_WAIT_S} s` : "hc run gave no exit status" };
  }
  if (wait.exit_code === 0) return { status: "started", address };
  const output = typeof run.output === "string" ? run.output.trim() : "";
  const error = output ? output.split("\n").slice(-6).join("\n") : wait.signal != null ? `stopped by signal ${wait.signal}` : `exit ${wait.exit_code}`;
  return { status: "failed", address, error };
}

export function streamArgs(session) {
  return ["--session", checked(session), "stream", "enable"];
}

export function closeArgs(session) {
  return ["--session", checked(session), "close"];
}

export function feedKey(state, target, visible, shownAt) {
  if (!visible || state?.kind !== "running" || !state.port || state.at < shownAt) return null;
  return `${targetKey(target)}|${state.pid ?? ""}|${state.port}`;
}

export function panelState({ target, scan, start, install, close }) {
  if (!target) return { kind: "idle" };
  const where = { session: target.session, machine: target.machine, address: target.address };
  if (!target.session) return { kind: "unsupported", ...where };
  if (close?.status === "closing") return { kind: "closing", ...where };
  const closeError = close?.status === "failed" ? close.error : null;
  const fresh = scan && !(scan.at < target.since) ? scan : null;
  const found = fresh ? findSession(fresh.sessions, target.session) : null;
  if (found) return { kind: "running", ...where, at: fresh.at, pid: found.pid, port: found.port, url: found.url, engine: found.engine, os: fresh.os ?? null, error: closeError };
  if (start?.status === "starting") return { kind: "starting", ...where };
  if (install?.status === "installing") return { kind: "installing", ...where, via: install.via, step: install.step, of: install.of, label: install.label };
  if (!fresh) return { kind: "looking", ...where };
  if (fresh.error) return { kind: "unreachable", ...where, error: fresh.error };
  const failed = install?.status === "failed" ? install : null;
  if (fresh.tools?.agentBrowser === false) {
    const plan = installPlan(fresh.os, fresh.tools);
    const error = failed?.error
      ?? (install?.status === "installed" ? "The install finished, but this machine's PATH still does not find agent-browser." : plan.reason);
    return { kind: "missing", ...where, via: plan.via, plan: plan.command, command: failed?.command ?? plan.command, error, hint: plan.hint, ifSudo: plan.hint };
  }
  const error = closeError ?? (start?.status === "failed" ? start.error
    : start?.status === "started" ? `agent-browser started, but no session named ${target.session} showed up`
    : failed?.error ?? null);
  return { kind: "start", ...where, at: fresh.at, error, command: start ? null : failed?.command ?? null, hint: !start && install?.status === "installed" ? install.hint ?? null : null };
}

export function settledStart(state, start) {
  return state.kind === "running" ? null : start ?? null;
}

function holds(node, mod) {
  return node?.content?.mod === mod || (node?.children ?? []).some((child) => holds(child, mod));
}

function visible(node, mod) {
  if (node.hidden) return false;
  if (node.content?.mod === mod) return true;
  const children = node.children ?? [];
  const active = node.active ?? children[0]?.id;
  return children.some((child) => (node.type !== "stack" || child.id === active) && visible(child, mod));
}

export function blockShown(root, mod) {
  return holds(root, mod) ? visible(root, mod) : null;
}

function byId(node, id) {
  if (!node || node.id === id) return node ?? null;
  for (const child of node.children ?? []) {
    const found = byId(child, id);
    if (found) return found;
  }
  return null;
}

export function panelHolds(root, mod) {
  return holds(byId(root, "panel"), mod);
}

const HEADER_PX = 30;

function paneFrame(node) {
  if (!node || node.hidden) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane;
  let children = node.children ?? [];
  if (node.type === "stack") {
    const shown = children.filter((child) => !child.hidden);
    children = [shown.find((child) => child.id === node.active) ?? shown[0]];
  }
  for (const child of children) {
    const frame = paneFrame(child);
    if (frame) return frame;
  }
  return null;
}

export function headerHeight(root) {
  const height = paneFrame(root)?.header?.height;
  return Number.isFinite(height) && height > 0 ? height : HEADER_PX;
}

export function takesKeys(focused, phase) {
  return Boolean(focused) && phase === "live";
}

export function terminalFolder(target, focus, panes) {
  if (!target) return null;
  const cwd = focus?.terminal === target.address ? focus.cwd : panes?.find((p) => p.terminal === target.address)?.cwd;
  return typeof cwd === "string" && cwd ? cwd : null;
}

export function terminalSpace(target, focus, panes, spaces) {
  if (!target) return null;
  if (focus?.terminal === target.address && focus.space) return focus.space;
  const tab = panes?.find((p) => p.terminal === target.address)?.tab;
  return (tab && spaces?.find((s) => s.tabs?.some((t) => t.id === tab))?.id) || null;
}

const QUICK_END_MS = 30000;

export function endedQuickly(run) {
  return run?.endedAt != null && run.endedAt - run.at < QUICK_END_MS;
}

export function autoStart(state, { visible, shownAt, start, run, close, gone }) {
  return Boolean(visible) && state?.kind === "start" && !state.error && !start && !close && !gone && state.at >= shownAt && !endedQuickly(run);
}

export function closeShown(hovered, state, root) {
  return Boolean(hovered) && state?.kind === "running" && panelHolds(root, "browser");
}

export function trackRun(run, state, now) {
  if (!run) return null;
  if (state?.kind === "running") return run.endedAt == null ? run : null;
  return state?.kind === "start" && run.endedAt == null ? { ...run, endedAt: now } : run;
}

export function sessionFolder(held, state, folder) {
  if (state?.kind === "running") return held ?? folder ?? null;
  return state?.kind === "start" ? null : held ?? null;
}

export function screenText({ port, streamError, feed }) {
  if (!port) return `This session has no live view.${streamError ? ` ${streamError}` : ""}`;
  if (!feed) return "Connecting…";
  if (feed.phase === "error") return `Cannot reach the live view: ${feed.error ?? "disconnected"}`;
  if (feed.empty) return feed.phase === "live" ? "Waiting for the page to paint…" : "Connecting…";
  return null;
}
