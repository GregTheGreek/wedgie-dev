// /api/admin: the shipping computer's door (wedgie-shipping orders.py on omen), Bearer SHOP_ADMIN_TOKEN.
//   GET                          every paid, unshipped order with its sealed address (only omen can open it)
//   POST {id, tracking}          shipped: the sealed address, payer, transaction and Stripe session are wiped
//   POST {id, cancel: true}      canceled (refund by hand), wiped the same way
// Each GET also deletes what's done with: shipped or canceled orders and unpaid or expired ones, 30 days on.
import { db, env, json, oops, same } from "./_shop.js";

const allowed = (req: Request) => {
  const t = env("SHOP_ADMIN_TOKEN");
  return t.length >= 32 && same(req.headers.get("authorization") || "", "Bearer " + t);
};

export async function GET(req: Request) {
  if (!allowed(req)) return oops("no", 401);
  const sql = await db();
  await sql`delete from orders where (status in ('shipped', 'canceled') and coalesce(shipped_at, paid_at, created) < now() - interval '30 days')
    or (status in ('new', 'expired') and created < now() - interval '30 days')`;
  const orders = await sql`select id, cart, cents, pay, chain, sealed, paid_at, created from orders where status = 'paid' order by paid_at`;
  return json({ orders });
}

export async function POST(req: Request) {
  if (!allowed(req)) return oops("no", 401);
  let b: any;
  try { b = await req.json(); } catch { return oops("Bad request."); }
  if (typeof b?.id !== "string") return oops("Which order?");
  const sql = await db();
  if (b.cancel === true) {
    const r = await sql`update orders set status = 'canceled', shipped_at = now(), sealed = null, payer = null, tx = null, stripe_session = null
      where id = ${b.id} and status in ('new', 'paid') returning id`;
    return r.length ? json({ ok: true }) : oops("No open order with that id.", 404);
  }
  if (typeof b.tracking !== "string" || !/^[A-Z0-9]{10,40}$/i.test(b.tracking.replace(/\s/g, ""))) return oops("That isn't a tracking number.");
  const r = await sql`update orders set status = 'shipped', shipped_at = now(), tracking = ${b.tracking.replace(/\s/g, "")},
    sealed = null, payer = null, tx = null, stripe_session = null where id = ${b.id} and status = 'paid' returning id`;
  return r.length ? json({ ok: true }) : oops("No paid, unshipped order with that id.", 404);
}
