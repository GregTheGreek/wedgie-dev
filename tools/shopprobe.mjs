// /order end to end on a Base fork (anvil), with the shop's real server (api/, under `vite` on the dev
// database branch) and the shipping computer's real orders.py:
//   1. a USDC order through the page's form: what leaves the browser never holds the address in clear
//   2. pay it from window.ethereum (an anvil account holding fork USDC): Paid once confirmed
//   3. a second order can't claim the first one's transaction
//   4. orders.py list opens the address (a test key made here); ship marks it shipped and the site forgets it
//   5. /api/admin refuses without the token
// Needs anvil, uv or python3 with `cryptography`, Node 23+. Run: node tools/shopprobe.mjs [outdir]
import { chromium } from "playwright-core";
import { readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";

const out = process.argv[2];
const ORDERS_PY = process.env.ORDERS_PY || homedir() + "/clawd/wedgie-shipping/orders.py";
const RPC = process.env.BASE_RPC || "https://mainnet.base.org", APORT = 8597, ARPC = `http://127.0.0.1:${APORT}`, VPORT = 5197, SITE = `http://localhost:${VPORT}`;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const kids = [];
process.on("exit", () => kids.forEach((k) => k.kill()));
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } console.log("ok:", m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the shipping computer's key, made here for the test
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url");
const dir = mkdtempSync(tmpdir() + "/shopprobe-");
writeFileSync(dir + "/key.pem", privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
const ADMIN = crypto.randomBytes(24).toString("hex"), PAY_TO = "0x" + crypto.randomBytes(20).toString("hex");

const anvil = spawn("anvil", ["--fork-url", RPC, "--port", String(APORT), "--mnemonic-random", "--hardfork", "osaka", "--silent"], { stdio: "inherit" });
kids.push(anvil);
let id = 0;
const rpcRaw = async (body) => (await fetch(ARPC, { method: "POST", headers: { "content-type": "application/json" }, body })).text();
async function rpc(method, params = []) {
  const r = JSON.parse(await rpcRaw(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params })));
  if (r.error) throw new Error(r.error.message);
  return r.result;
}
for (let i = 0; ; i++) { try { await rpc("eth_chainId"); break; } catch { if (i > 150) throw new Error("anvil didn't start"); await sleep(200); } }
const [me] = await rpc("eth_accounts");
await rpc("anvil_dealERC20", [me, USDC, "0x" + (1000n * 10n ** 6n).toString(16)]);

const vite = spawn("npx", ["vite", "--port", String(VPORT), "--strictPort"], { stdio: ["ignore", "pipe", "inherit"],
  env: { ...process.env, VITE_SEAL_KEY: pub, SHOP_PAY_TO: PAY_TO, SHOP_ADMIN_TOKEN: ADMIN, SHOP_RPC_8453: ARPC, STRIPE_SECRET_KEY: "" } });
kids.push(vite);
for (let i = 0; ; i++) { try { if ((await fetch(SITE + "/api/order")).ok) break; } catch {} if (i > 100) throw new Error("vite didn't start"); await sleep(300); }

const cache = homedir() + "/Library/Caches/ms-playwright";
const shell = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: `${cache}/${shell}/${process.platform === "linux" ? "chrome-headless-shell-linux64" : "chrome-headless-shell-mac-arm64"}/chrome-headless-shell` });
const ctx = await browser.newContext({ viewport: { width: 900, height: 1400 } });
await ctx.exposeBinding("__rpc", (_, method, params) => rpc(method, params).catch((e) => ({ __err: e.message })));
await ctx.addInitScript((me) => {
  window.ethereum = { async request({ method, params }) {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [me];
    if (method === "eth_chainId") return "0x2105";
    if (method === "wallet_switchEthereumChain") return null;
    const r = await window.__rpc(method, params || []);
    if (r && r.__err) throw new Error(r.__err);
    return r;
  } };
}, me);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("page:", e.message));
const sent = [];
page.on("request", (r) => { if (r.url().includes("/api/")) sent.push(r.postData() || ""); });
const shot = (n) => out && page.screenshot({ path: `${out}/shop-${n}.png`, fullPage: true });

