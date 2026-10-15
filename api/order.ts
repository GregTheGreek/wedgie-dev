// /api/order
//   GET                                       what's open: card, usdc; extra = cents over list price right now
//   POST {cart, sealed, email, pay, chain?}   a new order -> {id, token, url?} (url: Stripe Checkout); email: _mail.ts
//   POST {id, token, tx?, renew?}             its status; tx = a USDC payment to check (else the chain is searched);
//                                             renew: an expired order quoted again at today's price
// A quote holds 10 minutes (catalog.ts QUOTE); then the order is 'expired'.
// The token is the buyer's: only its hash is kept. See _shop.ts for what is and isn't stored.
import { PAY_CHAINS, cartOk, cartLines } from "../src/shop/catalog.js";
import { EMAIL, emailHash, lock, tokenOf, mailPaid } from "./_mail.js";
import { db, env, json, oops, randomHex, sha256, same, publicView, checkout, session, markPaid, endCard, usdcPaid, usdcFind, extraNow, expireOld, late, rpc, ipOf, tooMany, type Order } from "./_shop.js";

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
  const ip = await ipOf(req);
  return b?.id ? status(sql, b, origin, ip) : create(sql, b, origin, ip);
}

async function create(sql: Awaited<ReturnType<typeof db>>, b: any, origin: string, ip: string) {
  const o = open();
  if (!cartOk(b?.cart)) return oops("Pick what you'd like.");
  if (typeof b.sealed !== "string" || !/^v1\.[A-Za-z0-9_.-]{40,4000}$/.test(b.sealed)) return oops("The address didn't come through sealed.");
  if (typeof b.email !== "string" || b.email.length > 100 || !EMAIL.test(b.email.trim())) return oops("Fill in your email.");
  const cart = { wedgie: b.cart.wedgie, kit: b.cart.kit };
  await expireOld(sql);
  const many = await tooMany(sql, ip);
  if (many) return oops(many, 429);
  const lines = cartLines(cart, await extraNow(sql));
  const cents = lines.reduce((t, l) => t + l.qty * l.cents, 0);
  const id = randomHex(6), token = await tokenOf(id), th = await sha256(token);
  const keyed = !!env("SHOP_MAIL_KEY");     // no key (dev): the order still works, it just can't be mailed or found by email
  const eh = keyed ? await emailHash(b.email) : null, ee = keyed ? await lock(b.email.trim()) : null;
  if (b.pay === "card") {
    if (!o.card) return oops("Card checkout isn't open yet.", 503);
    await sql`insert into orders (id, token_hash, cart, lines, cents, pay, sealed, ip, email_hash, email_enc) values (${id}, ${th}, ${JSON.stringify(cart)}, ${JSON.stringify(lines)}, ${cents}, 'card', ${b.sealed}, ${ip}, ${eh}, ${ee})`;
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
        await sql`insert into orders (id, token_hash, cart, lines, cents, pay, sealed, chain, usdc, from_block, ip, email_hash, email_enc) values (${id}, ${th}, ${JSON.stringify(cart)}, ${JSON.stringify(lines)}, ${cents}, 'usdc', ${b.sealed}, ${chain}, ${usdc.toString()}, ${head}, ${ip}, ${eh}, ${ee})`;
        return json({ id, token });
      } catch (e: any) { if (!/orders_open_usdc/.test(e?.message || "")) throw e; }
    }
    return oops("Busy: try again.", 503);
  }
  return oops("Pay by card or USDC.");
}

async function status(sql: Awaited<ReturnType<typeof db>>, b: any, origin: string, ip: string) {
  if (typeof b.id !== "string" || typeof b.token !== "string") return oops("Bad request.");
  const [o] = (await sql`select * from orders where id = ${b.id}`) as Order[];
  if (!o || !same(o.token_hash, await sha256(b.token))) return oops("No such order.", 404);
  let url: string | undefined, why: string | undefined;
  if ((o.status === "new" || o.status === "expired") && o.pay === "card" && o.stripe_session) {
    const s = await session(o.stripe_session);
    if (s.payment_status === "paid") { await markPaid(sql, o.id, s.id); o.status = "paid"; }
    else if (s.status === "open" && o.status === "new" && !late(o)) url = s.url || undefined;
    else if (o.status === "new") o.status = await endCard(sql, o);
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
  if (b.renew === true && o.status === "expired") {
    const r = await renew(sql, o, origin, ip);
    if (typeof r === "string") return oops(r, 429);
    Object.assign(o, r.o); url = r.url; why = undefined;
  }
  if (o.status === "paid") await mailPaid(sql, o.id, origin);
  return json({ ...publicView(o), url, why });
}

/** An expired order quoted again: today's price, a fresh 10 minutes, the same cart and sealed address. */
async function renew(sql: Awaited<ReturnType<typeof db>>, o: Order, origin: string, ip: string): Promise<string | { o: Order; url?: string }> {
  if (!o.sealed) return "That order can't be renewed: start over.";
  if (o.pay === "card" && (await endCard(sql, o)) === "paid") return { o: { ...o, status: "paid" } };   // its old checkout: paid after all, or ended
  await expireOld(sql);
  const many = await tooMany(sql, ip);
  if (many) return many;
  const lines = cartLines(o.cart, await extraNow(sql));
  const cents = lines.reduce((t, l) => t + l.qty * l.cents, 0);
  if (o.pay === "card") {
    if (!open().card) return "Card checkout isn't open right now.";
    const s = await checkout({ id: o.id, cart: o.cart, lines }, origin);
    const [n] = await sql`update orders set status = 'new', created = now(), lines = ${JSON.stringify(lines)}, cents = ${cents}, stripe_session = ${s.id}, ip = ${ip}
      where id = ${o.id} and status = 'expired' returning *`;
    return n ? { o: n as Order, url: s.url } : "Try again.";
  }
  if (!open().chains.includes(o.chain!)) return "USDC on that chain isn't open right now.";
  const head = Number(BigInt(await rpc(o.chain!, "eth_blockNumber", [])));
  for (let i = 0; i < 8; i++) {
    const usdc = BigInt(cents) * 10_000n + BigInt(1 + Math.floor(Math.random() * 9999));
    try {
      const [n] = await sql`update orders set status = 'new', created = now(), lines = ${JSON.stringify(lines)}, cents = ${cents}, usdc = ${usdc.toString()}, from_block = ${head}, ip = ${ip}
        where id = ${o.id} and status = 'expired' returning *`;
      return n ? { o: n as Order } : "Try again.";
    } catch (e: any) { if (!/orders_open_usdc/.test(e?.message || "")) throw e; }
  }
  return "Busy: try again.";
}
