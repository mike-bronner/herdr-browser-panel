import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DETECT, HERD_SITES, openable, appUrl, inside, loopback, herdConfig, parseDetection, herdArgs, parseHerdSites, listenerUrl, herdUrl, recall, remember, readMemory, pickAddress, place } from "../mods/browser/address.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "browser-address-")));
after(() => rmSync(root, { recursive: true, force: true }));

const HOME = "/home/me";
const PROJECT = "/home/me/code/shop";

function sh(script, args, env = {}) {
  return execFileSync("sh", ["-c", script, "sh", ...args], { cwd: root, env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
}

test("openable accepts http and https addresses and refuses every other scheme or shape", () => {
  assert.equal(openable("https://shop.test"), "https://shop.test/");
  assert.equal(openable("http://127.0.0.1:8000/x?y=1"), "http://127.0.0.1:8000/x?y=1");
  for (const bad of ["about:blank", "javascript:alert(1)", "file:///etc/passwd", "ftp://x", "data:text/html,x", "shop.test", "", null, 7, "http://", "https://user:pw@shop.test", "https://user@shop.test", "http://a b", "http://x/\ny", `https://x/${"a".repeat(2048)}`]) {
    assert.equal(openable(bad), null, String(bad).slice(0, 40));
  }
});

test("appUrl reads only the APP_URL line from file content", () => {
  const content = ["APP_NAME=Shop", "DB_PASSWORD=hunter2", "APP_URL=https://shop.test", "APP_URL=https://second.test", "MAIL_PASSWORD=x"].join("\n");
  assert.equal(appUrl(content), "https://shop.test/");
});

test("appUrl takes quoted, exported, spaced and commented values", () => {
  assert.equal(appUrl('APP_URL="https://a.test/app"'), "https://a.test/app");
  assert.equal(appUrl("APP_URL='http://b.test'"), "http://b.test/");
  assert.equal(appUrl("export APP_URL=https://c.test"), "https://c.test/");
  assert.equal(appUrl("  APP_URL = https://d.test  # local"), "https://d.test/");
  assert.equal(appUrl('APP_URL="https://e.test" # local'), "https://e.test/");
  assert.equal(appUrl("APP_URL=https://f.test\r\nX=1"), "https://f.test/");
});

test("appUrl refuses a value that is not a plain http or https address", () => {
  for (const line of ["APP_URL=", "APP_URL=localhost", "APP_URL=ftp://x.test", "APP_URL=javascript:alert(1)", "APP_URL=${APP_HOST}", "APP_URL=https://${HOST}.test", 'APP_URL="https://x.test', "APP_URL=https://u:p@x.test", "# APP_URL=https://x.test", "MY_APP_URL=https://x.test", "APP_URLS=https://x.test"]) {
    assert.equal(appUrl(line), null, line);
  }
  assert.equal(appUrl(null), null);
  assert.equal(appUrl(""), null);
});

test("appUrl stops at the first APP_URL line even when it is invalid", () => {
  assert.equal(appUrl("APP_URL=nope\nAPP_URL=https://later.test"), null);
});

test("inside matches the folder itself and folders below it, not a sibling with the same prefix", () => {
  assert.equal(inside("/a/shop", "/a/shop"), true);
  assert.equal(inside("/a/shop/app", "/a/shop"), true);
  assert.equal(inside("/a/shop/app", "/a/shop/"), true);
  assert.equal(inside("/a/shopper", "/a/shop"), false);
  assert.equal(inside("/a", "/a/shop"), false);
  assert.equal(inside("relative/shop", "relative"), false);
  assert.equal(inside(null, "/a"), false);
});

test("loopback maps wildcard and loopback hosts to an address the browser can open, and refuses others", () => {
  for (const h of ["*", "0.0.0.0", "127.0.0.1", "127.0.1.1", "[::]", "::", "127.0.0.53%lo", "[::ffff:0.0.0.0]"]) assert.equal(loopback(h), "127.0.0.1", h);
  assert.equal(loopback("[::1]"), "[::1]");
  assert.equal(loopback("::1"), "[::1]");
  for (const h of ["192.168.1.5", "[fe80::1]", "example.com", "", null]) assert.equal(loopback(h), null, String(h));
});

test("parseDetection reads macOS lsof listeners with their working folders", () => {
  const out = [
    `home\t${HOME}`, `folder\t${PROJECT}`,
    "lsof\tp100", "lsof\tf20", "lsof\tn*:5173", "lsof\tf21", "lsof\tn[::1]:5173",
    "lsof\tp200", "lsof\tf9", "lsof\tn127.0.0.1:8000",
    "lsof\tp300", "lsof\tf4", "lsof\tn*:7000",
    "lsofcwd\tp100", "lsofcwd\tfcwd", `lsofcwd\tn${PROJECT}`,
    "lsofcwd\tp200", "lsofcwd\tfcwd", `lsofcwd\tn${PROJECT}/api`,
    "lsofcwd\tp300", "lsofcwd\tfcwd", "lsofcwd\tn/",
  ].join("\n");
  const d = parseDetection(out);
  assert.equal(d.home, HOME);
  assert.equal(d.folder, PROJECT);
  assert.deepEqual(d.listeners, [
    { host: "*", port: 5173, pid: "100", cwd: PROJECT },
    { host: "[::1]", port: 5173, pid: "100", cwd: PROJECT },
    { host: "127.0.0.1", port: 8000, pid: "200", cwd: `${PROJECT}/api` },
    { host: "*", port: 7000, pid: "300", cwd: "/" },
  ]);
});

test("parseDetection reads Linux ss listeners, with and without a header, and their /proc working folders", () => {
  const out = [
    `home\t${HOME}`, `folder\t${PROJECT}`,
    "ss\tState  Recv-Q Send-Q Local Address:Port Peer Address:Port Process",
    'ss\tLISTEN 0      511    0.0.0.0:3000      0.0.0.0:*     users:(("node",pid=4242,fd=21))',
    'ss\tLISTEN 0      511    [::]:3000         [::]:*        users:(("node",pid=4242,fd=22))',
    'ss\tLISTEN 0      4096   127.0.0.53%lo:53  0.0.0.0:*',
    'ss\tLISTEN 0      100    *:8000            *:*           users:(("php",pid=7,fd=3),("php",pid=8,fd=3))',
    `cwd\t4242\t${PROJECT}`,
    `cwd\t7\t${PROJECT}/back end`,
    "cwd\t8\t",
  ].join("\n");
  assert.deepEqual(parseDetection(out).listeners, [
    { host: "0.0.0.0", port: 3000, pid: "4242", cwd: PROJECT },
    { host: "[::]", port: 3000, pid: "4242", cwd: PROJECT },
    { host: "*", port: 8000, pid: "7", cwd: `${PROJECT}/back end` },
    { host: "*", port: 8000, pid: "8", cwd: null },
  ]);
});

test("parseDetection skips lines it cannot read and ports out of range", () => {
  const d = parseDetection(["junk", "lsof\tn*:80", "lsof\tp1", "lsof\tn*:0", "lsof\tn*:70000", "lsof\tnnot-a-port", "ss\tLISTEN 0 1 *:99999 *:* users:((\"x\",pid=1,fd=1))"].join("\n"));
  assert.deepEqual(d.listeners, []);
  assert.equal(d.folder, null);
  assert.equal(d.herd, null);
  assert.deepEqual(parseDetection(undefined).listeners, []);
});

test("parseDetection parses the APP_URL line and the Herd config it was given", () => {
  const herd = "/Users/me/Library/Application Support/Herd/config/valet";
  const d = parseDetection([
    "appurl\tAPP_URL=https://shop.test",
    `herd\t${herd}`,
    'herdconfig\t{    "paths": [        "/Users/me/Sites/",        "relative",        7    ],    "tld": "TEST"}',
    "hot\thttp://[::1]:5173",
  ].join("\n"));
  assert.equal(d.appUrl, "https://shop.test/");
  assert.equal(d.hot, "http://[::1]:5173");
  assert.deepEqual(d.herd, { dir: herd, tld: "test", paths: ["/Users/me/Sites/"] });
});

test("parseDetection keeps no Herd setup when its config is missing or unreadable", () => {
  assert.equal(parseDetection("herd\t/x").herd, null);
  assert.equal(parseDetection("herd\t/x\nherdconfig\t{not json").herd, null);
  assert.equal(parseDetection('herd\t/x\nherdconfig\t{"paths":[],"tld":"te st"}').herd, null);
  assert.equal(parseDetection('herd\t/x\nherdconfig\t{"tld":"test"}').herd, null);
  assert.equal(parseDetection('herdconfig\t{"paths":[],"tld":"test"}').herd, null);
});

test("herdConfig needs a plain tld and a list of paths", () => {
  assert.deepEqual(herdConfig('{"paths":["/a","~/b"],"tld":"test"}'), { tld: "test", paths: ["/a"] });
  assert.equal(herdConfig("null"), null);
});

test("listenerUrl opens the lowest port served from inside the terminal's folder", () => {
  const listeners = [
    { host: "*", port: 9000, cwd: PROJECT },
    { host: "127.0.0.1", port: 8000, cwd: `${PROJECT}/api` },
    { host: "*", port: 3000, cwd: "/home/me/code/other" },
    { host: "*", port: 2000, cwd: "/home/me/code/shopper" },
    { host: "*", port: 1000, cwd: null },
  ];
  assert.equal(listenerUrl({ folder: PROJECT, home: HOME, listeners }), "http://127.0.0.1:8000");
});

test("listenerUrl prefers the IPv4 loopback for one port and uses [::1] for an IPv6-only server", () => {
  assert.equal(listenerUrl({ folder: PROJECT, home: HOME, listeners: [{ host: "[::1]", port: 5173, cwd: PROJECT }, { host: "*", port: 5173, cwd: PROJECT }] }), "http://127.0.0.1:5173");
  assert.equal(listenerUrl({ folder: PROJECT, home: HOME, listeners: [{ host: "[::1]", port: 5173, cwd: PROJECT }] }), "http://[::1]:5173");
});

test("listenerUrl skips a server bound to another interface only", () => {
  assert.equal(listenerUrl({ folder: PROJECT, home: HOME, listeners: [{ host: "192.168.1.5", port: 8000, cwd: PROJECT }] }), null);
});

test("listenerUrl skips the Vite asset server that public/hot names, so the app behind it is found", () => {
  const listeners = [{ host: "[::1]", port: 5173, cwd: PROJECT }, { host: "127.0.0.1", port: 8000, cwd: PROJECT }];
  assert.equal(listenerUrl({ folder: PROJECT, home: HOME, listeners, hot: "http://[::1]:5173" }), "http://127.0.0.1:8000");
  assert.equal(listenerUrl({ folder: PROJECT, home: HOME, listeners: listeners.slice(0, 1), hot: "http://[::1]:5173" }), null);
  assert.equal(listenerUrl({ folder: PROJECT, home: HOME, listeners: listeners.slice(0, 1), hot: "garbage" }), "http://[::1]:5173");
});

test("listenerUrl finds nothing for the home folder, a folder above it, the root, or an unknown folder or home", () => {
  const listeners = [{ host: "*", port: 3000, cwd: PROJECT }];
  for (const folder of [HOME, "/home", "/", null]) assert.equal(listenerUrl({ folder, home: HOME, listeners }), null, String(folder));
  assert.equal(listenerUrl({ folder: PROJECT, home: null, listeners }), null);
  assert.equal(listenerUrl({ folder: PROJECT, home: HOME }), null);
});

const SITES = {
  certs: new Set(["crossbible-lexicon.test.crt", "shop.test.crt"]),
  entries: [
    { name: "crossbible-lexicon", link: true, path: "/dev/worktrees/crossbible/extract-greek" },
    { name: "extract-greek", link: false, path: "/dev/worktrees/crossbible/extract-greek" },
    { name: "crossbible", link: false, path: "/dev/CrossBible" },
    { name: "Shop", link: false, path: "/dev/Sites/Shop" },
    { name: "bad_name", link: false, path: "/dev/Sites/bad_name" },
    { name: "a..b", link: false, path: "/dev/Sites/a..b" },
  ],
};
const HERD = { dir: "/h", tld: "test", paths: [] };

test("herdUrl serves a parked folder as its name under the tld, https when Herd holds its certificate", () => {
  assert.equal(herdUrl({ folder: "/dev/Sites/Shop", herd: HERD, sites: SITES }), "https://shop.test");
  assert.equal(herdUrl({ folder: "/dev/CrossBible", herd: HERD, sites: SITES }), "http://crossbible.test");
});

test("herdUrl gives a folder deeper inside a site to that site", () => {
  assert.equal(herdUrl({ folder: "/dev/CrossBible/app/Models", herd: HERD, sites: SITES }), "http://crossbible.test");
});

test("herdUrl prefers a named link over the parked folder that serves the same folder", () => {
  assert.equal(herdUrl({ folder: "/dev/worktrees/crossbible/extract-greek/src", herd: HERD, sites: SITES }), "https://crossbible-lexicon.test");
});

test("herdUrl prefers the deepest site holding the folder", () => {
  const sites = { certs: new Set(), entries: [{ name: "outer", link: false, path: "/dev/outer" }, { name: "inner", link: true, path: "/dev/outer/packages/inner" }] };
  assert.equal(herdUrl({ folder: "/dev/outer/packages/inner/src", herd: HERD, sites }), "http://inner.test");
  assert.equal(herdUrl({ folder: "/dev/outer/packages", herd: HERD, sites }), "http://outer.test");
});

test("herdUrl finds nothing for a folder no site holds, a site name a host cannot carry, or no Herd", () => {
  assert.equal(herdUrl({ folder: "/dev/Sites", herd: HERD, sites: SITES }), null);
  assert.equal(herdUrl({ folder: "/dev/Sites/bad_name", herd: HERD, sites: SITES }), null);
  assert.equal(herdUrl({ folder: "/dev/Sites/a..b", herd: HERD, sites: SITES }), null);
  assert.equal(herdUrl({ folder: "/dev/CrossBible", herd: null, sites: SITES }), null);
  assert.equal(herdUrl({ folder: "/dev/CrossBible", herd: HERD, sites: null }), null);
  assert.equal(herdUrl({ folder: null, herd: HERD, sites: SITES }), null);
});

test("parseHerdSites reads certificates, folders and links", () => {
  const s = parseHerdSites(["cert\tShop.test.crt", "dir\tshop\t/dev/Sites/shop", "link\tlex\t/dev/with\ttab", "dir\tnopath", "other\tx\ty"].join("\n"));
  assert.deepEqual([...s.certs], ["shop.test.crt"]);
  assert.deepEqual(s.entries, [{ name: "shop", link: false, path: "/dev/Sites/shop" }, { name: "lex", link: true, path: "/dev/with\ttab" }]);
});

test("herdArgs passes the Herd folder and parked paths as arguments, never as script text", () => {
  const args = herdArgs({ dir: "/h/valet", paths: ["/a b/$(x)", "/c"] });
  assert.deepEqual(args, ["-c", HERD_SITES, "sh", "/h/valet", "/a b/$(x)", "/c"]);
  assert.throws(() => herdArgs({ dir: "relative", paths: [] }), /not a Herd folder/);
  assert.throws(() => herdArgs(null), /not a Herd folder/);
});

test("remember keeps the last http or https address per machine and folder, without its query or fragment", () => {
  const m1 = remember({}, null, PROJECT, "https://shop.test/cart?token=abc#x", 1);
  assert.deepEqual(m1, { [`|${PROJECT}`]: { url: "https://shop.test/cart", at: 1 } });
  const m2 = remember(m1, "box", PROJECT, "http://127.0.0.1:3000/", 2);
  assert.equal(recall(m2, null, PROJECT), "https://shop.test/cart");
  assert.equal(recall(m2, "box", PROJECT), "http://127.0.0.1:3000/");
  assert.equal(recall(m2, "box", "/elsewhere"), null);
});

test("remember changes nothing for a blank page, an unsafe address, an unknown folder or the same address", () => {
  const m = { [`|${PROJECT}`]: { url: "https://shop.test/", at: 1 } };
  for (const url of ["about:blank", "chrome://settings", "file:///x", null]) assert.equal(remember(m, null, PROJECT, url, 2), null, String(url));
  assert.equal(remember(m, null, null, "https://x.test/", 2), null);
  assert.equal(remember(m, null, PROJECT, "https://shop.test/?q=1", 2), null);
});

test("remember drops the oldest folders past its limit", () => {
  let m = {};
  for (let i = 0; i < 201; i++) m = remember(m, null, `/p/${i}`, `https://s${i}.test/`, i);
  assert.equal(Object.keys(m).length, 200);
  assert.equal(recall(m, null, "/p/0"), null);
  assert.equal(recall(m, null, "/p/200"), "https://s200.test/");
});

test("recall refuses a stored value that is not an openable address", () => {
  assert.equal(recall({ "|/p": { url: "javascript:alert(1)" } }, null, "/p"), null);
  assert.equal(recall({ "|/p": "https://x.test" }, null, "/p"), null);
  assert.equal(recall(null, null, "/p"), null);
});

test("readMemory gives an empty memory for missing or broken storage", () => {
  assert.deepEqual(readMemory(null), {});
  assert.deepEqual(readMemory("{bad"), {});
  assert.deepEqual(readMemory("[1]"), {});
  assert.deepEqual(readMemory('{"|/p":{"url":"https://x.test/","at":1}}'), { "|/p": { url: "https://x.test/", at: 1 } });
});

const shopDetected = (extra = {}) => ({
  home: HOME, folder: PROJECT, hot: null,
  listeners: [{ host: "*", port: 3000, cwd: PROJECT }],
  herd: { dir: "/h", tld: "test", paths: [] },
  appUrl: "https://vapor.example.com/",
  ...extra,
});
const shopSites = { certs: new Set(["shop.test.crt"]), entries: [{ name: "shop", link: false, path: PROJECT }] };

test("pickAddress opens a listening server first, over every fallback", () => {
  assert.equal(pickAddress({ detected: shopDetected(), sites: shopSites, last: "https://last.test/" }), "http://127.0.0.1:3000");
});

test("pickAddress opens the folder's last address when no server listens", () => {
  assert.equal(pickAddress({ detected: shopDetected({ listeners: [] }), sites: shopSites, last: "https://last.test/" }), "https://last.test/");
});

test("pickAddress opens Herd's site next, then APP_URL, then a blank page", () => {
  assert.equal(pickAddress({ detected: shopDetected({ listeners: [] }), sites: shopSites, last: null }), "https://shop.test");
  assert.equal(pickAddress({ detected: shopDetected({ listeners: [] }), sites: null, last: null }), "https://vapor.example.com/");
  assert.equal(pickAddress({ detected: shopDetected({ listeners: [], herd: null }), sites: shopSites, last: null }), "https://vapor.example.com/");
  assert.equal(pickAddress({ detected: shopDetected({ listeners: [], appUrl: null }), sites: null, last: null }), "about:blank");
  assert.equal(pickAddress({ detected: {}, sites: null, last: null }), "about:blank");
  assert.equal(pickAddress({}), "about:blank");
});

test("pickAddress opens the address the panel was hidden at first, ahead of a listening server", () => {
  assert.equal(pickAddress({ detected: shopDetected(), sites: shopSites, last: "https://last.test/", hidden: "https://shop.test/cart" }), "https://shop.test/cart");
});

test("pickAddress falls through an unsafe hidden address to the listening server", () => {
  for (const hidden of ["javascript:alert(1)", "file:///etc/passwd", "https://me:pw@shop.test/", null, undefined]) {
    assert.equal(pickAddress({ detected: shopDetected(), sites: shopSites, last: null, hidden }), "http://127.0.0.1:3000", String(hidden));
  }
});

test("remember keeps the whole address when asked, and still refuses one it may not open", () => {
  const m = remember({}, null, PROJECT, "https://shop.test/cart?token=abc#x", 1, { whole: true });
  assert.equal(recall(m, null, PROJECT), "https://shop.test/cart?token=abc#x");
  assert.equal(remember(m, null, PROJECT, "https://shop.test/cart?token=abc#x", 2, { whole: true }), null);
  assert.equal(remember(m, null, PROJECT, "https://me:pw@shop.test/", 2, { whole: true }), null);
  assert.equal(remember(m, null, PROJECT, "javascript:alert(1)", 2, { whole: true }), null);
});

test("place keys a Herdr space apart from any folder, and falls back to the folder with no space", () => {
  assert.equal(place("s1", "/home/me/shop"), "space:s1");
  assert.equal(place("build_box/s2", null), "space:build_box/s2");
  assert.equal(place(null, "/home/me/shop"), "/home/me/shop");
  assert.equal(place("", "/home/me/shop"), "/home/me/shop");
  assert.equal(place(undefined, undefined), null);
  const m = remember({}, null, place("s1", "/home/me/shop"), "https://shop.test/a?token=abc#x", 1, { whole: true });
  assert.equal(recall(m, null, place("s1", null)), "https://shop.test/a?token=abc#x");
  assert.equal(recall(m, null, place(null, "/home/me/shop")), null);
});

test("pickAddress falls through an unsafe last address and an unsafe APP_URL", () => {
  assert.equal(pickAddress({ detected: shopDetected({ listeners: [], herd: null, appUrl: "javascript:alert(1)" }), last: "file:///etc/passwd" }), "about:blank");
});

function listen(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", "const s=require('net').createServer().listen(0,'127.0.0.1',()=>console.log(s.address().port))"], { cwd, stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.once("data", (d) => resolve({ child, port: Number(String(d).trim()) }));
    child.once("error", reject);
  });
}

