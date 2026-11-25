import { installPlan } from "./install.js";
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

export function startArgs(session, url = "about:blank") {
  const page = url === "about:blank" ? url : openable(url);
  if (!page) throw new Error(`not an address to open: ${url}`);
  return ["--session", checked(session), "open", page];
}

export function streamArgs(session) {
  return ["--session", checked(session), "stream", "enable"];
}

export function feedKey(state, target, visible, shownAt) {
  if (!visible || state?.kind !== "running" || !state.port || state.at < shownAt) return null;
  return `${targetKey(target)}|${state.pid ?? ""}|${state.port}`;
}

export function panelState({ target, scan, start, install }) {
  if (!target) return { kind: "idle" };
  const where = { session: target.session, machine: target.machine, address: target.address };
  if (!target.session) return { kind: "unsupported", ...where };
  const fresh = scan && !(scan.at < target.since) ? scan : null;
  const found = fresh ? findSession(fresh.sessions, target.session) : null;
  if (found) return { kind: "running", ...where, at: fresh.at, pid: found.pid, port: found.port, url: found.url, engine: found.engine, os: fresh.os ?? null };
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
  const error = start?.status === "failed" ? start.error
    : start?.status === "started" ? `agent-browser started, but no session named ${target.session} showed up`
    : failed?.error ?? null;
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

export function takesKeys(focused, phase) {
  return Boolean(focused) && phase === "live";
}

export function terminalFolder(target, focus, panes) {
  if (!target) return null;
  const cwd = focus?.terminal === target.address ? focus.cwd : panes?.find((p) => p.terminal === target.address)?.cwd;
  return typeof cwd === "string" && cwd ? cwd : null;
}

const QUICK_END_MS = 30000;

export function endedQuickly(run) {
  return run?.endedAt != null && run.endedAt - run.at < QUICK_END_MS;
}

export function autoStart(state, { visible, shownAt, start, run }) {
  return Boolean(visible) && state?.kind === "start" && !state.error && !start && state.at >= shownAt && !endedQuickly(run);
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
