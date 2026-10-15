// The front page: give yourself a wedgie. Get one, or build one; agents at the bottom.
import { place3D, pageShown } from "../ui/place3d";
import { ITEMS, type Item } from "../shop/catalog";
import { WHY, STAR, wire } from "../shop/why";

const CASE = "https://raw.githubusercontent.com/clawdbotatg/clawd-pico-case/main/stl/current/";
const ATOMIC = "https://raw.githubusercontent.com/clawdbotatg/clawd-pico-case/main/stl/atomic-wedgie/";

/** Returns once the hero wedgie is up (the loader waits for it). */
export function home(main: HTMLElement): Promise<unknown> {
  main.innerHTML = `
  <section class="hero">
    <div class="hero-copy">
      <h1>Give<br>yourself<br><span class="nowrap">a wedgie.</span></h1>
      <p class="lede">A pocket computer from three off-the-shelf parts: a Pico, a screen hat, and a secure chip
      <em>wedged</em> in between. Make it a wallet, a game, or whatever you and your agent dream up.</p>
      <div class="row">
        <a class="btn btn-green" href="#build">Build your own</a>
        <a class="btn" href="#get" id="buy-one">Buy one · $67<span class="surge">*</span></a>
      </div>
    </div>
    <div class="hero-art" id="hero-dev"></div>
  </section>

  <div class="band" aria-hidden="true"><i></i><i></i><i></i></div>

  <section id="build" class="sec">
    <div class="sec-head">
      <span class="kicker">Build one</span>
      <h2>Three easy parts.</h2>
      <p>No soldering. Order the parts anywhere, from anyone. To a store it's just a dev board, a screen, and a chip.</p>
    </div>
    <div class="parts">
      <div class="card part"><div class="num">1</div><div class="part-3d" data-part="pico"></div><h3>A Pico</h3><p>The brain: a Raspberry Pi Pico 2 W with headers. Any Pico-shaped board runs the same code; the printed case fits the USB-C RP2040 kind.</p><div class="buy"><a class="btn btn-xs" href="https://www.amazon.com/s?k=raspberry+pi+pico+with+header&i=electronics" target="_blank" rel="noopener">Amazon</a><a class="btn btn-xs" href="https://www.adafruit.com/product/6315" target="_blank" rel="noopener">Adafruit</a><a class="btn btn-xs" href="https://www.microcenter.com/product/692334/raspberry-pi-pico-2w-with-header" target="_blank" rel="noopener">Micro Center</a></div></div>
      <div class="card part"><div class="num">2</div><div class="part-3d" data-part="hat"></div><h3>The screen hat</h3><p>Waveshare Pico-LCD-1.3: a 240×240 screen, a joystick, and four buttons. The Pico plugs straight in.</p><div class="buy"><a class="btn btn-xs" href="https://www.amazon.com/dp/B092VVCBQP" target="_blank" rel="noopener">Amazon</a><a class="btn btn-xs" href="https://www.waveshare.com/pico-lcd-1.3.htm" target="_blank" rel="noopener">Waveshare</a><a class="btn btn-xs" href="https://thepihut.com/products/1-3-ips-lcd-display-module-for-raspberry-pi-pico-240x240" target="_blank" rel="noopener">The Pi Hut</a></div></div>
      <div class="card part"><div class="num">3</div><div class="part-3d" data-part="chip"></div><h3>The chip</h3><p>Adafruit's <a href="https://www.adafruit.com/product/4351" target="_blank" rel="noopener">OPTIGA Trust M breakout</a>, plus a STEMMA QT / Qwiic cable with bare wire ends. The wires push into the header; the chip gets wedged between the boards.</p><div class="buy"><a class="btn btn-xs" href="https://www.mouser.com/ProductDetail/Adafruit/4351?qs=d0WKAl%252BL4KbhnNU%252BCwzWmQ%3D%3D" target="_blank" rel="noopener">Mouser</a><a class="btn btn-xs" href="https://www.jameco.com/z/4351-Adafruit-Industries-Adafruit-Infineon-Trust-M-Breakout-Board-Stemma-QT-Qwiic_2518263.html" target="_blank" rel="noopener">Jameco</a><a class="btn btn-xs" href="https://www.digikey.com/en/products/detail/adafruit-industries-llc/4351/10650641" target="_blank" rel="noopener">DigiKey</a><a class="btn btn-xs" href="https://www.ebay.com/itm/175631680612" target="_blank" rel="noopener">eBay</a></div><p class="fine">(You can also use an <a href="https://www.adafruit.com/product/4314" target="_blank" rel="noopener">ATECC608</a>.)</p></div>
    </div>

    <div class="assembly" id="assembly">
      <div class="assembly-sticky card">
        <div class="assembly-steps">
          <h3>Put it together</h3>
          <ol>
            <li class="step on" data-n="1"><b>Wedge the wires in.</b> <span>The chip's cable plug runs GND, 3.3 V, SDA, SCL from one end; trust that order, not the colors. With the hat's back up and its USB end at the top, push the bare wires into the header beside the Pico's pins: GND right 3rd, 3.3 V right 5th (never the 4th), SDA left 6th, SCL left 7th.</span></li>
            <li class="step" data-n="2"><b>Wedge the chip in between.</b> <span>Tuck the chip into the gap, then plug the Pico into the hat's header: its chips facing you (away from the screen), USB at the joystick end. The chip ends up sandwiched between the two boards.</span></li>
            <li class="step" data-n="3"><b>Snap the case on.</b> <span>Boards into the base, USB first. Caps on, lid down until it clicks.</span></li>
            <li class="step" data-n="4"><b>Plug it in.</b> <span>USB-C, then press <b>Allow wedgie connection</b> at the top and pick it. It boots to the underwear.</span></li>
          </ol>
          <p class="fine" style="margin-top:16px"><a href="/assemble">Detailed assembly guide →</a></p>
        </div>
        <div class="assembly-stage" id="assembly-stage"></div>
      </div>
    </div>

    <div class="card wide case">
      <div class="case-3d part-3d" data-part="case"></div>
      <div>
        <h3>Print the case</h3>
        <p>A snap-together shell with no screws, designed from scratch and MIT licensed. PETG, 0.16 mm layers, 4 walls, no supports. Print the lid face down, the base floor down, and the caps flange down.</p>
        <div class="row">
          <a class="btn btn-sm btn-green" href="${CASE}full-set.stl" download>Full set (.stl)</a>
          <a class="btn btn-sm" href="${CASE}lid.stl" download>Lid</a>
          <a class="btn btn-sm" href="${CASE}base.stl" download>Base</a>
          <a class="btn btn-sm" href="${CASE}joystick.stl" download>Joystick</a>
          <a class="btn btn-sm" href="${CASE}button.stl" download>Button ×4</a>
        </div>
        <p class="fine">Colors: white lid, black base, grey joystick, buttons 2 grey, 1 green, 1 red. <b>Atomic wedgie</b> (Waveshare RP2040-Plus with a battery): print its own red <a href="${ATOMIC}base.stl" download>base</a> and black <a href="${ATOMIC}reset-button.stl" download>RESET button</a> instead of the base.</p>
        <p class="fine">Source, measurements, and every iteration: <a href="https://github.com/clawdbotatg/clawd-pico-case" target="_blank" rel="noopener">clawd-pico-case</a>. Why it's called a wedgie: <a href="/lore.md" target="_blank">the lore</a>.</p>
      </div>
    </div>
  </section>

  <section id="safe" class="sec">
    <div class="card wide signer">
      <div class="signer-copy">
        <span class="kicker">Safe signer</span>
        <h2>Sign for a Safe.</h2>
        <p>A wedgie can sign for a Safe multisig with Safe's own audited contracts. The key never leaves the chip, and nothing signs until you press the green button.</p>
        <div class="row"><a class="btn btn-sm" href="/safe">Use it with a Safe →</a></div>
      </div>
      <div class="deed" aria-hidden="true">
        <svg viewBox="0 0 400 470">
          <defs><pattern id="deed-rule" width="400" height="22" patternUnits="userSpaceOnUse"><path d="M0 21.5h400" stroke="#d9e4ea" stroke-width="1"/></pattern></defs>
          <rect class="deed-paper" x="8" y="8" width="384" height="454" rx="6"/>
          <rect x="24" y="150" width="352" height="296" fill="url(#deed-rule)"/>
          <rect x="20" y="20" width="360" height="430" rx="3" fill="none" stroke="#c9c3ae" stroke-width="1.5"/>
          <g class="deed-owl" transform="translate(200 62)">
            <circle r="34" fill="none" stroke="#168c34" stroke-width="2.5"/><circle r="29" fill="none" stroke="#168c34" stroke-width="1" stroke-dasharray="2 3"/>
            <path d="M-17 -16 L-11 -8 L0 -11 L11 -8 L17 -16 L18 6 Q16 22 0 24 Q-16 22 -18 6 Z" fill="#168c34"/>
            <circle cx="-7.5" cy="0" r="6.5" fill="#fefefe"/><circle cx="7.5" cy="0" r="6.5" fill="#fefefe"/>
            <circle cx="-7" cy="0.5" r="2.8" fill="#1a1b1a"/><circle cx="7" cy="0.5" r="2.8" fill="#1a1b1a"/>
            <path d="M-3 7 L3 7 L0 12 Z" fill="#f2b632"/>
          </g>
          <text class="deed-t" x="200" y="122">Safe Contract</text>
          <text class="deed-s" x="200" y="142">2 of 3 owners must sign</text>
          <text class="deed-l" x="40" y="196">Send 1,000 USDC to vitalik.eth</text>
          <g transform="translate(0 260)"><path d="M40 0h320" class="deed-line"/><text class="deed-o" x="40" y="18">Owner 1</text>
            <path class="deed-ink" pathLength="1" d="M52 -6 C60 -40 72 -40 70 -10 S80 -2 90 -22 C96 -34 100 -14 108 -12 C118 -10 120 -30 132 -26 C142 -22 130 -4 148 -8 C162 -12 170 -28 182 -20 C190 -14 196 -10 230 -18"/></g>
          <g transform="translate(0 340)"><path d="M40 0h320" class="deed-line"/><text class="deed-o" x="40" y="18">Owner 2</text>
            <g class="deed-key" transform="translate(110 -24)"><circle r="13" fill="none" stroke="#b8902a" stroke-width="5"/><path d="M13 0h46v12M49 0v9" fill="none" stroke="#b8902a" stroke-width="5" stroke-linecap="round"/></g>
            <g class="deed-wedgie" transform="translate(150 -24)">
              <rect x="-62" y="-26" width="124" height="52" rx="14" fill="#2a2b2a"/><rect x="-60" y="-26" width="120" height="48" rx="13" fill="#fefefe" stroke="#d6d6d1"/>
              <rect x="-22" y="-20" width="44" height="36" rx="3" fill="#1a1b1a"/><rect x="-19" y="-17" width="38" height="30" fill="#fefefe"/>
              <rect x="-19" y="-17" width="38" height="2.5" fill="#22c452"/><rect x="-19" y="-14.5" width="38" height="2" fill="#a9aaab"/><rect x="-19" y="-12.5" width="38" height="2.5" fill="#e3312c"/>
              <path class="deed-check" pathLength="1" d="M-8 1 L-2 7 L9 -5" fill="none" stroke="#22c452" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
              <circle cx="-41" cy="-2" r="8" fill="#a9aaab"/><circle cx="-41" cy="-2" r="5" fill="#8a8b8c"/>
              <circle cx="35" cy="-10" r="4.2" fill="#a9aaab"/><circle cx="35" cy="6" r="4.2" fill="#a9aaab"/>
              <circle cx="47" cy="-10" r="4.2" fill="#22c452"/><circle cx="47" cy="6" r="4.2" fill="#e3312c"/>
            </g>
            <text class="deed-by" x="228" y="-18">signed on a wedgie</text></g>
          <g transform="translate(0 420)"><path d="M40 0h320" class="deed-line"/><text class="deed-o" x="40" y="18">Owner 3</text></g>
          <g class="deed-stamp" transform="translate(296 402) rotate(-12)"><rect x="-62" y="-22" width="124" height="44" rx="6" fill="none" stroke="#22c452" stroke-width="4"/><text x="0" y="8">EXECUTED</text></g>
        </svg>
      </div>
    </div>
  </section>

  <section id="get" class="sec">
    <div class="sec-head">
      <span class="kicker">Get one</span>
      <h2>We'll give you a wedgie.</h2>
    </div>
    <div class="card order">
      <div class="order-art truck-lane" aria-hidden="true"><img class="truck" src="/img/truck.webp" alt=""></div>
      <div class="order-body">
        <div class="order-price"><i class="sixseven-box"></i><b class="list">$67</b>${STAR} <span>shipped</span></div>
        <p class="surge" hidden></p>
        ${WHY}
        <p id="order-what">One wedgie: pico, screen, chip, and case.</p>
        <div class="seg" role="radiogroup" aria-label="who is it for">
          <button class="on" data-for="me" role="radio" aria-checked="true">For me</button>
          <button data-for="gift" role="radio" aria-checked="false">Give someone a wedgie</button>
          <button data-for="kit" role="radio" aria-checked="false">Kit</button>
        </div>
        <div class="row">
          <a class="btn btn-green" id="order-go" href="/order">Order</a>
        </div>
        <p class="fine">Card or USDC. Ships within a week, US only.</p>
      </div>
    </div>
  </section>

  <section id="library" class="sec">
    <div class="sec-head">
      <span class="kicker">Software</span>
      <h2>A growing app store.</h2>
      <p>Games, tools, a wallet. More every week.</p>
    </div>
    <div class="lib" id="lib">
      <div class="lib-sticky card">
        <div class="lib-stage"><div class="lib-row"></div><div class="lib-plank"></div></div>
        <div class="lib-cap"><h3></h3><p></p></div>
      </div>
    </div>
    <div class="sec-head lib-after">
      <h2>Built by anyone.</h2>
      <p>Open source. Make one, or have your agent make one. <a href="/code">How</a></p>
    </div>
  </section>

  <section id="agents" class="sec agents">
    <a class="btn btn-lg" href="/skill.md" target="_blank"><span class="bot" aria-hidden="true">🤖</span> skill.md</a>
    <a class="btn btn-lg" href="/code">Create software</a>
    <a class="btn btn-lg" href="/safe">Safe</a>
  </section>
`;

  const hero = place3D(main.querySelector<HTMLElement>("#hero-dev")!, { demo: "WEDGIE", boot: true, intro: true, eager: true, side: 1, fallback: { kind: "off" } });

  // $67: the 6-7 hands, for a moment, each time the price comes into view.
  const price = main.querySelector<HTMLElement>(".order-price")!;
  let item: Item = "wedgie", extra = 0;
  const usd = (c: number) => "$" + (c / 100).toFixed(c % 100 ? 2 : 0);
  let hands: { play(): void } | null = null;
  new IntersectionObserver(async (es) => {
    if (!es.some((e) => e.isIntersecting) ) return;
    await pageShown;
    if (!hands) { const { mountSixSeven } = await import("../ui/sixseven"); hands = mountSixSeven(price.querySelector(".sixseven-box")!); }
    hands.play();
  }, { threshold: 0.6 }).observe(price);

  // The truck drives in when its section comes into view, then keeps bouncing along.
  const lane = main.querySelector<HTMLElement>(".truck-lane")!;
  new IntersectionObserver((es, o) => { if (es.some((e) => e.isIntersecting)) { lane.classList.add("go"); o.disconnect(); } }, { threshold: 0.35 }).observe(lane);

  // The price right now: each sale adds a bit, gone in a day without one (shop/catalog.ts).
  const showPrice = () => {
    // Always the list price, then the demand price on top, in green, when there is one (shop/why.ts).
    price.querySelector(".list")!.textContent = usd(ITEMS[item].cents);
    const surge = main.querySelector<HTMLElement>(".surge")!;
    surge.hidden = !extra;
    surge.textContent = `+${usd(extra)} right now`;
  };
  fetch("/api/order").then((r) => r.json()).then((r) => { extra = r.extra || 0; showPrice(); }, () => {});
  wire(price.parentElement!);

  main.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) => (b.onclick = () => {
    main.querySelectorAll<HTMLButtonElement>(".seg button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", String(x === b)); });
    const kit = b.dataset.for === "kit";
    main.querySelector("#order-what")!.innerHTML = kit
      ? `Every part and the case in the mail, with <a href="/assemble">assembly instructions</a>.`
      : "One wedgie: pico, screen, chip, and case.";
    item = kit ? "kit" : "wedgie";
    showPrice();
    main.querySelector<HTMLAnchorElement>("#order-go")!.href = kit ? "/order?item=kit" : "/order";
  }));
  assembly(main.querySelector<HTMLElement>("#assembly")!);
  deed(main.querySelector<HTMLElement>(".deed")!);
  library(main.querySelector<HTMLElement>("#lib")!);
  main.querySelectorAll<HTMLElement>(".part-3d").forEach((el, i) => {
    new IntersectionObserver(async (es, o) => {
      if (!es.some((e) => e.isIntersecting)) return;
      o.disconnect();
      try { await pageShown; const { mountPart3D } = await import("../ui/parts3d"); await mountPart3D(el, el.dataset.part as "pico" | "hat" | "chip" | "case", i * 1.3); }
      catch (err) { console.error("part:", err); }
    }, { rootMargin: "300px" }).observe(el);
  });

  return hero;
}

