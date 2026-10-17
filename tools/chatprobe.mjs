// /secret chat end to end: two browsers (Alice, Bob), each with a fake wedgie running Secrets (fakewedgies:
// its hello carries the key; secret_open is answered here in node with that wedgie's private key, the way its
// chip would, and the text is kept here: the "screen"). The real mailbox (api/chat.ts) under vite, on an
// in-memory Postgres (tools/neonlite.mjs).
//  1. Alice adds Bob by his link and writes; Bob sees a new chat, shows it on his wedgie: the text matches,
//     and it never appears in Bob's page.
//  2. Bob adds Alice, replies; Alice shows it (one ask), then Bob's next message goes to her wedgie with no click.
//  3. The mailbox refuses bad keys, bad messages, bad boxes.
// Run: node tools/chatprobe.mjs
import { chromium } from "playwright-core";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { fakeWedgies } from "./fakewedgies.mjs";

const VPORT = 5198, SITE = `http://localhost:${VPORT}`;
const kids = [];
process.on("exit", () => kids.forEach((k) => k.kill()));
let fails = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); fails += !c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f(); if (v) return v; await sleep(200); } return null; };

function person() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const pub = ecdh.getPublicKey();
  const id = crypto.createHash("sha256").update(pub).digest("hex").slice(0, 8);
  return { ecdh, pub: pub.toString("hex"), id: id.slice(0, 4) + " " + id.slice(4), link: `${SITE}/secret#${pub.toString("base64url")}`, screen: [], asks: 0 };
}
// secret_box.py, in node
function open(p, blob) {
  const b = Buffer.from(blob.slice(8), "base64url");
  const E = b.subarray(0, 65), iv = b.subarray(65, 81), ct = b.subarray(81, b.length - 32), tag = b.subarray(b.length - 32);
  const z = p.ecdh.computeSecret(E);
  const k = Buffer.from(crypto.hkdfSync("sha256", z, Buffer.alloc(0), Buffer.concat([Buffer.from("wedgie1"), E, Buffer.from(p.pub, "hex")]), 64));
  const want = crypto.createHmac("sha256", k.subarray(32)).update(Buffer.concat([iv, ct])).digest();
  if (!crypto.timingSafeEqual(want, tag)) throw new Error("not for this wedgie");
  const d = crypto.createDecipheriv("aes-256-cbc", k.subarray(0, 32), iv);
  return Buffer.concat([d.update(ct), d.final()]).toString();
}

const vite = spawn("npx", ["vite", "--port", String(VPORT), "--strictPort"], { stdio: ["ignore", "pipe", "inherit"],
  env: { ...process.env, SHOP_DATABASE_URL_DEV: "pglite", SHOP_MAIL_FILE: "/dev/null" } });
kids.push(vite);
for (let i = 0; ; i++) { try { if ((await fetch(SITE + "/api/chat?box=" + "0".repeat(64))).ok) break; } catch {} if (i > 100) throw new Error("vite didn't start"); await sleep(300); }

const cache = homedir() + "/Library/Caches/ms-playwright";
const shell = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: `${cache}/${shell}/${process.platform === "linux" ? "chrome-headless-shell-linux64" : "chrome-headless-shell-mac-arm64"}/chrome-headless-shell` });

async function page(p, uid) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1400 } });
  let chatWith = null;     // the app: a chat open with this name skips the ask
  await ctx.exposeBinding("__open", (_, m) => {
    if (chatWith === null || chatWith !== m.from || !m.from) p.asks++;
    try { p.screen.push(open(p, m.blob)); } catch (e) { return { type: "error", error: e.message }; }
    chatWith = m.from || null;
    return { type: "secret_shown", chat: true };
  });
  await ctx.addInitScript(fakeWedgies, [{ uid, machine: "Raspberry Pi Pico with RP2040",
    files: { "main.py": 1, "slot.py": 1, "wedgiedrive.py": 1, "wedgie.py": 'VERSION = "0.3.48"', "apps.json": JSON.stringify([{ mod: "secret", name: "Secrets" }]), "secret.py": 1 },
    chip: "none", hello: { running: "secret", secret: { pub: p.pub, chip: "OPTIGA Trust M", id: p.id } }, app: { secret_open: "__open" } }]);
  const pg = await ctx.newPage();
  pg.on("pageerror", (e) => ok(false, "page error: " + e.message));
  return pg;
}

