// /api/admin: the shipping computer's door (wedgie-shipping orders.py on omen), Bearer SHOP_ADMIN_TOKEN.
//   GET                          every paid, unshipped order with its sealed address (only omen can open it)
//   POST {id, tracking}          shipped: the buyer gets an email with the tracking number; then the sealed address,
//                                their locked email, payer, transaction and Stripe session are wiped
//   POST {id, cancel: true}      canceled (refund by hand), wiped the same way
// Each GET also marks paid the USDC orders whose deposit address now holds their price, and deletes what's done with: shipped or canceled orders and unpaid or expired ones, 30 days on.
import { db, env, json, oops, same, settleDeposit, type Order } from "./_shop.js";
import { unlock, shippedMail, mailPaid } from "./_mail.js";

const allowed = (req: Request) => {
  const t = env("SHOP_ADMIN_TOKEN");
  return t.length >= 32 && same(req.headers.get("authorization") || "", "Bearer " + t);
};

export async function GET(req: Request) {
  if (!allowed(req)) return oops("no", 401);
  const sql = await db();
  await sql`delete from orders where (status in ('shipped', 'canceled') and coalesce(shipped_at, paid_at, created) < now() - interval '30 days')
    or (status in ('new', 'expired') and created < now() - interval '30 days')`;
  // USDC sent to an order's deposit address after its buyer left the page still pays it
  const open = (await sql`select * from orders where pay = 'usdc' and deposit is not null and status in ('new', 'expired')`) as Order[];
  for (const o of open) {
    const r = await settleDeposit(sql, o).catch(() => null);
    if (r?.paid) await mailPaid(sql, o.id, new URL(req.url).origin).catch(() => {});
  }
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
    const r = await sql`update orders set status = 'canceled', shipped_at = now(), sealed = null, email_enc = null, payer = null, tx = null, stripe_session = null
      where id = ${b.id} and status in ('new', 'paid') returning id`;
    return r.length ? json({ ok: true }) : oops("No open order with that id.", 404);
  }
  if (typeof b.tracking !== "string" || !/^[A-Z0-9]{10,40}$/i.test(b.tracking.replace(/\s/g, ""))) return oops("That isn't a tracking number.");
  const tracking = b.tracking.replace(/\s/g, "");
  const [o] = await sql`select email_enc from orders where id = ${b.id} and status = 'paid'`;
  const r = await sql`update orders set status = 'shipped', shipped_at = now(), tracking = ${tracking},
    sealed = null, email_enc = null, payer = null, tx = null, stripe_session = null where id = ${b.id} and status = 'paid' returning id`;
  if (!r.length) return oops("No paid, unshipped order with that id.", 404);
  let mailed = false;
  if (o?.email_enc) try { await shippedMail(await unlock(o.email_enc), b.id, tracking, new URL(req.url).origin); mailed = true; } catch {}
  return json({ ok: true, mailed });
}
