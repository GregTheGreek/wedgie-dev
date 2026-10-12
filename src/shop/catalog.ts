// What the shop sells. Read by the order page and by the server (api/), so a price lives in one place.
// Prices are US dollars in cents, shipping included (US only: Ground Advantage is ~$6, international
// is $16-30, over the $10 we'll eat; wedgie-shipping README).
export const ITEMS = {
  wedgie: { name: "wedgie", what: "Assembled: pico, screen, chip, and case. Plug it in and go.", cents: 6700 },
  kit: { name: "wedgie kit", what: "Every part and the case, with assembly instructions.", cents: 5700 },
} as const;
export type Item = keyof typeof ITEMS;
export type Cart = Record<Item, number>;
export const MAX_EACH = 10;
export const SHIPS = "Ships within a week, US only.";

// Busy days cost more: every TIER boxes sold today (Mountain time, wedgies and kits together) adds STEP to
// each one after, up to TOPS steps. 5 sold, buy 3: 1 at $67, 2 at $82. `sold` comes from api/ (paid orders).
export const TIER = 6, STEP = 1500, TOPS = 4;
export const bump = (n: number) => STEP * Math.min(TOPS, Math.floor(n / TIER));
export type Line = { item: Item; qty: number; cents: number };
export function cartLines(c: Cart, sold: number): Line[] {
  const lines: Line[] = [];
  let n = sold;
  for (const k of Object.keys(ITEMS) as Item[]) for (let i = 0; i < c[k]; i++, n++) {
    const cents = ITEMS[k].cents + bump(n), last = lines[lines.length - 1];
    if (last?.item === k && last.cents === cents) last.qty++; else lines.push({ item: k, qty: 1, cents });
  }
  return lines;
}
export const cartCents = (c: Cart, sold: number) => cartLines(c, sold).reduce((t, l) => t + l.qty * l.cents, 0);
export function cartOk(c: unknown): c is Cart {
  const o = c as Record<string, unknown>;
  if (!o || typeof o !== "object") return false;
  const ns = (Object.keys(ITEMS) as Item[]).map((k) => o[k]);
  return ns.every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= MAX_EACH) && ns.some((n) => (n as number) > 0);
}

// USDC: the same contract kind (6 decimals) on each chain the shop takes.
export const PAY_CHAINS: Record<number, { name: string; usdc: string; rpc: string; scan: string; confirm: number }> = {
  8453: { name: "Base", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", rpc: "https://mainnet.base.org", scan: "https://basescan.org", confirm: 3 },
  1: { name: "Ethereum", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", rpc: "https://ethereum-rpc.publicnode.com", scan: "https://etherscan.io", confirm: 2 },
};

// What the buyer types, sealed in their browser (seal.ts) before it leaves it.
export type ShipTo = { name: string; line1: string; line2: string; city: string; state: string; zip: string; email: string };
export const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP AA AE AP".split(" ");
