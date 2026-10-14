// wedgie.dev/order: buy wedgies. /order/<id>: one order's status (paid, shipped, tracking).
// The address is sealed in this browser before it's sent (shop/seal.ts): our server, Stripe and the chain
// never see it. Card = Stripe Checkout (payment only). USDC = a transfer on Base (a QR code for any phone
// wallet, or this browser's wallet) for an amount whose last digits (under a cent) name the order; the server
// finds it on chain. A quote holds 10 minutes (USDC) or 30 (card), with a countdown; then it's expired.
// An order's token (its proof you made it) stays in this browser and in the link we show; the server keeps
// only its hash. api/order.ts is the other side.
import { ITEMS, MAX_EACH, SHIPS, STATES, PAY_CHAINS, BUMP, cartLines, cartCents, type Cart, type Item, type ShipTo } from "../shop/catalog";
import qrcode from "qrcode-generator";
import { seal, SEAL_KEY } from "../shop/seal";
import { transferData } from "../safe/eth";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const usd = (cents: number) => "$" + (cents / 100).toFixed(cents % 100 ? 2 : 0);
const clock = (ms: number) => { const t = Math.ceil(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const usdc = (u: string) => { const n = BigInt(u); return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, "0")}`; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msgOf = (e: any) => e?.message || String(e);
const eth = () => (window as any).ethereum;

// This browser's orders: id -> token, and a USDC payment's transaction hash until it's checked.
const MEM = "wedgie-orders";
type Mem = Record<string, { token: string; tx?: string }>;
const mem = (): Mem => { try { return JSON.parse(localStorage.getItem(MEM) || "{}"); } catch { return {}; } };
const remember = (id: string, v: Partial<Mem[string]>) => { const m = mem(); m[id] = { ...m[id], ...v } as Mem[string]; localStorage.setItem(MEM, JSON.stringify(m)); };

async function api(body?: unknown) {
  const res = await fetch("/api/order", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const r = await res.json().catch(() => ({ error: `The shop didn't answer (${res.status}).` }));
  if (!res.ok) throw new Error(r.error || `The shop didn't answer (${res.status}).`);
  return r;
}

export function order(main: HTMLElement) {
  const id = /^\/order\/([0-9a-f]{12})$/.exec(location.pathname.replace(/\/+$/, ""))?.[1];
  main.innerHTML = `
  <section class="test-page safe-page order-page">
    <div class="band small" aria-hidden="true"><i></i><i></i><i></i></div>
    <h1>${id ? "Your order" : "Order"}</h1>
    <div id="o-body" class="order-stack"></div>
    <p class="safe-msg" id="o-msg" hidden></p>
  </section>`;
  const body = main.querySelector<HTMLElement>("#o-body")!;
  const msgEl = main.querySelector<HTMLElement>("#o-msg")!;
  const say = (s: string, bad = false) => { msgEl.hidden = !s; msgEl.innerHTML = bad ? `<b class="bad">${esc(s)}</b>` : esc(s); };
  if (id) status(id, body, say); else form(body, say);
}

