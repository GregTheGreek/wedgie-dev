// The shop's stock count (api/_shop.ts stockLeft) on an in-memory Postgres, calling api/ directly: no chain,
// no browser, under a second. shopprobe.mjs covers the pages; this covers the bookkeeping:
//   1. an expired USDC quote that money reached keeps holding its box (held)
//   2. admin's 30-day cleanup of shipped orders doesn't hand their boxes out again
// Not here: two orders racing for the last box (order.ts raced, renew). PGlite runs one query at a time and these
// requests never interleave, so a race test passes on racy code too.
// Run: node tools/stocktest.mjs
import { registerHooks } from "node:module";

const lite = new URL("./neonlite.mjs", import.meta.url).href;
registerHooks({ resolve: (s, c, next) => {
  if (s === "@neondatabase/serverless") return { url: lite, shortCircuit: true };
  try { return next(s, c); } catch (e) { if (s.endsWith(".js")) return next(s.slice(0, -3) + ".ts", c); throw e; }
} });
Object.assign(process.env, { SHOP_DATABASE_URL: "pglite", SHOP_PAY_TO: "0x" + "11".repeat(20), SHOP_RPC_8453: "http://127.0.0.1:9",
  SHOP_ADMIN_TOKEN: "t".repeat(40), SHOP_MAIL_KEY: "", STRIPE_SECRET_KEY: "" });
const shop = await import("../api/_shop.ts"), order = await import("../api/order.ts"), admin = await import("../api/admin.ts");
const sql = await shop.db();
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } console.log("ok:", m); };
let ip = 0;
const post = (h, body, auth) => h.POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body),
  headers: { "content-type": "application/json", "x-real-ip": "10.0.0." + ++ip, ...(auth ? { authorization: "Bearer " + "t".repeat(40) } : {}) } }));
const stock = (n) => post(admin, { stock: n }, true);
const buy = async () => (await (await post(order, { cart: { wedgie: 1, kit: 0 }, sealed: "v1." + "a".repeat(60), email: "a@b.co", pay: "usdc", chain: 8453 })).json());
const expire = (id) => sql`update orders set status = 'expired', created = now() - interval '20 minutes' where id = ${id}`;
const left = () => shop.stockLeft(sql);

// 1
await stock(1);
const c = await buy();
await expire(c.id);
ok(await left() === 1, "an expired quote with nothing sent gives its box back");
await sql`update orders set held = true where id = ${c.id}`;   // settleDeposit sets it once money lands
ok(await left() === 0, "an expired quote that money reached keeps its box");
await sql`update orders set status = 'canceled' where id = ${c.id}`;

// 2
await stock(1);
const d = await buy();
await sql`update orders set status = 'shipped', paid_at = now(), shipped_at = now() - interval '40 days' where id = ${d.id}`;
ok(await left() === 0, "shipped: its box is gone");
const g = await admin.GET(new Request("http://x/api/admin", { headers: { authorization: "Bearer " + "t".repeat(40) } }));
ok(g.status === 200 && (await sql`select 1 from orders where id = ${d.id}`).length === 0, "the 30-day cleanup deleted it");
ok(await left() === 0, `and the stock still counts it (left ${await left()})`);
console.log("stocktest: all passed");
process.exit(0);