test("DETECT finds a server listening from inside the terminal's folder on this machine", { skip: process.platform !== "darwin" && process.platform !== "linux" }, async () => {
  const home = join(root, "home");
  const project = join(home, "code", "app");
  const sub = join(project, "web");
  mkdirSync(sub, { recursive: true });
  const { child, port } = await listen(sub);
  try {
    const d = parseDetection(sh(DETECT, [project], { HOME: home }));
    assert.equal(d.folder, project);
    assert.equal(d.home, home);
    assert.ok(d.listeners.some((l) => l.port === port && l.cwd === sub), JSON.stringify(d.listeners));
    assert.equal(listenerUrl(d), `http://127.0.0.1:${port}`);
    assert.equal(parseDetection(sh(DETECT, ["~/code/app"], { HOME: home })).folder, project);
  } finally {
    child.kill();
  }
});

test("DETECT reads public/hot and Herd's config under the machine's home, and passes a hostile folder name as data", () => {
  const home = join(root, "herdhome");
  const valet = join(home, "Library", "Application Support", "Herd", "config", "valet");
  const project = join(root, "it's $(touch pwned) `x`");
  mkdirSync(join(project, "public"), { recursive: true });
  mkdirSync(valet, { recursive: true });
  writeFileSync(join(project, "public", "hot"), "http://[::1]:5173\r\n");
  writeFileSync(join(valet, "config.json"), JSON.stringify({ paths: ["/x/Sites/"], tld: "test" }, null, 4));
  const d = parseDetection(sh(DETECT, [project], { HOME: home }));
  assert.equal(d.folder, project);
  assert.equal(d.hot, "http://[::1]:5173");
  assert.deepEqual(d.herd, { dir: valet, tld: "test", paths: ["/x/Sites/"] });
  assert.equal(d.appUrl, null);
  assert.throws(() => execFileSync("ls", [join(root, "pwned")], { stdio: "ignore" }));
});

