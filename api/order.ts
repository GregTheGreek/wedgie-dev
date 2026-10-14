// /api/order
//   GET                                       what's open: card, usdc; extra = cents over list price right now
//   POST {cart, sealed, pay, chain?}          a new order -> {id, token, url?} (url: Stripe Checkout)
//   POST {id, token, tx?}                     its status; tx = a USDC payment to check (else the chain is searched)
// A quote holds 10 minutes for USDC, 30 for card (catalog.ts QUOTE); then the order is 'expired'.
// The token is the buyer's: only its hash is kept. See _shop.ts for what is and isn't stored.
import { PAY_CHAINS, cartOk, cartLines } from "../src/shop/catalog.js";
import { db, env, json, oops, randomHex, sha256, same, publicView, checkout, session, markPaid, usdcPaid, usdcFind, extraNow, expireOld, late, rpc, type Order } from "./_shop.js";

const open = () => ({ card: !!env("STRIPE_SECRET_KEY"), usdc: !!env("SHOP_PAY_TO"), chains: Object.keys(PAY_CHAINS).map(Number).filter((c) => env("SHOP_RPC_" + c)) });

export async function GET() {
  const extra = env("SHOP_DATABASE_URL") ? await extraNow(await db()).catch(() => 0) : 0;
  return json({ ...open(), extra });
}

export async function POST(req: Request) {
  let b: any;
  try { b = await req.json(); } catch { return oops("Bad request."); }
  if (!env("SHOP_DATABASE_URL")) return oops("The shop isn't open yet.", 503);
  const sql = await db();
  const origin = new URL(req.url).origin;
  return b?.id ? status(sql, b, origin) : create(sql, b, origin);
}

async function create(sql: Awaited<ReturnType<typeof db>>, b: any, origin: string) {
  const o = open();
  if (!cartOk(b?.cart)) return oops("Pick what you'd like.");
  if (typeof b.sealed !== "string" || !/^v1\.[A-Za-z0-9_.-]{40,4000}$/.test(b.sealed)) return oops("The address didn't come through sealed.");
  const cart = { wedgie: b.cart.wedgie, kit: b.cart.kit };
  await expireOld(sql);
  const lines = cartLines(cart, await extraNow(sql));
  const cents = lines.reduce((t, l) => t + l.qty * l.cents, 0);
  const id = randomHex(6), token = randomHex(16), th = await sha256(token);
  if (b.pay === "card") {
    if (!o.card) return oops("Card checkout isn't open yet.", 503);
    await sql`insert into orders (id, token_hash, cart, lines, cents, pay, sealed) values (${id}, ${th}, ${JSON.stringify(cart)}, ${JSON.stringify(lines)}, ${cents}, 'card', ${b.sealed})`;
    const s = await checkout({ id, cart, lines }, origin);
    await sql`update orders set stripe_session = ${s.id} where id = ${id}`;
    return json({ id, token, url: s.url });
  }
  if (b.pay === "usdc") {
    if (!o.usdc) return oops("USDC checkout isn't open yet.", 503);
    const chain = Number(b.chain);
    if (!open().chains.includes(chain)) return oops("Pick a chain.");
    const head = Number(BigInt(await rpc(chain, "eth_blockNumber", [])));
    // The last 4 digits (under a cent) name the order: unique among open orders on that chain.
    for (let i = 0; i < 8; i++) {
      const usdc = BigInt(cents) * 10_000n + BigInt(1 + Math.floor(Math.random() * 9999));
      try {
        await sql`insert into orders (id, token_hash, cart, lines, cents, pay, sealed, chain, usdc, from_block) values (${id}, ${th}, ${JSON.stringify(cart)}, ${JSON.stringify(lines)}, ${cents}, 'usdc', ${b.sealed}, ${chain}, ${usdc.toString()}, ${head})`;
        return json({ id, token });
      } catch (e: any) { if (!/orders_open_usdc/.test(e?.message || "")) throw e; }
    }
    return oops("Busy: try again.", 503);
  }
  return oops("Pay by card or USDC.");
}

async function status(sql: Awaited<ReturnType<typeof db>>, b: any, origin: string) {
  if (typeof b.id !== "string" || typeof b.token !== "string") return oops("Bad request.");
  const [o] = (await sql`select * from orders where id = ${b.id}`) as Order[];
  if (!o || !same(o.token_hash, await sha256(b.token))) return oops("No such order.", 404);
  let url: string | undefined, why: string | undefined;
  if ((o.status === "new" || o.status === "expired") && o.pay === "card" && o.stripe_session) {
    const s = await session(o.stripe_session);
    if (s.payment_status === "paid") { await markPaid(sql, o.id, s.id); o.status = "paid"; }
    else if (s.status === "open" && o.status === "new") url = s.url || undefined;
    else if (o.status === "new" && (s.status === "expired" || late(o))) { await sql`update orders set status = 'expired' where id = ${o.id} and status = 'new'`; o.status = "expired"; }
  }
  let tx = b.tx;
  if ((o.status === "new" || o.status === "expired") && o.pay === "usdc" && !tx) tx = await usdcFind(o).catch(() => null);
  if ((o.status === "new" || o.status === "expired") && o.pay === "usdc" && tx) {
    if (typeof tx !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(tx)) return oops("That isn't a transaction hash.");
    const r = await usdcPaid(o, tx.toLowerCase());
    if (r.paid) {
      try {
        const done = await sql`update orders set status = 'paid', paid_at = now(), tx = ${tx.toLowerCase()}, payer = ${r.payer}
          where id = ${o.id} and status in ('new', 'expired') returning id`;
        if (done.length) o.status = "paid";
      } catch (e: any) {
        if (/orders_tx/.test(e?.message || "")) why = "That transaction already paid for another order.";
        else throw e;
      }
    } else why = r.why;
  }
  if (o.status === "new" && o.pay === "usdc" && late(o)) { await sql`update orders set status = 'expired' where id = ${o.id} and status = 'new'`; o.status = "expired"; }
  return json({ ...publicView(o), url, why });
}
