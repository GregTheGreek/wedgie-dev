// Email from wedgie@buidlguidl.com (Gmail SMTP, an app password): login codes, paid, shipped. Plain text only.
// A buyer's email is kept two ways, never in clear: emailHash (a keyed hash, to find their orders at login; goes
// with the order) and lock()ed (to send paid and shipped; wiped when it ships). Order tokens are tokenOf(id), so
// a login can hand them back. All three need SHOP_MAIL_KEY: change it and old orders can't be found by email.
// Env: SHOP_MAIL_USER, SHOP_MAIL_PASS (the app password), SHOP_MAIL_KEY (any long random string).
// Probes: SHOP_MAIL_FILE = append each mail there as a JSON line instead of sending it.
import nodemailer from "nodemailer";
import { appendFileSync } from "node:fs";
import { env, hmac, sha256, randomHex, type db } from "./_shop.js";
import { ITEMS, SHIPS, type Line } from "../src/shop/catalog.js";

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const key = () => env("SHOP_MAIL_KEY");
export const emailHash = (email: string) => hmac(key(), "email:" + email.trim().toLowerCase());
/** An order's token: derived, so a login can give it back. Without SHOP_MAIL_KEY (dev), random. */
export const tokenOf = async (id: string) => (key() ? (await hmac(key(), "order:" + id)).slice(0, 32) : randomHex(16));

// AES-GCM, key = sha256(SHOP_MAIL_KEY). Stored as base64 of iv + ciphertext.
const aes = async () => crypto.subtle.importKey("raw", Uint8Array.from((await sha256(key())).match(/../g)!, (h) => parseInt(h, 16)), "AES-GCM", false, ["encrypt", "decrypt"]);
export async function lock(s: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aes(), new TextEncoder().encode(s)));
  return Buffer.concat([iv, ct]).toString("base64");
}
export async function unlock(b64: string) {
  const b = Buffer.from(b64, "base64");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12) }, await aes(), b.subarray(12)));
}

let smtp: ReturnType<typeof nodemailer.createTransport> | null = null;
export async function send(to: string, subject: string, text: string) {
  if (env("SHOP_MAIL_FILE")) { appendFileSync(env("SHOP_MAIL_FILE"), JSON.stringify({ to, subject, text }) + "\n"); return; }
  if (!env("SHOP_MAIL_USER") || !env("SHOP_MAIL_PASS")) throw new Error("Email isn't set up yet.");
  smtp ||= nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: env("SHOP_MAIL_USER"), pass: env("SHOP_MAIL_PASS") } });
  await smtp.sendMail({ from: `wedgie <${env("SHOP_MAIL_USER")}>`, to, subject, text });
}

const items = (lines: Line[] | null) => (lines || []).map((l) => `${l.qty} × ${ITEMS[l.item].name}`).join(", ");
const usd = (c: number) => "$" + (c / 100).toFixed(c % 100 ? 2 : 0);
const link = async (origin: string, id: string) => `${origin}/order/${id}#${await tokenOf(id)}`;

export const codeMail = (to: string, code: string) =>
  send(to, `Your wedgie code: ${code}`, `${code}\n\nType it on wedgie.dev to see your orders. It works for 10 minutes.\n`);
export const paidMail = async (to: string, o: { id: string; lines: Line[] | null; cents: number }, origin: string) =>
  send(to, `wedgie order ${o.id}: paid`, `Paid, thank you.\n\n${items(o.lines)} · ${usd(o.cents)} shipped\n${SHIPS} We'll email the tracking number.\n\nYour order: ${await link(origin, o.id)}\n`);
export const shippedMail = async (to: string, id: string, tracking: string, origin: string) =>
  send(to, `wedgie order ${id}: shipped`, `Shipped.\n\nUSPS tracking: ${tracking}\nhttps://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}\n\nYour order: ${await link(origin, id)}\n`);

/** "Paid" goes out once per order (paid_mailed), if it has an email. Never throws: a failed send is tried again next time. */
export async function mailPaid(sql: Awaited<ReturnType<typeof db>>, id: string, origin: string) {
  const [o] = await sql`update orders set paid_mailed = now() where id = ${id} and status in ('paid', 'shipped') and paid_mailed is null
    and email_enc is not null returning id, lines, cents, email_enc`;
  if (!o) return;
  try { await paidMail(await unlock(o.email_enc), o as any, origin); }
  catch { await sql`update orders set paid_mailed = null where id = ${id}`.catch(() => {}); }
}