test("DETECT reports an empty folder for one that does not exist, so nothing is matched to it", () => {
  const d = parseDetection(sh(DETECT, [join(root, "missing")], { HOME: join(root, "nohome") }));
  assert.equal(d.folder, null);
  assert.equal(listenerUrl(d), null);
});

test("HERD_SITES lists parked folders, named links with their targets, and certificate names", () => {
  const valet = join(root, "valet");
  const parked = join(root, "parked");
  const links = join(valet, "Sites");
  const target = join(root, "worktrees", "lexicon");
  mkdirSync(join(valet, "Certificates"), { recursive: true });
  mkdirSync(join(parked, "shop"), { recursive: true });
  mkdirSync(links, { recursive: true });
  mkdirSync(target, { recursive: true });
  writeFileSync(join(parked, "notes.txt"), "");
  symlinkSync(target, join(links, "crossbible-lexicon"));
  symlinkSync(join(root, "gone"), join(links, "dangling"));
  for (const f of ["shop.test.crt", "shop.test.key", "crossbible-lexicon.test.crt"]) writeFileSync(join(valet, "Certificates", f), "");
  const sites = parseHerdSites(sh(HERD_SITES, [valet, `${parked}/`, links, join(root, "absent")]));
  assert.deepEqual([...sites.certs].sort(), ["crossbible-lexicon.test.crt", "shop.test.crt"]);
  assert.deepEqual(sites.entries, [
    { name: "shop", link: false, path: join(parked, "shop") },
    { name: "crossbible-lexicon", link: true, path: target },
  ]);
  assert.equal(herdUrl({ folder: join(target, "src"), herd: { tld: "test" }, sites }), "https://crossbible-lexicon.test");
  assert.equal(herdUrl({ folder: join(parked, "shop"), herd: { tld: "test" }, sites }), "https://shop.test");
});