const A = person(), B = person();
const pa = await page(A, "aa11bb22cc000001"), pb = await page(B, "aa11bb22cc000002");

// 1. Alice writes to Bob
await pa.goto(B.link);
ok(await until(() => pa.locator("#x-me").textContent().then((t) => t.includes(A.id))), "Alice's page reads her wedgie's key");
await pa.waitForSelector("#x-name");
ok((await pa.locator("#x-add").textContent()).includes(B.id), "the add box shows Bob's key id");
await pa.fill("#x-name", "Bob");
await pa.click("#x-save");
await pa.fill("#x-text", "hi bob, it's alice");
await pa.click("#x-send");
ok(await until(() => pa.locator(".chat-out").count().then((n) => n === 1)), "Alice's message shows on her side");

await pb.goto(SITE + "/secret");
ok(await until(() => pb.locator("#x-me").textContent().then((t) => t.includes(B.id))), "Bob's page reads his key");
const btn = await until(async () => (await pb.locator("#x-chats button[data-pub]").count()) ? pb.locator("#x-chats button[data-pub]").first() : null);
ok(!!btn && (await btn.textContent()).startsWith("New "), "Bob sees a new chat from an unknown key");
await btn.click();
await pb.click(".chat-in button");
ok(await until(() => B.screen[0] === "hi bob, it's alice"), "Bob's wedgie opens it: the text matches");
ok(!(await pb.content()).includes("hi bob"), "the text never shows in Bob's page");

// 2. Bob adds Alice and replies; her wedgie asks once, then the next goes straight there
await pb.click("#x-keep");
await pb.waitForSelector("#x-name");
await pb.fill("#x-name", "Alice");
await pb.click("#x-save");
ok((await pb.locator("#x-who").textContent()) === "Alice", "Bob's chat is now named Alice, same thread");
ok(await pb.locator(".chat-in").count() === 1, "her message is still in it");
await pb.fill("#x-text", "hey alice");
await pb.press("#x-text", "Enter");
ok(await until(() => pa.locator(".chat-in button").count().then((n) => n === 1)), "Alice's page gets Bob's reply, sealed");
await pa.click(".chat-in button");
ok(await until(() => A.screen[0] === "hey alice"), "Alice's wedgie shows it");
await pb.fill("#x-text", "second one");
await pb.click("#x-send");
ok(await until(() => A.screen[1] === "second one"), "Bob's next message goes to her wedgie with no click");
ok(A.asks === 1, `Alice's wedgie asked once (${A.asks})`);
ok(!(await pa.content()).includes("second one") && !(await pa.content()).includes("hey alice"), "none of Bob's text in Alice's page");

// a reload keeps the chats (her key, names, sealed messages, what she sent)
await pa.reload();
ok(await until(() => pa.locator("#x-chats").textContent().then((t) => t.includes("Bob"))), "a reload keeps Alice's chat with Bob");

// 3. the mailbox refuses junk
const post = (b) => fetch(SITE + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.status);
ok(await post({ to: "04" + "1".repeat(10), from: A.pub, blob: "wedgie1.x" }) === 400, "bad key: 400");
ok(await post({ to: B.pub, from: A.pub, blob: "hello" }) === 400, "not sealed: 400");
ok(await post({ to: B.pub, from: A.pub, blob: "wedgie1." + "a".repeat(3000) }) === 400, "too long: 400");
ok((await fetch(SITE + "/api/chat?box=nope")).status === 400, "bad box: 400");

await browser.close();
console.log(fails ? `${fails} FAILED` : "all ok");
process.exit(fails ? 1 : 0);