// ---- a new order ----
function form(box: HTMLElement, say: (s: string, bad?: boolean) => void) {
  const q = new URLSearchParams(location.search);
  const cart: Cart = { wedgie: 0, kit: 0 };
  if (q.get("item") === "kit") cart.kit = 1; else cart.wedgie = 1;
  const yours = Object.entries(mem());
  box.innerHTML = `
    <div class="safe-box recess" id="o-cart">
      ${(Object.keys(ITEMS) as Item[]).map((k) => `
        <div class="order-line" data-item="${k}">
          <div><b>${esc(ITEMS[k].name)}</b> <span class="fine price"></span><br><span class="fine">${esc(ITEMS[k].what)}</span></div>
          <div class="qty"><button class="btn btn-sm" data-d="-1" aria-label="fewer">−</button><b class="n"></b><button class="btn btn-sm" data-d="1" aria-label="more">+</button></div>
        </div>`).join("")}
      <p class="order-total"><b id="o-total"></b> <span class="fine">shipped. ${esc(SHIPS)}</span></p>
      <p class="fine" id="o-lines" hidden></p>
      <p class="fine">Each sale adds ${usd(BUMP)}. A day with none and it's back to ${usd(ITEMS.wedgie.cents)}.</p>
    </div>
    <div class="safe-box recess" id="o-ship">
      <h2>Ship to</h2>
      <p class="fine">Your address is locked right here in your browser with a key only our shipping computer has.
        Our server, the card processor and the blockchain never see it, and we delete it once the box is in the mail.</p>
      <form class="order-fields" id="o-addr" autocomplete="on">
        <label class="wide">Name <input name="name" autocomplete="shipping name" maxlength="80"></label>
        <label class="wide">Address <input name="line1" autocomplete="shipping address-line1" maxlength="100"></label>
        <label class="wide">Apt, suite <span class="fine">(optional)</span> <input name="line2" autocomplete="shipping address-line2" maxlength="100"></label>
        <label>City <input name="city" autocomplete="shipping address-level2" maxlength="60"></label>
        <label>State <select name="state" autocomplete="shipping address-level1"><option value=""></option>${STATES.map((s) => `<option>${s}</option>`).join("")}</select></label>
        <label>ZIP <input name="zip" autocomplete="shipping postal-code" inputmode="numeric" maxlength="10"></label>
        <label class="wide">Email <span class="fine">(optional: only if something goes wrong with your order; deleted with the address)</span> <input name="email" type="email" autocomplete="email" maxlength="100"></label>
      </form>
    </div>
    <div class="safe-box recess" id="o-pay">
      <h2>Pay</h2>
      <p class="row"><button class="btn" id="o-card" disabled>Pay by card</button></p>
      <p class="row"><button class="btn btn-green" id="o-usdc" disabled>Pay in USDC</button>
        on <select id="o-chain">${Object.entries(PAY_CHAINS).map(([c, x]) => `<option value="${c}"${c === "8453" ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></p>
      <p class="fine" id="o-open">Checking the shop.</p>
    </div>
    ${yours.length ? `<div class="safe-box recess"><h2>Your orders</h2><p>${yours.map(([i]) => `<a href="/order/${esc(i)}">${esc(i)}</a>`).join(" · ")}</p></div>` : ""}`;

  let extra = 0;     // cents over list right now (catalog.ts); the server works it out again at checkout
  const paint = () => {
    box.querySelectorAll<HTMLElement>(".order-line").forEach((l) => {
      const k = l.dataset.item as Item;
      l.querySelector(".n")!.textContent = String(cart[k]);
      l.querySelector(".price")!.textContent = usd(ITEMS[k].cents + extra);
    });
    box.querySelector("#o-total")!.textContent = usd(cartCents(cart, extra));
    const lines = cartLines(cart, extra), el = box.querySelector<HTMLElement>("#o-lines")!;
    el.hidden = lines.length < 2;
    el.textContent = lines.map((x) => `${x.qty} × ${ITEMS[x.item].name} at ${usd(x.cents)}`).join(" + ");
  };
  box.querySelectorAll<HTMLElement>(".order-line").forEach((l) => l.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => {
    const k = l.dataset.item as Item;
    cart[k] = Math.max(0, Math.min(MAX_EACH, cart[k] + Number(b.dataset.d)));
    paint();
  })));
  paint();

  // A real <form> (never submitted) is what makes browsers offer to fill in the saved address.
  box.querySelector<HTMLFormElement>("#o-addr")!.onsubmit = (e) => e.preventDefault();
  const card = box.querySelector<HTMLButtonElement>("#o-card")!, crypto = box.querySelector<HTMLButtonElement>("#o-usdc")!;
  const openEl = box.querySelector<HTMLElement>("#o-open")!;
  let shop: { card: boolean; usdc: boolean } = { card: false, usdc: false };
  api().then((r) => {
    shop = SEAL_KEY ? r : { card: false, usdc: false }; extra = r.extra || 0; paint();
    box.querySelectorAll<HTMLOptionElement>("#o-chain option").forEach((o) => { if (!r.chains?.includes(Number(o.value))) o.remove(); });   // only chains the server can read
  }, () => {}).finally(() => {
    card.disabled = !shop.card; crypto.disabled = !shop.usdc;
    openEl.textContent = shop.card || shop.usdc ? "" : "Checkout opens soon.";
    openEl.hidden = !openEl.textContent;
  });

  const shipTo = (): ShipTo | null => {
    const v = (n: string) => (box.querySelector<HTMLInputElement>(`[name=${n}]`)!.value || "").trim();
    const s: ShipTo = { name: v("name"), line1: v("line1"), line2: v("line2"), city: v("city"), state: v("state"), zip: v("zip"), email: v("email") };
    const bad = !s.name ? "your name" : !s.line1 ? "your street address" : !s.city ? "your city" : !STATES.includes(s.state) ? "your state"
      : !/^\d{5}(-\d{4})?$/.test(s.zip) ? "a 5-digit ZIP" : s.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email) ? "a real email, or none" : "";
    if (bad) { say(`Fill in ${bad}.`, true); return null; }
    if (!cartCents(cart, extra)) { say("Pick at least one.", true); return null; }
    return s;
  };
  const go = async (pay: "card" | "usdc", b: HTMLButtonElement) => {
    const s = shipTo();
    if (!s) return;
    b.disabled = true;
    try {
      say("Locking your address.");
      const sealed = await seal({ ...s, cart });
      say(pay === "card" ? "Opening checkout." : "Making your order.");
      const r = await api({ cart, sealed, pay, chain: Number(box.querySelector<HTMLSelectElement>("#o-chain")!.value) });
      remember(r.id, { token: r.token });
      location.href = r.url || `/order/${r.id}`;
    } catch (e) { say(msgOf(e), true); b.disabled = false; }
  };
  card.onclick = () => go("card", card);
  crypto.onclick = () => go("usdc", crypto);
}

// ---- one order ----
type View = { id: string; cart: Cart; lines: { item: Item; qty: number; cents: number }[] | null; cents: number; pay: string; status: string; chain: number | null; usdc: string | null; payTo?: string;
  tracking: string | null; url?: string; why?: string; left?: number };

function status(id: string, box: HTMLElement, say: (s: string, bad?: boolean) => void) {
  const fromLink = location.hash.slice(1);
  if (/^[0-9a-f]{32}$/.test(fromLink)) remember(id, { token: fromLink });
  const token = mem()[id]?.token;
  if (!token) {
    box.innerHTML = `<div class="safe-box recess"><p>This browser doesn't have this order's key. Open the link you saved when you ordered (it ends in #…).</p></div>`;
    return;
  }
  const link = `${location.origin}/order/${id}#${token}`;
  let v = null as View | null, busy = false, shown = "", ends = 0;     // ends: when the quote runs out, this clock

  const paint = () => {
    if (!v) return;
    const now = JSON.stringify([{ ...v, left: 0 }, busy]);
    if (now === shown) return;     // polling: don't wipe a half-pasted transaction hash
    shown = now;
    const c = v.chain ? PAY_CHAINS[v.chain] : null;
    const items = v.lines ? v.lines.map((l) => `${l.qty} × ${esc(ITEMS[l.item].name)} at ${usd(l.cents)}`).join(", ")
      : (Object.keys(ITEMS) as Item[]).filter((k) => v!.cart[k]).map((k) => `${v!.cart[k]} × ${esc(ITEMS[k].name)}`).join(", ");
    let h = `<div class="safe-box recess"><h2>Order ${esc(v.id)}</h2><p>${items} · <b>${usd(v.cents)}</b> shipped</p>`;
    if (v.status === "new" && v.pay === "card") h += `<p>Not paid yet. This price holds for <b class="o-left"></b>.</p>${v.url ? `<p><a class="btn" href="${esc(v.url)}">Pay by card</a></p>` : ""}`;
    if (v.status === "new" && v.pay === "usdc" && c) {
      // EIP-681: a phone wallet that scans it opens a USDC transfer with the exact amount filled in.
      const q = qrcode(0, "M");
      q.addData(`ethereum:${c.usdc}@${v.chain}/transfer?address=${v.payTo}&uint256=${v.usdc}`);
      q.make();
      h += `<p class="order-pay-now">Send <b>${usd(v.cents)} USDC</b> on ${esc(c.name)} in <b class="o-left"></b></p>
        <div class="order-qr">${q.createSvgTag({ cellSize: 5, margin: 2, scalable: true })}</div>
        <p class="fine">Scan with your phone's wallet. Exact amount: <b>${usdc(v.usdc!)}</b> USDC (the last digits tell us it's you).</p>
        <p><button class="btn btn-green" id="o-send"${busy ? " disabled" : ""}>Pay with this browser's wallet</button></p>
        <p class="fine">Or send it to <code class="safe-addr">${esc(v.payTo || "")}</code>. We see it on its own.
        Stuck? Paste the transaction: <input id="o-tx" placeholder="0x… transaction hash" size="40" spellcheck="false"> <button class="btn btn-sm" id="o-check">Check</button></p>`;
    }
    if (v.status === "expired") h += `<p><b>Time ran out.</b> Nothing was charged.</p><p><a class="btn btn-green" href="/order">Start over</a></p>`;
    if (v.status === "paid") h += `<p class="good"><b>Paid, thank you.</b></p><p>${esc(SHIPS)} The tracking number shows up here when it does.</p>`;
    if (v.status === "shipped") h += `<p class="good"><b>Shipped.</b> Your address is deleted.</p>
      <p>USPS tracking: <a href="https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(v.tracking || "")}" target="_blank" rel="noopener">${esc(v.tracking)}</a></p>`;
    if (v.status === "canceled") h += `<p>Canceled.</p>`;
    h += `</div><div class="safe-box recess"><h2>Keep this link</h2><p class="fine">It's how you check on this order from anywhere. Anyone with it can see the order's status (never your address).</p>
      <p><code class="safe-addr">${esc(link)}</code> <button class="btn btn-sm" id="o-copy">Copy</button></p></div>`;
    box.innerHTML = h;
    tick();
    box.querySelector<HTMLButtonElement>("#o-copy")!.onclick = () => navigator.clipboard.writeText(link).then(() => say("Copied."));
    const send = box.querySelector<HTMLButtonElement>("#o-send");
    if (send) send.onclick = () => payWallet().catch((e) => { busy = false; paint(); say(msgOf(e), true); });
    const check = box.querySelector<HTMLButtonElement>("#o-check");
    if (check) check.onclick = () => {
      const tx = box.querySelector<HTMLInputElement>("#o-tx")!.value.trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return say("That isn't a transaction hash.", true);
      remember(id, { tx });
      refresh(true);
    };
  };

  function tick() {
    const left = Math.max(0, ends - Date.now());
    box.querySelectorAll(".o-left").forEach((e) => (e.textContent = clock(left)));
  }
  setInterval(tick, 1000);

  const refresh = async (loud = false) => {
    try {
      const tx = mem()[id]?.tx;
      v = await api({ id, token, tx });
      if (v!.left != null) ends = Date.now() + v!.left;
      if (v!.status !== "new") remember(id, { tx: undefined });
      if (v!.why && (loud || v!.why !== "Not on chain yet." && v!.why !== "Waiting for confirmations.")) say(v!.why, !/^(Not on chain|Waiting)/.test(v!.why));
      else if (tx && v!.status === "new") say("Payment sent. Waiting for the chain to confirm it.");
      else if (v!.status !== "new") say("");
      paint();
    } catch (e) { say(msgOf(e), true); }
  };

  async function payWallet() {
    if (!eth()) throw new Error("No wallet in this browser. Send it from any wallet and paste the transaction below.");
    const c = PAY_CHAINS[v!.chain!];
    busy = true; paint();
    say("Approve it in your wallet.");
    const [from] = await eth().request({ method: "eth_requestAccounts" });
    const want = "0x" + v!.chain!.toString(16);
    if ((await eth().request({ method: "eth_chainId" })) !== want) await eth().request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
    const tx = await eth().request({ method: "eth_sendTransaction", params: [{ from, to: c.usdc, data: transferData(v!.payTo!, BigInt(v!.usdc!)) }] });
    remember(id, { tx });
    busy = false;
    say("Payment sent. Waiting for the chain to confirm it.");
    await refresh();
  }

  box.innerHTML = `<div class="safe-box recess"><p class="fine">Looking up your order.</p></div>`;
  (async () => {
    await refresh();
    // Keep looking while it isn't paid, until the quote runs out: the server searches the chain each time.
    for (let i = 0; i < 200 && (v as View | null)?.status === "new"; i++) {
      await sleep(5000);
      if (v!.pay === "usdc" || mem()[id]?.tx || i < 24 || Date.now() > ends) await refresh();
    }
  })();
}
