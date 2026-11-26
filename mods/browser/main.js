import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, focused, spaces, panes, theme, window, layout, checking, settings } from "herdr";
import { DISCOVER, parseDiscovery } from "./discovery.js";
import { installPlan, needsSudoCheck, installStep, installFailure, installDone, outputTail, settledInstall } from "./install.js";
import { follow, targetKey, panelState, settledStart, blockShown, machineLabel, startArgs, streamArgs, feedKey, takesKeys, findSession, terminalFolder, sessionFolder, autoStart, trackRun, screenText } from "./panel.js";
import { DETECT, parseDetection, herdArgs, parseHerdSites, pickAddress, recall, remember, readMemory } from "./address.js";
import { slug, normalizeUrl, mouseMessage, wheelMessage, keyMessages, textMessages, followUrl, viewportFor, resizeStep, retryDelay, addressAtRest, pageTitle } from "./page.js";
import { connector } from "./connect.js";
import { Feed } from "./stream.js";
import { sweep } from "./frames.js";

const SCAN_MS = 4000;
const FPS = 15;
const KEEP_MS = 2 * 60 * 1000;
const SWEEP_MS = 6 * 60 * 1000;
const INSTALL_MS = 10 * 60 * 1000;
const DETECT_MS = 15000;
const RESIZE_MS = 250;
const MEMORY_KEY = "lastUrls";
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INSTALLER = { brew: "Homebrew", npm: "npm" };
const reason = (e) => String(e?.message ?? e ?? "failed").replace(/^Error: /, "");
const machineKey = (machine) => machine ?? "";
const shown = () => window()?.visible !== false && blockShown(layout(), "browser") !== false;
const icon = (name) => svg(`mods/browser/${name}.svg`);

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

function iconButton(t, id, name, tip, onClick, box = 28, glyph = 16) {
  return control(t, id, icon(name).size(glyph), tip, onClick).w(box).h(box).min_w(box).px(0);
}

export default class Browser extends View {
  init(_props, cx) {
    this.target = null;
    this.scans = new Map();
    this.scanning = new Map();
    this.starts = new Map();
    this.installs = new Map();
    this.streamErrors = new Map();
    this.sessionFolders = new Map();
    this.runs = new Map();
    this.folder = null;
    this.memory = readMemory(globalThis.localStorage?.getItem(MEMORY_KEY));
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
    this.editing = false;
    this.area = null;
    this.sized = null;
    this.fitting = false;
    this.address.on("submit", (_e, cx) => {
      this.shownUrl = this.address.value();
      const url = normalizeUrl(this.address.value());
      if (url) this.act({ action: "navigate", url }, cx);
      this.address.blur();
    });
    this.address.on("focus", (_e, cx) => {
      this.editing = true;
      this.address.set_selected_range({ start: 0, end: this.address.value().length });
      cx.notify();
    });
    this.address.on("blur", (_e, cx) => {
      this.editing = false;
      this.address.set_value(this.shownUrl);
      cx.notify();
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
      finally { if (this.scanning.get(key) === at) this.scanning.delete(key); this.settle(cx); cx.notify(); }
    });
  }

  keep(key, scan) {
    if (!(this.scans.get(key)?.at > scan.at)) this.scans.set(key, scan);
  }

  current() {
    const target = this.target;
    return panelState({ target, scan: this.scans.get(machineKey(target?.machine)), start: this.starts.get(targetKey(target)), install: this.installs.get(machineKey(target?.machine)) });
  }

  settle(cx) {
    const target = this.target;
    if (!target || checking()) return;
    const state = this.current(), key = targetKey(target);
    if (!settledStart(state, this.starts.get(key))) this.starts.delete(key);
    const run = trackRun(this.runs.get(key), state, Date.now());
    if (run) this.runs.set(key, run);
    else this.runs.delete(key);
    const folder = sessionFolder(this.sessionFolders.get(key), state, this.folder);
    if (folder) this.sessionFolders.set(key, folder);
    else this.sessionFolders.delete(key);
    if (state.kind === "running" && state.url) {
      const next = remember(this.memory, target.machine, folder, state.url, Date.now());
      if (next) {
        this.memory = next;
        globalThis.localStorage?.setItem(MEMORY_KEY, JSON.stringify(next));
      }
    }
    if (autoStart(state, { visible: shown(), shownAt: this.shownAt, start: this.starts.get(key), run })) this.start(target, cx, true);
  }

