import { WebSocket } from "websocket";
import { jpegSize, pageOf } from "./page.js";
import { Frames } from "./frames.js";

const reason = (e) => String(e?.message ?? e ?? "failed").replace(/^Error: /, "");
const IN_FLIGHT = 6;
const FRAMES_IN_FLIGHT = 2;

export class Feed {
  constructor(prefix, conn, fps) {
    this.conn = conn;
    this.fps = fps;
    this.frames = new Frames(prefix);
    this.phase = "connecting";
    this.error = null;
    this.page = null;
    this.latest = null;
    this.url = null;
    this.http = null;
    this.ws = null;
    this.queue = [];
    this.pending = 0;
    this.inFlight = 0;
    this.taken = null;
    this.stopped = false;
  }

  start(cx) {
    cx.spawn(async (cx) => this.loop(cx));
    return this;
  }

  stop() {
    this.stopped = true;
    this.ws?.close().catch(() => {});
    this.ws = null;
    this.queue = [];
    this.frames.clear();
    return this.conn.close();
  }

  async loop(cx) {
    let backoff = 1000;
    while (!this.stopped) {
      try {
        if (this.phase !== "connecting") {
          this.phase = "connecting";
          cx.notify();
        }
        const { http, port } = await this.conn.open(cx);
        if (this.stopped) throw null;
        this.http = http;
        const ws = await WebSocket.connect(`ws://127.0.0.1:${port}/?maxFps=${this.fps}&pacing=ack`);
        if (this.stopped) {
          ws.close().catch(() => {});
          throw null;
        }
        this.ws = ws;
        this.phase = "live";
        this.error = null;
        backoff = 1000;
        cx.notify();
        for (;;) {
          const msg = await ws.read();
          if (this.stopped) throw null;
          if (typeof msg === "string") this.handle(msg, cx);
        }
      } catch (e) {
        if (!this.stopped) this.error = reason(e);
      }
      this.ws?.close().catch(() => {});
      this.ws = null;
      this.http = null;
      this.queue = [];
      this.conn.close();
      if (this.stopped) break;
      this.phase = "error";
      cx.notify();
      await cx.sleep(backoff);
      backoff = Math.min(backoff * 2, 15000);
    }
  }

  handle(text, cx) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (m.type === "frame") {
      if (typeof m.data !== "string") return;
      this.latest = { data: m.data, width: m.metadata?.deviceWidth, seq: m.seq };
      this.show(cx);
    } else if (m.type === "url" && typeof m.url === "string") {
      this.url = m.url;
      cx.notify();
    }
  }

  show(cx) {
    const f = this.latest;
    if (!f || f === this.taken || this.inFlight >= FRAMES_IN_FLIGHT) return;
    this.taken = f;
    this.inFlight++;
    const bytes = Buffer.from(f.data, "base64");
    const page = pageOf(jpegSize(bytes), f.width);
    cx.spawn(async (cx) => {
      const shown = await this.frames.push(bytes, cx, () => {
        if (f.seq != null) this.send({ type: "ack", seq: f.seq });
      });
      this.inFlight--;
      if (shown) this.page = page ?? this.page;
      if (!this.stopped) this.show(cx);
    });
  }

  send(msg, droppable = false) {
    if (!this.ws || (droppable && this.queue.length + this.pending > 2)) return;
    this.queue.push(JSON.stringify(msg));
    this.pump();
  }

  pump() {
    const ws = this.ws;
    while (ws && this.pending < IN_FLIGHT && this.queue.length) {
      const text = this.queue.shift();
      this.pending++;
      ws.write(text).catch(() => {}).then(() => {
        this.pending--;
        if (this.ws === ws) this.pump();
      });
    }
  }

  async command(body) {
    if (!this.http) throw new Error("not connected");
    const r = await fetch(`${this.http}/api/command`, {
      method: "POST",
      headers: { Origin: this.http, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let j = null;
    try { j = await r.json(); } catch {}
    if (!r.ok || j?.success === false) throw new Error(j?.error ?? `HTTP ${r.status}`);
    return j?.data ?? null;
  }
}
