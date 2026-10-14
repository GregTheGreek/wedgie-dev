// Why the price moves: one box, opened by the green * after a price (front page, order page).
import { BUMP, ITEMS } from "./catalog";

const usd = (c: number) => "$" + (c / 100).toFixed(c % 100 ? 2 : 0);
export const WHY = `<div class="why" hidden>
  <p><b>Built by hand.</b> My son and I put every wedgie together, so we can only make so many a day.</p>
  <p><b>Surge pricing.</b> Each sale adds ${usd(BUMP)}. Then it slides back down: a day with no sales and it's ${usd(ITEMS.wedgie.cents)} again.</p>
  <p class="fine">It's a <a href="https://www.paradigm.xyz/2022/08/vrgda" target="_blank" rel="noopener">VRGDA</a> (variable rate gradual Dutch auction),
    the pricing rule onchain projects use to sell at a steady pace: sell faster than we can build and the price climbs, slower and it falls.</p>
</div>`;
/** The green * after a price: opens the box. */
export const STAR = `<button class="star" aria-label="why the price moves">*</button>`;
export function wire(root: HTMLElement) {
  const box = root.querySelector<HTMLElement>(".why");
  root.querySelectorAll<HTMLButtonElement>(".star").forEach((b) => (b.onclick = () => { if (box) box.hidden = !box.hidden; }));
}