const DOTFILE = [".", "e", "n", "v"].join("");

function envTree(name) {
  const home = join(root, name, "home");
  mkdirSync(home, { recursive: true });
  return home;
}

test("DETECT returns the nearest project file's APP_URL line and no other line of it", () => {
  const home = envTree("env-nearest");
  const parent = join(home, "code", "mono");
  const project = join(parent, "apps", "shop");
  const folder = join(project, "src", "deep");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(parent, DOTFILE), "SECRET=hunter2\nAPP_URL=https://parent.test\n");
  writeFileSync(join(project, DOTFILE), "SECRET=hunter2\nAPP_URL=https://shop.test\nOTHER=hunter2\n");
  const raw = sh(DETECT, [folder], { HOME: home });
  assert.equal(raw.includes("hunter2"), false);
  assert.equal(parseDetection(raw).appUrl, "https://shop.test/");
  assert.equal(parseDetection(sh(DETECT, [join(parent, "apps")], { HOME: home })).appUrl, "https://parent.test/");
});

test("DETECT does not read the file in the home folder itself", () => {
  const home = envTree("env-home");
  const folder = join(home, "code", "shop");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(home, DOTFILE), "APP_URL=https://home.test\n");
  assert.equal(parseDetection(sh(DETECT, [folder], { HOME: home })).appUrl, null);
});

test("DETECT matches the exported, spaced and indented APP_URL forms", () => {
  const home = envTree("env-forms");
  const forms = { exported: "export APP_URL = https://exported.test", indented: "   APP_URL=https://indented.test", tabbed: "\tAPP_URL\t=\t'https://tabbed.test'" };
  for (const [name, line] of Object.entries(forms)) {
    const folder = join(home, name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, DOTFILE), `SECRET=hunter2\n${line}\n`);
    const raw = sh(DETECT, [folder], { HOME: home });
    assert.equal(raw.includes("hunter2"), false, name);
    assert.equal(parseDetection(raw).appUrl, `https://${name}.test/`, name);
  }
});

test("DETECT gives no APP_URL for a project file without that line, and does not look past it", () => {
  const home = envTree("env-none");
  const parent = join(home, "code");
  const folder = join(parent, "shop");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(parent, DOTFILE), "APP_URL=https://parent.test\n");
  writeFileSync(join(folder, DOTFILE), "SECRET=hunter2\nMY_APP_URL=https://no.test\n");
  const raw = sh(DETECT, [folder], { HOME: home });
  assert.equal(raw.includes("hunter2"), false);
  assert.equal(parseDetection(raw).appUrl, null);
});