const NAME = "Probe Buyer " + crypto.randomBytes(3).toString("hex"), STREET = "1600 Probe Street";
async function newOrder(kits = 0) {
  await page.goto(SITE + "/order");
  await page.waitForFunction(() => !document.querySelector("#o-usdc").disabled);
  if (kits) await page.locator('[data-item=kit] [data-d="1"]').click();
  await page.fill("[name=name]", NAME); await page.fill("[name=line1]", STREET); await page.fill("[name=city]", "Testville");
  await page.selectOption("[name=state]", "CO"); await page.fill("[name=zip]", "80202");
  await page.selectOption("#o-chain", "8453");
  await page.locator("#o-usdc").click();
  await page.waitForURL(/\/order\/[0-9a-f]{12}$/);
  await page.getByText("Send exactly").waitFor();
  return page.url().split("/").pop();
}

// 1
const first = await newOrder(1);
await shot("1-unpaid");
const amount = (await page.locator("text=Send exactly").innerText()).match(/([\d.]+) USDC/)[1];
ok(/^124\.\d{6}$/.test(amount) && amount !== "124.000000", `asks for 124 USDC plus a tag (${amount})`);
ok(sent.length && sent.every((b) => !b.includes(NAME) && !b.includes(STREET)), "the address never left the browser in clear");

// 2
await page.locator("#o-send").click();
await page.getByText("Payment sent").waitFor();
await rpc("anvil_mine", ["0x3"]);
await page.getByText("Paid, thank you").waitFor({ timeout: 30000 });
await shot("2-paid");
ok(true, "paid on chain, confirmed, shown");

// 3: a second order pastes the first one's transaction
const hashes = [];
for (let n = Number(await rpc("eth_blockNumber")); n > 0 && !hashes.length; n--) {
  const b = await rpc("eth_getBlockByNumber", ["0x" + n.toString(16), true]);
  for (const t of b.transactions) if (t.to?.toLowerCase() === USDC.toLowerCase() && t.from.toLowerCase() === me.toLowerCase()) hashes.push(t.hash);
}
const second = await newOrder();
await page.fill("#o-tx", hashes[0]);
await page.locator("#o-check").click();
await page.locator(".safe-msg .bad").waitFor();
const why = await page.locator(".safe-msg").innerText();
ok(/didn't send exactly|already paid|older/.test(why), `another order can't claim it: "${why}"`);

// 4
const env = { ...process.env, SHOP_URL: SITE, SHOP_ADMIN_TOKEN: ADMIN, SHOP_KEY: dir + "/key.pem" };
const py = (...a) => { try { return execFileSync("uv", ["run", "--quiet", "--with", "cryptography", "python3", ORDERS_PY, ...a], { env, encoding: "utf8" }); }
  catch { return execFileSync("python3", [ORDERS_PY, ...a], { env, encoding: "utf8" }); } };
const list = py("list");
ok(list.includes(first) && list.includes(NAME) && list.includes("Testville, CO 80202") && !list.includes(second), "orders.py list opens the paid order's address");
py("ship", first, "9400100000000000000001");
await page.goto(SITE + "/order/" + first);
await page.getByText("Shipped.").waitFor();
await shot("4-shipped");
ok(await page.getByText("9400100000000000000001").isVisible(), "the buyer sees the tracking number");
ok(!py("list").includes(first), "shipped: gone from the list (sealed address wiped)");
py("cancel", second);

// 5
ok((await fetch(SITE + "/api/admin")).status === 401 && (await fetch(SITE + "/api/admin", { headers: { authorization: "Bearer x" } })).status === 401, "/api/admin needs the token");
console.log("shopprobe: all passed");
await browser.close();
process.exit(0);
