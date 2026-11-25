import { hc, exec, appHome, readTextFile } from "herdr";
import { connect as tcp } from "net";
import { unlink, mkdir } from "fs/promises";
import { tunnelArgs, sshFor } from "./page.js";

const LOGS = () => `${appHome()}/data/browser`;

async function machineNamed(name) {
  const r = await hc(["machine", "ls", "--json"]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "hc machine ls failed");
  const machine = (JSON.parse(r.stdout).machines ?? []).find((m) => m.name === name && !m.temporary);
  if (!machine) throw new Error(`${name} is not one of Herdr's machines`);
  return machine;
}

async function listening(port) {
  try {
    const s = await tcp("127.0.0.1", port);
    await s.close();
    return true;
  } catch {
    return false;
  }
}

async function alive(name) {
  const r = await hc(["get", name, "--json"]).catch(() => null);
  if (!r || r.code !== 0) return false;
  try { return JSON.parse(r.stdout).state === "live"; } catch { return false; }
}

async function forwarding(log, port) {
  const text = (await readTextFile(log).catch(() => "")) ?? "";
  if (text.includes(`cannot listen to port: ${port}`)) return "failed";
  return text.includes(`Local forwarding listening on 127.0.0.1 port ${port}.`) ? "bound" : "waiting";
}

async function sshError(log) {
  const text = (await readTextFile(log).catch(() => "")) ?? "";
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("debug"));
  return { text, last: lines.at(-1) || "ssh exited" };
}

async function tunnel(cx, machine, remotePort) {
  const target = sshFor(machine);
  await mkdir(LOGS(), { recursive: true }).catch(() => {});
  let last = "ssh failed";
  for (let attempt = 0; attempt < 4; attempt++) {
    const port = 20000 + Math.floor(Math.random() * 12000);
    if (await listening(port)) continue;
    const name = `browser-tunnel-${port}`;
    const log = `${LOGS()}/ssh-${port}.log`;
    const r = await hc(["run", "--bg", "--rm", "--no-parent", "--no-notify", "--json", "--name", name, "--label", "browser=tunnel", "--", ...tunnelArgs(target, port, remotePort, log)]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || "hc run failed");
    let ok = 0;
    for (let i = 0; i < 60 && ok < 2; i++) {
      const state = await forwarding(log, port);
      if (state === "failed" || (i > 2 && !(await alive(name)))) break;
      ok = state === "bound" && (await listening(port)) ? ok + 1 : 0;
      if (ok < 2) await cx.sleep(150);
    }
    if (ok === 2) {
      unlink(log).catch(() => {});
      return { port, name };
    }
    const err = await sshError(log);
    last = err.last;
    unlink(log).catch(() => {});
    await hc(["kill", name]).catch(() => {});
    if (!/address already in use|cannot listen to port/i.test(err.text)) break;
  }
  throw new Error(last);
}

export function connector(machineName, port) {
  let made = null;
  let closed = false;
  return {
    async open(cx) {
      closed = false;
      if (!machineName) return { http: `http://127.0.0.1:${port}`, port };
      const opened = await tunnel(cx, await machineNamed(machineName), port);
      if (closed) {
        await exec("hc", ["kill", opened.name]).catch(() => {});
        throw new Error("stopped");
      }
      made = opened;
      return { http: `http://127.0.0.1:${made.port}`, port: made.port };
    },
    close() {
      closed = true;
      const name = made?.name;
      made = null;
      return name ? exec("hc", ["kill", name]).then(() => {}, () => {}) : Promise.resolve();
    },
  };
}
