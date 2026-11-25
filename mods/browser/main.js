import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, focused, spaces, theme, window, layout, checking } from "herdr";
import { DISCOVER, parseDiscovery, brief } from "./discovery.js";
import { installPlan, needsSudoCheck, installStep, installFailure, installDone, outputTail, settledInstall } from "./install.js";
import { follow, targetKey, panelState, settledStart, blockShown, machineLabel, startArgs, streamArgs, feedKey, takesKeys } from "./panel.js";
import { slug, normalizeUrl, mouseMessage, wheelMessage, keyMessages, textMessages, followUrl } from "./page.js";
import { connector } from "./connect.js";
import { Feed } from "./stream.js";
import { sweep } from "./frames.js";

const SCAN_MS = 4000;
const FPS = 15;
const KEEP_MS = 2 * 60 * 1000;
const SWEEP_MS = 6 * 60 * 1000;
const INSTALL_MS = 10 * 60 * 1000;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INSTALLER = { brew: "Homebrew", npm: "npm" };
const reason = (e) => String(e?.message ?? e ?? "failed").replace(/^Error: /, "");
const machineKey = (machine) => machine ?? "";
const shown = () => window()?.visible !== false && blockShown(layout(), "browser") !== false;

async function discover(machine) {
  const at = Date.now();
  try {
    const r = await exec("sh", ["-c", DISCOVER], { on: machine, timeout: 10000 });
    const { os, tools, sessions } = parseDiscovery(r.stdout);
    return { at, os, tools, sessions, error: r.code !== 0 && !sessions.length ? r.stderr.trim() || `exit ${r.code}` : null };
  } catch (e) {
    return { at, os: null, tools: null, sessions: [], error: reason(e) };
  }
}

function note(t, text, color = t.dim) {
  return div().text_size(12).text_color(color).child(text);
}

function button(t, id, label, onClick) {
  return h_flex().id(id).h(28).px(12).flex_none().self_start().items_center().rounded(6).cursor_pointer()
    .bg(t.solid).text_color(t.solid_foreground).hover((s) => s.opacity(0.9))
    .on_click((_e, cx) => onClick(cx))
    .child(label);
}

function control(t, id, label, tip, onClick) {
  return h_flex().id(id).h(26).min_w(26).px(6).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
    .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
    .child(label);
}

export default class Browser extends View {
  init(_props, cx) {
    this.target = null;
    this.scans = new Map();
    this.scanning = new Map();
    this.starts = new Map();
    this.installs = new Map();
    this.streamErrors = new Map();
    this.feed = null;
    this.feedKey = null;
    this.shownAt = null;
    this.keysShown = false;
    this.os = null;
    this.copy = Math.random().toString(36).slice(2, 8);
    this.note = null;
    this.pressed = null;
    this.lastPoint = null;
    this.lastMove = 0;
    this.h = cx.focus_handle();
    this.address = InputState.new({ placeholder: "Go to…" });
    this.shownUrl = "";
    this.address.on("submit", (_e, cx) => {
      this.shownUrl = this.address.value();
      const url = normalizeUrl(this.address.value());
      if (url) this.act({ action: "navigate", url }, cx);
    });
    if (checking()) return;
    cx.spawn(async () => { await sweep(SWEEP_MS); });
    cx.timer.every(SCAN_MS, (cx) => {
      if (!shown()) return void this.drop();
      if (this.keysShown !== this.takesKeys()) cx.notify();
      this.scan(cx);
      const feed = this.feed;
      if (feed) cx.spawn(async (cx) => { await feed.frames.keepAlive(cx, KEEP_MS); });
    });
  }

  scan(cx, target = this.target) {
    const key = machineKey(target?.machine);
    if (!target?.session || this.scanning.get(key) >= Math.max(target.since ?? 0, this.shownAt ?? 0)) return;
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
    if (this.installs.get(machineKey(target.machine))?.status !== "installing") this.installs.delete(machineKey(target.machine));
    this.streamErrors.delete(key);
    cx.notify();
    cx.spawn(async (cx) => {
      let result;
      try {
        const r = await exec("agent-browser", startArgs(target.session), { on: target.machine, timeout: 60000 });
        result = r.code === 0 ? { status: "started" } : { status: "failed", error: r.stderr.trim() || r.stdout.trim() || `exit ${r.code}` };
      } catch (e) {
        result = { status: "failed", error: `agent-browser could not run on ${machineLabel(target.machine)}: ${reason(e)}` };
      }
      if (result.status === "started") {
        try {
          const s = await exec("agent-browser", streamArgs(target.session), { on: target.machine, timeout: 30000 });
          if (s.code !== 0) this.streamErrors.set(key, s.stderr.trim() || s.stdout.trim() || `exit ${s.code}`);
        } catch (e) {
          this.streamErrors.set(key, reason(e));
        }
      }
      this.keep(machineKey(target.machine), await discover(target.machine));
      this.starts.set(key, result);
      cx.notify();
    });
  }