  async detectAddress(target, folder) {
    const on = { on: target.machine, timeout: DETECT_MS };
    let detected = {}, sites = null;
    if (folder) {
      try { detected = parseDetection((await exec("sh", ["-c", DETECT, "sh", folder], on)).stdout); } catch {}
    }
    if (detected.herd) {
      try { sites = parseHerdSites((await exec("sh", herdArgs(detected.herd), on)).stdout); } catch {}
    }
    return pickAddress({ detected, sites, last: recall(this.memory, target.machine, folder) });
  }

  start(target, cx, auto = false) {
    const key = targetKey(target);
    if (this.starts.get(key)?.status === "starting") return;
    const folder = this.target === target ? this.folder : null;
    this.sessionFolders.set(key, folder);
    this.runs.delete(key);
    this.starts.set(key, { status: "starting" });
    if (this.installs.get(machineKey(target.machine))?.status !== "installing") this.installs.delete(machineKey(target.machine));
    this.streamErrors.delete(key);
    cx.notify();
    cx.spawn(async (cx) => {
      let result, opened = true;
      try {
        const url = await this.detectAddress(target, folder);
        const before = await discover(target.machine);
        this.keep(machineKey(target.machine), before);
        if (findSession(before.sessions, target.session)) {
          result = { status: "started" };
          opened = false;
        } else {
          const r = await exec("agent-browser", startArgs(target.session, url), { on: target.machine, timeout: 60000 });
          result = r.code === 0 ? { status: "started" } : { status: "failed", error: r.stderr.trim() || r.stdout.trim() || `exit ${r.code}` };
        }
      } catch (e) {
        result = { status: "failed", error: `agent-browser could not run on ${machineLabel(target.machine)}: ${reason(e)}` };
      }
      if (result.status === "started" && opened) {
        try {
          const s = await exec("agent-browser", streamArgs(target.session), { on: target.machine, timeout: 30000 });
          if (s.code !== 0) this.streamErrors.set(key, s.stderr.trim() || s.stdout.trim() || `exit ${s.code}`);
        } catch (e) {
          this.streamErrors.set(key, reason(e));
        }
      }
      this.keep(machineKey(target.machine), await discover(target.machine));
      if (auto && opened && result.status === "started") this.runs.set(key, { at: Date.now() });
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
    this.sized = null;
    this.shownUrl = "";
    this.address.set_value("");
    return feed ? feed.stop() : Promise.resolve();
  }

  fit(cx, wait = true) {
    const feed = this.feed;
    if (feed?.phase !== "live" || !shown()) return;
    const sent = this.sized?.connect === feed.connects ? this.sized : null;
    const step = resizeStep(viewportFor(this.area), sent, Date.now(), RESIZE_MS, feed.picture);
    if (step?.send) {
      const same = sent?.width === step.send.width && sent?.height === step.send.height;
      const sized = { ...step.send, at: Date.now(), connect: feed.connects, failures: same ? sent.failures : 0, refits: step.refit ? (sent.refits ?? 0) + 1 : 0 };
      this.sized = sized;
      cx.spawn(async (cx) => {
        try { await feed.command({ action: "viewport", ...step.send }); } catch (e) {
          if (this.sized !== sized) return;
          const failures = sized.failures + 1;
          this.sized = { ...sized, failures, retryAt: Date.now() + retryDelay(failures) };
          if (failures === 1) this.say(`viewport: ${reason(e)}`, cx);
        }
      });
    } else if (step?.wait && wait && !this.fitting) {
      this.fitting = true;
      cx.timer.after(step.wait, (cx) => {
        this.fitting = false;
        this.fit(cx);
      });
    }
  }

  box() {
    const zoom = Number(settings()?.zoom) || 1;
    return this.area && { width: this.area.width / zoom, height: this.area.height / zoom };
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
    const key = targetKey(this.target);
    const message = screenText({ port: state.port, streamError: this.streamErrors.get(key) ?? null, feed: feed && { phase: feed.phase, error: feed.error, empty: feed.frames.empty } });
    return div().id("browser-screen").relative().size_full()
      .on_size_change((size, cx) => {
        this.area = size;
        this.fit(cx);
      })
      .track_focus(this.h)
      .children(feed ? feed.frames.view(this.box()) : [])
      .when(Boolean(message), (el) => el.child(h_flex().absolute().inset_0().items_center().justify_center().px(20).text_size(12).text_color(t.dim).child(message)))
      .when(this.keysShown, (el) => el.child(div().absolute().inset_0().rounded_b(9).border_2().border_color(t.accent)))
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
    return v_flex().id("browser-viewer").flex_1().min_h(0)
      .child(v_flex().id("browser-chrome").flex_none().bg(t.chrome).border_b(1).border_color(t.border)
        .child(h_flex().id("browser-toolbar").h(42).px(8).gap(8).items_center()
          .child(h_flex().id("browser-history").flex_none().items_center()
            .child(iconButton(t, "browser-back", "back", "Back", (cx) => this.act({ action: "back" }, cx), 30, 18))
            .child(iconButton(t, "browser-forward", "forward", "Forward", (cx) => this.act({ action: "forward" }, cx), 30, 18)))
          .child(h_flex().flex_1().min_w(0).justify_center().child(this.addressField(t))))
        .when(Boolean(this.note), (el) => el.child(div().mx(10).mb(6).child(note(t, this.note.text, t.blocked))))
        .when(this.keysShown, (el) => el.child(h_flex().id("browser-keys").h(24).flex_none().mx(8).mb(6).px(10).gap(6).items_center().rounded(6).bg(t.solid).text_color(t.solid_foreground).text_size(12)
          .child(div().font_semibold().child("Keys go to the page"))
          .child(div().truncate().child("Herdr shortcuts too. Click outside the picture to give them back.")))))
      .child(div().id("browser-page").flex_1().min_h(0).rounded_b(9).overflow_hidden().bg(t.surface)
        .child(this.screen(t, state)));
  }

  addressKey(e, cx) {
    if (e.key !== "escape" || !this.editing) return;
    cx.stop_propagation();
    this.address.blur();
  }

  addressField(t) {
    const rest = addressAtRest(this.address.value());
    return h_flex().id("browser-address").relative().flex_1().min_w(80).max_w(640).h(30).pl(11).pr(4).gap(4).items_center().rounded(8).bg(t.surface)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_key_down((e, cx) => this.addressKey(e, cx))
      .child(Input.new(this.address).flex_1().h_full().text_size(13).text_color(t.foreground))
      .when(!this.editing, (el) => el.child(h_flex().id("browser-address-rest").absolute().inset_0().px(30).gap(6).justify_center().items_center().rounded(8).bg(t.surface).cursor_text()
        .on_mouse_down("left", (_e, cx) => {
          cx.stop_propagation();
          this.address.focus();
        })
        .when(rest.secure, (el) => el.child(icon("lock").size(12).flex_none().text_color(t.muted)))
        .child(div().min_w(0).truncate().text_size(13).text_color(rest.text ? t.foreground : t.dim).child(rest.text || "Go to…"))))
      .child(iconButton(t, "browser-reload", "reload", "Reload", (cx) => this.act({ action: "reload" }, cx), 22, 13));
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
        return this.viewer(t, state);
    }
  }

  render(cx) {
    const focus = focused();
    const next = follow(this.target, focus, spaces(), Date.now());
    const visible = !checking() && shown();
    if (visible && !this.visible) this.shownAt = Date.now();
    if (visible && (next !== this.target || !this.visible)) this.scan(cx, next);
    this.target = next;
    this.folder = terminalFolder(next, focus, panes());
    this.visible = visible;
    const target = this.target, key = targetKey(target);
    const install = this.installs.get(machineKey(target?.machine));
    const state = this.current();
    if (!settledStart(state, this.starts.get(key))) this.starts.delete(key);
    if (!settledInstall(state, install)) this.installs.delete(machineKey(target?.machine));
    this.sync(state, visible, cx);
    this.fit(cx, this.feed?.picture?.clean === false);
    this.keysShown = this.takesKeys();
    const t = theme();
    const title = state.kind === "running" ? pageTitle(this.feed?.tabs, this.feed?.url ?? state.url) : "";
    return v_flex().id("browser").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_semibold().child("Browser"))
        .when(Boolean(title), (el) => el.child(div().flex_none().text_color(t.dim).opacity(0.5).child("/")))
        .child(div().flex_1().min_w(0).truncate().child(title))
        .when(Boolean(target?.session), (el) => el.child(h_flex().flex_none().gap(6).items_center().text_size(12).text_color(t.dim)
          .child(div().child(target.session))
          .child(div().px(7).py(2).rounded(5).bg(t.surface).text_size(11).text_color(t.muted).child(machineLabel(target.machine))))))
      .child(v_flex().id("browser-body").flex_1().min_h(0).when(state.kind !== "running", (el) => el.p(14).gap(10)).child(this.body(t, state)));
  }
}
