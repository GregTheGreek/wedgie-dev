// A stand-in for @neondatabase/serverless: the same `neon(url)` tagged template over an in-memory
// Postgres (PGlite), so tools/shopprobe.mjs runs with no database account. vite.config.ts swaps it in
// when SHOP_DATABASE_URL_DEV=pglite. int8 comes back as a string, like Neon's.
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const fix = (v) => (typeof v === "bigint" ? v.toString() : v);
export const neon = () => async (strings, ...vals) =>
  (await db.sql(strings, ...vals)).rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, fix(v)])));
