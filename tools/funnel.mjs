// Where checkout loses people: the counts from src/shop/count.ts, totaled, plus orders by pay and status.
// Run: node tools/funnel.mjs [days=30] [site=https://wedgie.dev]   (SHOP_ADMIN_TOKEN from .env)
import { readFileSync } from "node:fs";

const days = Number(process.argv[2]) || 30, site = process.argv[3] || "https://wedgie.dev";
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n").map((l) => l.match(/^(\w+)=(.*)$/)?.slice(1)).filter(Boolean));
const token = process.env.SHOP_ADMIN_TOKEN || env.SHOP_ADMIN_TOKEN;
const res = await fetch(`${site}/api/admin?funnel=1&days=${days}`, { headers: { authorization: "Bearer " + token } });
if (!res.ok) { console.error(res.status, await res.text()); process.exit(1); }
const r = await res.json();
const { STEPS } = await import("../src/shop/count.ts");

const tot = {};
for (const c of r.counts) tot[c.k] = (tot[c.k] || 0) + c.n;
const row = (k) => console.log(String(tot[k] || 0).padStart(6), k);
console.log(`last ${r.days} days\n\nsteps`);
STEPS.forEach(row);
const errs = Object.keys(tot).filter((k) => k.startsWith("err-")).sort((a, b) => tot[b] - tot[a]);
if (errs.length) { console.log("\nerrors"); errs.forEach(row); }
console.log("\norders");
for (const o of r.orders) console.log(String(o.n).padStart(6), o.pay, o.status);