  install(target, cx) {
    const key = machineKey(target.machine);
    if (this.installs.get(key)?.status === "installing") return;
    const scan = this.scans.get(key);
    if (scan?.tools?.agentBrowser !== false) return;
    const offered = installPlan(scan.os, scan.tools);
    if (!offered.via) return;
    this.installs.set(key, installStep(offered, 0));
    cx.notify();
    cx.spawn(async (cx) => {
      const sudo = needsSudoCheck(scan.os, scan.tools) && await exec("sudo", ["-n", "true"], { on: target.machine, timeout: 10000 }).then((r) => r.code === 0, () => false);
      const plan = installPlan(scan.os, scan.tools, sudo);
      let result = installDone(plan);
      for (const [step, [command, args]] of plan.steps.entries()) {
        this.installs.set(key, installStep(plan, step));
        cx.notify();
        try {
          const r = await exec(command, args, { on: target.machine, timeout: INSTALL_MS });
          if (r.code !== 0) { result = installFailure(plan, step, outputTail(r)); break; }
        } catch (e) {
          result = installFailure(plan, step, reason(e));
          break;
        }
      }
      this.keep(key, await discover(target.machine));
      this.installs.set(key, result);
      cx.notify();
    });
  }

  sync(state, visible, cx) {
    const key = feedKey(state, this.target, visible, this.shownAt);
    if (key === this.feedKey) return;
    this.drop();
    if (!key) return;
    this.feedKey = key;
    this.os = state.os;
    this.feed = new Feed(`${this.copy}-${slug(key)}`, connector(state.machine, state.port), FPS).start(cx);
  }

  drop() {
    if (!this.feedKey) return Promise.resolve();
    const feed = this.feed;
    this.feed = null;
    this.feedKey = null;
    this.pressed = null;
    this.lastPoint = null;
    this.note = null;
    this.keysShown = false;
    this.shownUrl = "";
    this.address.set_value("");
    return feed ? feed.stop() : Promise.resolve();
  }

  async close() {
    await this.drop();
  }

  say(text, cx) {
    const at = Date.now();
    this.note = { text, at };
    cx.notify();
    cx.timer.after(4000, (cx) => {
      if (this.note?.at === at) this.note = null;
      cx.notify();
    });
  }

  act(body, cx) {
    const feed = this.feed;
    if (!feed) return;
    cx.spawn(async (cx) => {
      try { await feed.command(body); } catch (e) { if (this.feed === feed) this.say(`${body.action}: ${reason(e)}`, cx); }
    });
  }

  mouse(e, eventType, button) {
    const msg = mouseMessage(e, eventType, button, this.feed?.page, this.os, this.pressed);
    if (!msg) return;
    this.lastPoint = { x: msg.x, y: msg.y };
    this.feed.send(msg, eventType === "mouseMoved");
  }

  takesKeys() {
    return takesKeys(this.h.is_focused(), this.feed?.phase);
  }

