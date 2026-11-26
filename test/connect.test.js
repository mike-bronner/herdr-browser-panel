import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const stubs = {
  herdr: ["hc", "exec", "appHome", "readTextFile"].map((name) => `export const ${name} = (...a) => globalThis.host.${name}(...a);`).join("\n"),
  net: "export const connect = (...a) => globalThis.host.tcp(...a);",
  "fs/promises": "export const unlink = async () => {}; export const mkdir = async () => {};",
};
const hooks = `const stubs = ${JSON.stringify(stubs)};
export async function resolve(specifier, context, next) {
  if (Object.hasOwn(stubs, specifier)) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]), shortCircuit: true };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
const { connector } = await import("../mods/browser/connect.js");

function remoteHost() {
  const host = { execs: [], local: null };
  Object.assign(globalThis.host = host, {
    appHome: () => "/nonexistent",
    hc: async (args) => {
      if (args[0] === "machine") return { code: 0, stderr: "", stdout: JSON.stringify({ machines: [{ name: "build_box", target: "me@build.test" }] }) };
      if (args[0] === "run") {
        host.local = Number(/^127\.0\.0\.1:(\d+):/.exec(args[args.indexOf("-L") + 1])[1]);
        return { code: 0, stderr: "", stdout: "{}" };
      }
      return { code: 0, stderr: "", stdout: JSON.stringify({ state: "live" }) };
    },
    readTextFile: async () => `Local forwarding listening on 127.0.0.1 port ${host.local}.`,
    tcp: async (_ip, port) => {
      if (port !== host.local) throw new Error("refused");
      return { close: async () => {} };
    },
    exec: async (command, args) => {
      host.execs.push([command, ...args]);
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  return host;
}

test("closing a remote connection kills the ssh tunnel it opened, once", async () => {
  const host = remoteHost();
  const conn = connector("build_box", 4321);
  const opened = await conn.open({ sleep: async () => {} });
  assert.deepEqual(opened, { http: `http://127.0.0.1:${host.local}`, port: host.local });
  await conn.close();
  await conn.close();
  assert.deepEqual(host.execs, [["hc", "kill", `browser-tunnel-${host.local}`]]);
});

test("closing a local connection runs nothing", async () => {
  const host = remoteHost();
  const conn = connector(null, 4321);
  assert.deepEqual(await conn.open({ sleep: async () => {} }), { http: "http://127.0.0.1:4321", port: 4321 });
  await conn.close();
  assert.deepEqual(host.execs, []);
});
