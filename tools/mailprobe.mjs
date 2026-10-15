// Shop email end to end, no real mail and no database account: the real api/*.ts under vite's SSR loader, an
// in-memory Postgres (tools/neonlite.mjs), a fake chain head, and SHOP_MAIL_FILE catching each mail.
//   1. an order needs an email; the database never holds it in clear
//   2. paid: one "paid" mail, with the order's link
//   3. login: a code mail; wrong code refused; right code gives back the order's token; a 2nd send waits a minute
//   4. an email with no orders: same answer, no mail
//   5. shipped: a mail with the tracking number; the locked email is wiped
// Run: node tools/mailprobe.mjs
import { createServer } from "vite";
import { createServer as http } from "node:http";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } console.log("ok:", m); };
const chain = http((q, s) => { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => s.end(JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(b).id, result: "0x10" }))); }).listen(8598);
const MAILS = mkdtempSync(tmpdir() + "/mailprobe-") + "/mail.jsonl";
Object.assign(process.env, { SHOP_DATABASE_URL: "pglite", SHOP_MAIL_KEY: "probe-key-" + Math.random(), SHOP_MAIL_FILE: MAILS,
  SHOP_PAY_TO: "0x" + "ab".repeat(20), SHOP_RPC_8453: "http://127.0.0.1:8598", SHOP_ADMIN_TOKEN: "t".repeat(40), STRIPE_SECRET_KEY: "" });
const vs = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent",
  resolve: { alias: { "@neondatabase/serverless": new URL("./neonlite.mjs", import.meta.url).pathname } } });
const order = await vs.ssrLoadModule("/api/order.ts"), login = await vs.ssrLoadModule("/api/login.ts"), admin = await vs.ssrLoadModule("/api/admin.ts");
const { db } = await vs.ssrLoadModule("/api/_shop.ts");
const call = async (fn, body, headers = {}) => { const r = await fn(new Request("https://wedgie.dev/api/x", { method: "POST", headers, body: JSON.stringify(body) })); return { status: r.status, ...(await r.json()) }; };
const mails = () => (existsSync(MAILS) ? readFileSync(MAILS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

// 1
const base = { cart: { wedgie: 1, kit: 0 }, sealed: "v1." + "x".repeat(60), pay: "usdc", chain: 8453 };
ok((await call(order.POST, base)).status === 400, "no email: refused");
const EMAIL = "Buyer@Example.com";
const o = await call(order.POST, { ...base, email: EMAIL });
ok(o.id && /^[0-9a-f]{32}$/.test(o.token), "an order with an email");
const sql = await db();
const [row] = await sql`select * from orders where id = ${o.id}`;
ok(!JSON.stringify(row).toLowerCase().includes("buyer@example.com") && row.email_hash && row.email_enc, "the database holds only a hash and a locked copy");

// 2
await sql`update orders set status = 'paid', paid_at = now() where id = ${o.id}`;
await call(order.POST, { id: o.id, token: o.token });
await call(order.POST, { id: o.id, token: o.token });
const paid = mails().filter((m) => /paid/.test(m.subject));
ok(paid.length === 1 && paid[0].to === EMAIL && paid[0].text.includes(`/order/${o.id}#${o.token}`), "one paid mail, with the order's link");

// 3
ok((await call(login.POST, { email: "buyer@example.com " })).ok, "login: asks for a code (any case, spaces)");
const codeMail = mails().find((m) => /code/.test(m.subject));
const code = codeMail?.subject.match(/\d{6}/)?.[0];
ok(code && codeMail.to === "buyer@example.com", "a code mail");
ok((await call(login.POST, { email: EMAIL, code: code === "000000" ? "111111" : "000000" })).error === "Wrong code.", "a wrong code is refused");
const got = await call(login.POST, { email: EMAIL, code });
ok(got.orders?.length === 1 && got.orders[0].id === o.id && got.orders[0].token === o.token, "the right code gives back the order and its token");
ok((await call(login.POST, { email: EMAIL, code })).status === 400, "a used code doesn't work again");
ok((await call(login.POST, { email: EMAIL })).status === 429, "a second send within a minute waits");

// 4
const before = mails().length;
ok((await call(login.POST, { email: "nobody@example.com" })).ok && mails().length === before, "no orders: the same answer, no mail");

// 5
const auth = { authorization: "Bearer " + "t".repeat(40) };
const shipped = await call(admin.POST, { id: o.id, tracking: "9400100000000000000001" }, auth);
const sm = mails().find((m) => /shipped/.test(m.subject));
ok(shipped.mailed && sm?.to === EMAIL && sm.text.includes("9400100000000000000001"), "shipped mail with the tracking number");
const [after] = await sql`select email_enc, email_hash from orders where id = ${o.id}`;
ok(!after.email_enc && after.email_hash, "shipped: the locked email is wiped (the hash stays for login)");

console.log("mailprobe: all passed");
await vs.close(); chain.close();
process.exit(0);
