// /api/login: find your orders on any device by email.
//   POST {email}          a 6-digit code goes to that email, if it has orders. The answer is the same either way.
//   POST {email, code}    -> {orders: [{id, token, at}]}: the tokens (_mail.ts tokenOf) open each order's page.
// A code works 10 minutes, 5 tries. One send a minute, 5 an hour, per email. Only hashes are stored.
import { db, json, oops, hmac, same, env, sha256 } from "./_shop.js";
import { EMAIL, emailHash, tokenOf, codeMail } from "./_mail.js";

export async function POST(req: Request) {
  let b: any;
  try { b = await req.json(); } catch { return oops("Bad request."); }
  if (!env("SHOP_DATABASE_URL") || !env("SHOP_MAIL_KEY")) return oops("Email login isn't open yet.", 503);
  if (typeof b?.email !== "string" || b.email.length > 100 || !EMAIL.test(b.email.trim())) return oops("That isn't an email.");
  const sql = await db();
  const h = await emailHash(b.email);
  const codeHash = (code: string) => hmac(env("SHOP_MAIL_KEY"), `code:${h}:${code}`);
  const [row] = await sql`select *, sent_at > now() - interval '1 minute' as recent, hour_start > now() - interval '1 hour' as this_hour,
    expires > now() as live from logins where email_hash = ${h}`;

  if (b.code == null) {
    if (row?.recent) return oops("A code was just sent. Wait a minute.", 429);
    if (row?.this_hour && row.sends >= 5) return oops("Too many codes. Try again in an hour.", 429);
    const [has] = await sql`select 1 from orders where email_hash = ${h} limit 1`;
    if (has) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
      const ch = await codeHash(code);
      await sql`insert into logins (email_hash, code_hash, expires, sent_at, hour_start) values (${h}, ${ch}, now() + interval '10 minutes', now(), now())
        on conflict (email_hash) do update set code_hash = ${ch}, expires = now() + interval '10 minutes', tries = 0, sent_at = now(),
        hour_start = case when logins.hour_start > now() - interval '1 hour' then logins.hour_start else now() end,
        sends = case when logins.hour_start > now() - interval '1 hour' then logins.sends + 1 else 1 end`;
      try { await codeMail(b.email.trim(), code); } catch { return oops("Couldn't send the email. Try again soon.", 503); }
    }
    return json({ ok: true });
  }

  const code = String(b.code).replace(/\D/g, "");
  if (!row || !row.live || row.tries >= 5) return oops("That code ran out. Send a new one.");
  await sql`update logins set tries = tries + 1 where email_hash = ${h}`;
  if (!same(row.code_hash, await codeHash(code))) return oops("Wrong code.");
  await sql`update logins set expires = now() where email_hash = ${h}`;
  const rows = await sql`select id, token_hash, created from orders where email_hash = ${h} order by created desc`;
  const orders = [];
  for (const o of rows) {
    const token = await tokenOf(o.id);
    if (same(o.token_hash, await sha256(token))) orders.push({ id: o.id, token, at: new Date(o.created).getTime() });
  }
  return json({ orders });
}
