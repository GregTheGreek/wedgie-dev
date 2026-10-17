// /api/count
//   POST <key>   one more for today (src/shop/count.ts). The body is the key, nothing else; anything off the list is dropped.
// Keeps a number per day per key: no IP, no cookie, no id. Always 204, even when the database is down.
import { KEYS } from "../src/shop/count.js";
import { db, env } from "./_shop.js";

export async function POST(req: Request) {
  try {
    const k = (await req.text()).slice(0, 40);
    if (KEYS.has(k) && env("SHOP_DATABASE_URL")) {
      const sql = await db();
      await sql`insert into counts (day, k, n) values (current_date, ${k}, 1) on conflict (day, k) do update set n = counts.n + 1`;
    }
  } catch {}
  return new Response(null, { status: 204 });
}