// Put it together: the steps light up as you scroll, and the wedgie assembles itself beside them.
function assembly(box: HTMLElement) {
  const steps = [...box.querySelectorAll<HTMLElement>(".step")];
  const stage = box.querySelector<HTMLElement>("#assembly-stage")!;
  let a3d: import("../ui/assembly3d").Assembly3D | null = null;
  const progress = () => {
    const r = box.getBoundingClientRect();
    return Math.max(0, Math.min(1, -r.top / Math.max(1, r.height - innerHeight)));
  };
  const update = () => {
    const p = progress();
    const on = Math.min(3, Math.floor(p * 4));
    steps.forEach((s, i) => s.classList.toggle("on", i === on));
    a3d?.setProgress(p);
  };
  addEventListener("scroll", update, { passive: true });
  update();
  new IntersectionObserver(async (es, o) => {
    if (!es.some((e) => e.isIntersecting)) return;
    o.disconnect();
    try {
      await pageShown;
      const { mountAssembly3D } = await import("../ui/assembly3d");
      a3d = await mountAssembly3D(stage);
      update();
    } catch (err) { console.error("assembly:", err); }
  }, { rootMargin: "400px" }).observe(stage);
}

// The Safe contract signs itself as it scrolls by: owner 1's ink, then owner 2's key turns into a wedgie,
// its screen checks, and the 2-of-3 stamp lands. --p (0..1) drives it all in CSS.
function deed(box: HTMLElement) {
  const update = () => {
    const r = box.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (innerHeight * 0.9 - r.top) / Math.max(1, r.height - innerHeight * 0.08)));   // done once it all shows
    box.style.setProperty("--p", p.toFixed(3));
  };
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  update();
}

