// The shop's server side (Vercel functions; files starting with _ aren't routes). What it holds:
// an order's cart, how it was paid, and its address SEALED in the buyer's browser (src/shop/seal.ts) to
// a key only the shipping computer has. This code can't read an address and never tries. Once a box
// ships, the sealed address, the payer and the payment links are wiped; the rest goes 30 days later.
// Never log a request body here: even sealed, it doesn't belong in Vercel's logs.
// Env: SHOP_DATABASE_URL, STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET (card), SHOP_PAY_TO (USDC),
// SHOP_ADMIN_TOKEN (omen's orders.py), SHOP_RPC_<chainId> (optional, else a public RPC).
import { neon } from "@neondatabase/serverless";
import { ITEMS, PAY_CHAINS, cartLines, type Cart, type Line } from "../src/shop/catalog.js";

declare const process: { env: Record<string, string | undefined> };
export const env = (k: string) => process.env[k] || "";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
export const oops = (msg: string, status = 400) => json({ error: msg }, status);

// ---- the database ----
let ready: Promise<unknown> | null = null;
export async function db() {
  const sql = neon(env("SHOP_DATABASE_URL"));
  ready ||= (async () => {
    await sql`create table if not exists orders (
      id text primary key,
      token_hash text not null,
      cart jsonb not null,
      cents int not null,
      pay text not null,              -- card | usdc
      status text not null default 'new',   -- new | paid | shipped | canceled
      sealed text,                    -- the address, sealed to omen's key; null once shipped
      chain int, usdc bigint,         -- usdc: the exact amount asked for (its last digits name this order)
      stripe_session text,
      tx text, payer text,
      tracking text,
      created timestamptz not null default now(), paid_at timestamptz, shipped_at timestamptz)`;
    await sql`create unique index if not exists orders_open_usdc on orders (chain, usdc) where status = 'new' and usdc is not null`;
    await sql`create unique index if not exists orders_tx on orders (chain, tx) where tx is not null`;
    await sql`alter table orders add column if not exists lines jsonb`;   // the prices it was made at
  })().catch((e) => { ready = null; throw e; });
  await ready;
  return sql;
}

