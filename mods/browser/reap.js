const SESSION = /^herdr-([A-Za-z0-9_-]+)$/;

export const LIST_ARGS = ["ls", "--all", "--json"];

export function parseListing(r) {
  if (r?.code !== 0) return null;
  let doc;
  try { doc = JSON.parse(r.stdout); } catch { return null; }
  if (!Array.isArray(doc?.terminals) || !Array.isArray(doc?.machines)) return null;
  const listing = new Map([["", new Set()]]);
  for (const m of doc.machines) {
    if (m?.state === "connected" && typeof m.name === "string" && m.name) listing.set(m.name, new Set());
  }
  for (const t of doc.terminals) {
    if (typeof t?.address !== "string" || !t.address) return null;
    const slash = t.address.indexOf("/");
    const key = slash >= 0 ? t.address.slice(0, slash) : "";
    if (t.state !== "finished") listing.get(key)?.add(t.address.slice(slash + 1));
  }
  return listing;
}

function paneAt(pane, spaces) {
  const slash = pane.terminal.indexOf("/");
  if (slash >= 0) return { key: pane.terminal.slice(0, slash), id: pane.terminal.slice(slash + 1) };
  const space = spaces?.find((s) => s.tabs?.some((t) => t.id === pane.tab));
  return space ? { key: space.machine ?? "", id: pane.terminal } : null;
}

export function completeMachines(listing, machines, panes, spaces) {
  const complete = new Map();
  if (!listing) return complete;
  const ready = new Set((machines ?? []).filter((m) => m?.layout === "ready").map((m) => m.name ?? ""));
  for (const [key, ids] of listing) if (ready.has(key)) complete.set(key, ids);
  for (const pane of panes ?? []) {
    if (typeof pane?.terminal !== "string" || !pane.terminal) continue;
    const at = paneAt(pane, spaces);
    if (!at) return new Map();
    if (!complete.get(at.key)?.has(at.id)) complete.delete(at.key);
  }
  return complete;
}

export function sweepPlan(known, complete) {
  const next = new Map(), due = [];
  for (const [key, ids] of complete) {
    const was = known.get(key);
    const held = new Set([...(was?.ids ?? []), ...ids]);
    const go = Boolean(was) && (!was.swept || [...was.held].some((id) => !held.has(id)));
    if (go) due.push(key);
    next.set(key, { ids, held, swept: Boolean(was?.swept) || go });
  }
  return { known: next, due };
}

export function orphans(sessions, ids) {
  const names = new Set();
  for (const s of sessions ?? []) {
    const id = s?.namespace ? null : SESSION.exec(s?.session ?? "")?.[1];
    if (id && !ids.has(id)) names.add(s.session);
  }
  return [...names];
}

export function goneKey(machine, id) {
  return `${machine ?? ""}|${id ?? ""}`;
}