// The software library: the shelf's carts stand side by side like books, and scrolling flips through them,
// one at a time turned to face you with its name and what it does underneath.
function library(box: HTMLElement) {
  const row = box.querySelector<HTMLElement>(".lib-row")!;
  const cap = box.querySelector<HTMLElement>(".lib-cap")!;
  let items: HTMLElement[] = [];
  let carts: import("../serial/install").Cart[] = [];
  let shown = -1;
  // Measured on load/resize, not per scroll. The viewport height is only re-read when the width changes:
  // a phone's toolbar sliding in and out resizes innerHeight mid-scroll and would jolt the carts.
  let span = 1, w = 0, vw = 0, vh = innerHeight;
  let at = 0, goal = 0, raf = 0;
  const measure = () => {
    if (innerWidth !== vw) { vw = innerWidth; vh = innerHeight; }
    span = Math.max(1, box.offsetHeight - vh);
    w = row.clientWidth;
  };
  const place = () => {
    const spine = Math.min(34, w / 22), gap = Math.min(140, w / 4.2);
    items.forEach((el, i) => {
      const d = i - at, s = Math.max(-1, Math.min(1, d));
      // perspective() first, around the stage's center (every item sits there), so each cart is its own flat
      // 3D layer: no preserve-3d scene for the browser to depth-sort every frame; z-index does the stacking.
      el.style.transform = `perspective(1100px) translate3d(${d * spine + s * gap}px,0,${(1 - Math.abs(s)) * 130}px) rotateY(${-s * 72}deg)`;
      el.style.zIndex = String(100 - Math.round(Math.abs(d) * 10));
    });
    const n = Math.round(at);
    if (n !== shown) {
      shown = n;
      cap.querySelector("h3")!.textContent = carts[n].name;
      cap.querySelector("p")!.textContent = carts[n].about || "";
      cap.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "ease-out" });
    }
  };
  // One write per frame, easing toward the scroll position (a mouse wheel jumps; a finger shouldn't lag).
  const tick = () => {
    raf = 0;
    goal = Math.max(0, Math.min(1, -box.getBoundingClientRect().top / span)) * (items.length - 1);
    at = at < 0 ? goal : at + (goal - at) * 0.4;  // the first frame snaps
    if (Math.abs(goal - at) < 0.002) at = goal;
    place();
    if (at !== goal) raf = requestAnimationFrame(tick);
  };
  const update = () => {
    if (items.length && !raf) raf = requestAnimationFrame(tick);
  };
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", () => { measure(); update(); });
  new IntersectionObserver(async (es, o) => {
    if (!es.some((e) => e.isIntersecting)) return;
    o.disconnect();
    try {
      const [{ cartHtml }, m] = await Promise.all([import("../ui/cart"), fetch("/fw/manifest.json", { cache: "no-cache" }).then((r) => r.json())]);
      carts = m.carts || [];
      if (!carts.length) { box.closest("section")!.hidden = true; return; }
      box.style.setProperty("--n", String(carts.length));
      row.innerHTML = carts.map((c) => `<div class="lib-item"><a class="cart" href="/code" aria-label="${c.name.replace(/"/g, "&quot;")}">${cartHtml(c)}</a></div>`).join("");
      items = [...row.querySelectorAll<HTMLElement>(".lib-item")];
      measure();
      at = -1;
      update();
    } catch (err) { console.error("library:", err); }
  }, { rootMargin: "600px" }).observe(box);
}