// ---- small crypto (Web Crypto: no Node types needed) ----
const enc = new TextEncoder();
const hexOf = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
export const randomHex = (n: number) => hexOf(crypto.getRandomValues(new Uint8Array(n)));
export const sha256 = async (s: string) => hexOf(await crypto.subtle.digest("SHA-256", enc.encode(s)));
export async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hexOf(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
export function same(a: string, b: string) {   // constant time
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export type Order = {
  id: string; token_hash: string; cart: Cart; lines: Line[] | null; cents: number; pay: "card" | "usdc"; status: string; sealed: string | null;
  chain: number | null; usdc: string | null; stripe_session: string | null; tx: string | null; payer: string | null;
  tracking: string | null; created: string; paid_at: string | null; shipped_at: string | null;
};

/** What the buyer's own order page may see: never the sealed address, the payer or the session. */
export const publicView = (o: Order) => ({
  id: o.id, cart: o.cart, lines: o.lines, cents: o.cents, pay: o.pay, status: o.status, chain: o.chain, usdc: o.usdc,
  payTo: o.pay === "usdc" && o.status === "new" ? env("SHOP_PAY_TO") : undefined,
  tracking: o.tracking, created: o.created, paid_at: o.paid_at, shipped_at: o.shipped_at,
});

/** Boxes in orders paid since 8 AM Mountain (the shop's day): what today's price is set by (catalog.ts cartLines). */
export async function soldToday(sql: Awaited<ReturnType<typeof db>>) {
  const [r] = await sql`select coalesce(sum((cart->>'wedgie')::int + (cart->>'kit')::int), 0)::int as n from orders
    where status in ('paid', 'shipped') and (paid_at at time zone 'America/Denver' - interval '8 hours')::date = (now() at time zone 'America/Denver' - interval '8 hours')::date`;
  return r.n as number;
}

// ---- Stripe (its REST API; payment only: it is never sent an address) ----
async function stripe(path: string, form?: Record<string, string>) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: form ? "POST" : "GET",
    headers: { Authorization: "Bearer " + env("STRIPE_SECRET_KEY"), ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const r = await res.json();
  if (!res.ok) throw new Error("Stripe: " + (r?.error?.message || res.status));
  return r;
}

export async function checkout(o: Pick<Order, "id" | "cart" | "lines">, origin: string) {
  const f: Record<string, string> = {
    mode: "payment",
    client_reference_id: o.id,
    "metadata[order]": o.id,
    "payment_intent_data[metadata][order]": o.id,
    billing_address_collection: "auto",     // never "required", and no shipping_address_collection
    success_url: `${origin}/order/${o.id}`,
    cancel_url: `${origin}/order/${o.id}`,
  };
  (o.lines || cartLines(o.cart, 0)).forEach((l, i) => {     // the prices the order was made at, even on a later day
    f[`line_items[${i}][quantity]`] = String(l.qty);
    f[`line_items[${i}][price_data][currency]`] = "usd";
    f[`line_items[${i}][price_data][unit_amount]`] = String(l.cents);
    f[`line_items[${i}][price_data][product_data][name]`] = ITEMS[l.item].name;
  });
  return stripe("checkout/sessions", f) as Promise<{ id: string; url: string }>;
}
export const session = (id: string) => stripe("checkout/sessions/" + id) as Promise<{ id: string; url: string | null; status: string; payment_status: string; metadata: Record<string, string> }>;

export async function markPaid(sql: Awaited<ReturnType<typeof db>>, id: string, sessionId: string) {
  await sql`update orders set status = 'paid', paid_at = now() where id = ${id} and status = 'new' and stripe_session = ${sessionId}`;
}

// ---- USDC: read the chain ----
let rpcId = 0;
export async function rpc(chain: number, method: string, params: unknown[]) {
  const res = await fetch(env("SHOP_RPC_" + chain) || PAY_CHAINS[chain].rpc, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const r = await res.json();
  if (r.error) throw new Error(r.error.message);
  return r.result;
}
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topicOf = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

/** Did this transaction pay this order? The amount's last digits are unique among open orders on the
 * chain, and the transaction must come after the order was made, so a hash can't pay someone else's. */
export async function usdcPaid(o: Order, tx: string): Promise<{ paid: true; payer: string } | { paid: false; why: string }> {
  const c = PAY_CHAINS[o.chain!];
  const r = await rpc(o.chain!, "eth_getTransactionReceipt", [tx]);
  if (!r) return { paid: false, why: "Not on chain yet." };
  if (r.status !== "0x1") return { paid: false, why: "That transaction failed on chain." };
  const log = (r.logs as { address: string; topics: string[]; data: string }[]).find((l) =>
    l.address.toLowerCase() === c.usdc.toLowerCase() && l.topics[0] === TRANSFER && l.topics[2] === topicOf(env("SHOP_PAY_TO"))
    && BigInt(l.data) === BigInt(o.usdc!));
  if (!log) return { paid: false, why: `That transaction didn't send exactly ${fmtUsdc(o.usdc!)} USDC to the shop on ${c.name}.` };
  const [block, head] = await Promise.all([rpc(o.chain!, "eth_getBlockByNumber", [r.blockNumber, false]), rpc(o.chain!, "eth_blockNumber", [])]);
  if (Number(BigInt(block.timestamp)) * 1000 < Date.parse(o.created) - 120_000) return { paid: false, why: "That transaction is older than this order." };
  if (BigInt(head) - BigInt(r.blockNumber) + 1n < BigInt(c.confirm)) return { paid: false, why: "Waiting for confirmations." };
  return { paid: true, payer: "0x" + log.topics[1].slice(-40) };
}
export const fmtUsdc = (u: string | bigint) => { const n = BigInt(u); return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, "0")}`; };
