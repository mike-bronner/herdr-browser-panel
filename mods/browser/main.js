import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, focused, spaces, theme, window, layout, checking } from "herdr";
import { DISCOVER, parseDiscovery, brief } from "./discovery.js";
import { follow, targetKey, panelState, settledStart, blockShown, machineLabel, startArgs } from "./panel.js";

const SCAN_MS = 4000;
const reason = (e) => String(e?.message ?? e ?? "failed").replace(/^Error: /, "");
const machineKey = (machine) => machine ?? "";
const shown = () => window()?.visible !== false && blockShown(layout(), "browser") !== false;

async function discover(machine) {
  const at = Date.now();
  try {
    const r = await exec("sh", ["-c", DISCOVER], { on: machine, timeout: 10000 });
    const { sessions } = parseDiscovery(r.stdout);
    return { at, sessions, error: r.code !== 0 && !sessions.length ? r.stderr.trim() || `exit ${r.code}` : null };
  } catch (e) {
    return { at, sessions: [], error: reason(e) };
  }
}

function note(t, text, color = t.dim) {
  return div().text_size(12).text_color(color).child(text);
}

export default class Browser extends View {
  init(_props, cx) {
    this.target = null;
    this.scans = new Map();
    this.scanning = new Map();
    this.starts = new Map();
    if (checking()) return;
    cx.timer.every(SCAN_MS, (cx) => { if (shown()) this.scan(cx); });
  }

  scan(cx, target = this.target) {
    const key = machineKey(target?.machine);
    if (!target?.session || this.scanning.get(key) >= (target.since ?? 0)) return;
    const at = Date.now();
    this.scanning.set(key, at);
    cx.spawn(async (cx) => {
      try { this.keep(key, await discover(target.machine)); }
      finally { if (this.scanning.get(key) === at) this.scanning.delete(key); cx.notify(); }
    });
  }

  keep(key, scan) {
    if (!(this.scans.get(key)?.at > scan.at)) this.scans.set(key, scan);
  }

  start(target, cx) {
    const key = targetKey(target);
    if (this.starts.get(key)?.status === "starting") return;
    this.starts.set(key, { status: "starting" });
    cx.notify();
    cx.spawn(async (cx) => {
      let result;
      try {
        const r = await exec("agent-browser", startArgs(target.session), { on: target.machine, timeout: 60000 });
        result = r.code === 0 ? { status: "started" } : { status: "failed", error: r.stderr.trim() || r.stdout.trim() || `exit ${r.code}` };
      } catch (e) {
        result = { status: "failed", error: `agent-browser could not run on ${machineLabel(target.machine)}: ${reason(e)}` };
      }
      this.keep(machineKey(target.machine), await discover(target.machine));
      this.starts.set(key, result);
      cx.notify();
    });
  }

  viewer(t, state) {
    return v_flex().id("browser-viewer").flex_1().min_h(0).items_center().justify_center().gap(4).rounded(8).bg(t.surface)
      .child(note(t, state.port ? `Stream on port ${state.port}` : "This session has no stream port"));
  }

  body(t, state) {
    const target = this.target;
    const where = state.session ? `${state.session} on ${machineLabel(state.machine)}` : "";
    switch (state.kind) {
      case "idle":
        return note(t, "Focus a terminal to see its browser.");
      case "unsupported":
        return note(t, `Terminal ${state.address} has no usable session name.`, t.blocked);
      case "looking":
        return note(t, `Looking for ${where}…`);
      case "unreachable":
        return v_flex().gap(6).child(note(t, `Cannot check ${machineLabel(state.machine)} for ${state.session}.`, t.blocked)).child(note(t, state.error));
      case "starting":
        return note(t, `Starting ${where}…`);
      case "start":
        return v_flex().gap(10)
          .child(div().child("No browser for this terminal yet."))
          .child(note(t, where))
          .child(h_flex().id("browser-start").h(28).px(12).flex_none().self_start().items_center().rounded(6).cursor_pointer()
            .bg(t.solid).text_color(t.solid_foreground).hover((s) => s.opacity(0.9))
            .on_click((_e, cx) => this.start(target, cx))
            .child("Start browser"))
          .when(Boolean(state.error), (el) => el.child(note(t, state.error, t.blocked)));
      case "running":
        return v_flex().flex_1().min_h(0).gap(10)
          .child(v_flex().gap(2)
            .child(div().font_semibold().child(state.session))
            .child(note(t, `on ${machineLabel(state.machine)}`))
            .when(Boolean(state.url), (el) => el.child(note(t, brief(state.url)))))
          .child(this.viewer(t, state));
    }
  }

  render(cx) {
    const next = follow(this.target, focused(), spaces(), Date.now());
    const visible = !checking() && shown();
    if (visible && (next !== this.target || !this.visible)) this.scan(cx, next);
    this.target = next;
    this.visible = visible;
    const target = this.target, key = targetKey(target);
    const state = panelState({ target, scan: this.scans.get(machineKey(target?.machine)), start: this.starts.get(key) });
    if (!settledStart(state, this.starts.get(key))) this.starts.delete(key);
    const t = theme();
    return v_flex().id("browser").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Browser"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(target?.address ?? "")))
      .child(v_flex().id("browser-body").flex_1().min_h(0).p(14).gap(10).child(this.body(t, state)));
  }
}