  screen(t, state) {
    const feed = this.feed;
    const message = !state.port
      ? `This session has no live view.${this.streamErrors.has(targetKey(this.target)) ? ` ${this.streamErrors.get(targetKey(this.target))}` : ""}`
      : !feed ? "Connecting…"
      : feed.phase === "error" ? `Cannot reach the live view: ${feed.error ?? "disconnected"}`
      : feed.frames.empty ? (feed.phase === "live" ? "Waiting for the page to paint…" : "Connecting…")
      : null;
    return div().id("browser-screen").relative().flex_1().min_h(0).rounded(8).overflow_hidden().bg(t.surface)
      .track_focus(this.h)
      .children(feed ? feed.frames.view() : [])
      .when(Boolean(message), (el) => el.child(h_flex().absolute().inset_0().items_center().justify_center().px(20).text_size(12).text_color(t.dim).child(message)))
      .when(this.keysShown, (el) => el.child(div().absolute().inset_0().rounded(8).border_2().border_color(t.accent)))
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        this.h.focus();
        this.pressed = "left";
        this.mouse(e, "mousePressed", "left");
        cx.notify();
      })
      .on_mouse_up("left", (e) => {
        this.mouse(e, "mouseReleased", "left");
        this.pressed = null;
      })
      .on_mouse_down("right", (e, cx) => {
        cx.stop_propagation();
        this.mouse(e, "mousePressed", "right");
      })
      .on_mouse_up("right", (e) => this.mouse(e, "mouseReleased", "right"))
      .on_hover((inside) => {
        if (inside || !this.pressed || !this.lastPoint) return;
        this.feed?.send({ type: "input_mouse", eventType: "mouseReleased", ...this.lastPoint, button: this.pressed, clickCount: 1 });
        this.pressed = null;
      })
      .on_mouse_move((e) => {
        const now = Date.now();
        if (now - this.lastMove < 33 || !(this.pressed || this.h.is_focused())) return;
        this.lastMove = now;
        this.mouse(e, "mouseMoved", this.pressed ?? "none");
      })
      .on_scroll_wheel((e, cx) => {
        const msg = wheelMessage(e, this.feed?.page, this.os);
        if (!msg) return;
        cx.stop_propagation();
        this.feed.send(msg);
      })
      .on_key_down((e, cx) => {
        if (!this.takesKeys()) return;
        cx.stop_propagation();
        const messages = e.keystroke === "cmd-v" || e.keystroke === "ctrl-v" ? textMessages(cx.read_from_clipboard()) : keyMessages(e, this.os);
        for (const m of messages) this.feed.send(m);
      });
  }

  viewer(t, state) {
    const next = followUrl(this.address.value(), this.shownUrl, this.feed?.url ?? state.url);
    if (next) {
      this.address.set_value(next);
      this.shownUrl = next;
    }
    return v_flex().id("browser-viewer").flex_1().min_h(0).gap(8)
      .child(h_flex().h(30).flex_none().gap(4).items_center()
        .child(control(t, "browser-back", "‹", "Back", (cx) => this.act({ action: "back" }, cx)))
        .child(control(t, "browser-forward", "›", "Forward", (cx) => this.act({ action: "forward" }, cx)))
        .child(control(t, "browser-reload", "↻", "Reload", (cx) => this.act({ action: "reload" }, cx)))
        .child(h_flex().id("browser-address").flex_1().min_w(80).h(28).px(10).items_center().rounded(6).border_1().border_color(t.border).bg(t.background)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.address).flex_1().h_full().text_size(12).text_color(t.foreground))))
      .when(Boolean(this.note), (el) => el.child(note(t, this.note.text, t.blocked)))
      .when(this.keysShown, (el) => el.child(h_flex().id("browser-keys").h(24).flex_none().px(10).gap(6).items_center().rounded(6).bg(t.solid).text_color(t.solid_foreground).text_size(12)
        .child(div().font_semibold().child("Keys go to the page"))
        .child(div().truncate().child("Herdr shortcuts too. Click outside the picture to give them back."))))
      .child(this.screen(t, state));
  }

  manual(t, id, intro, command) {
    return v_flex().gap(6)
      .child(note(t, intro))
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).px(8).py(4).rounded(6).bg(t.surface).text_size(12).child(command))
        .child(control(t, id, "Copy", "Copy the command", (cx) => cx.write_to_clipboard(command))));
  }

  handCommand(t, state) {
    return this.manual(t, "browser-copy-install", `To install it by hand, run this on ${machineLabel(state.machine)}:`, state.command);
  }

  depsHint(t, state) {
    return this.manual(t, "browser-copy-deps", `On Linux the browser may also need system libraries, and installing them may need sudo. If the browser does not start, run this on ${machineLabel(state.machine)}:`, state.hint);
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
      case "installing":
        return v_flex().gap(10)
          .child(h_flex().gap(8).items_center()
            .child(div().w(14).text_color(t.dim).frames(SPINNER, 90))
            .child(div().child(`Installing agent-browser on ${machineLabel(state.machine)} with ${INSTALLER[state.via]}…`)))
          .child(note(t, `Step ${state.step} of ${state.of}: ${state.label}`))
          .child(note(t, "This can take several minutes. The panel cannot show the download itself, so each step stays here until it finishes."));
      case "missing":
        return v_flex().gap(10)
          .child(div().child(`agent-browser is not installed on ${machineLabel(state.machine)}.`))
          .child(note(t, where))
          .when(Boolean(state.via), (el) => el
            .child(button(t, "browser-install", "Install agent-browser", (cx) => this.install(target, cx)))
            .child(note(t, `Runs ${state.plan} with ${INSTALLER[state.via]}. It installs the agent-browser command and downloads Chrome for Testing.${state.ifSudo ? ` If sudo works here without a password, it also installs the browser's system libraries with ${state.ifSudo}.` : ""}`)))
          .when(Boolean(state.error), (el) => el.child(note(t, state.error, t.blocked)))
          .when(!state.via || Boolean(state.error), (el) => el.child(this.handCommand(t, state)))
          .when(Boolean(state.hint), (el) => el.child(this.depsHint(t, state)));
      case "start":
        return v_flex().gap(10)
          .child(div().child("No browser for this terminal yet."))
          .child(note(t, where))
          .child(button(t, "browser-start", "Start browser", (cx) => this.start(target, cx)))
          .when(Boolean(state.error), (el) => el.child(note(t, state.error, t.blocked)))
          .when(Boolean(state.command), (el) => el.child(this.handCommand(t, state)))
          .when(Boolean(state.hint), (el) => el.child(this.depsHint(t, state)));
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
    if (visible && !this.visible) this.shownAt = Date.now();
    if (visible && (next !== this.target || !this.visible)) this.scan(cx, next);
    this.target = next;
    this.visible = visible;
    const target = this.target, key = targetKey(target);
    const install = this.installs.get(machineKey(target?.machine));
    const state = panelState({ target, scan: this.scans.get(machineKey(target?.machine)), start: this.starts.get(key), install });
    if (!settledStart(state, this.starts.get(key))) this.starts.delete(key);
    if (!settledInstall(state, install)) this.installs.delete(machineKey(target?.machine));
    this.sync(state, visible, cx);
    this.keysShown = this.takesKeys();
    const t = theme();
    return v_flex().id("browser").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Browser"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(target?.address ?? "")))
      .child(v_flex().id("browser-body").flex_1().min_h(0).p(14).gap(10).child(this.body(t, state)));
  }
}
