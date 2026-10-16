// The printed assembly manual: node tools/asmpdf.mjs  ->  public/assemble.pdf (linked from /assemble).
// Words, steps and drawings come from src/pages/assemble.ts, same as the web page: edit there.
// Print layout: tools/manual/manual.css. The cover and last page: below.
import { createServer } from "vite";
import { ROOT, css, qr as qrSvg, img as jpg, pdf } from "./manual/pdf.mjs";

const URL = "https://wedgie.dev/assemble";
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { STEPS, TROUBLE } = await vite.ssrLoadModule("/src/pages/assemble.ts");
await vite.close();

const img = (f) => jpg("public/img/assemble/" + f);
const qr = await qrSvg(URL);
// links print as plain bold text: "wedgie.dev/test"
const plain = (h) => h.replace(/<a [^>]*>(.*?)<\/a>/g, "<b>$1</b>");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css()}</style></head><body>
<section class="cover">
  <div class="kick">wedgie.dev</div>
  <h1>Put a wedgie together.</h1>
  <p class="lede">No soldering. ${STEPS.length} steps. Take your time on the wires (3 to 9); the rest just clicks.</p>
  <div class="qr">${qr}<div><p>Scan for the latest version, with photos of every step.</p><p class="url">wedgie.dev/assemble</p></div></div>
  <h2>You need</h2>
  <ul>
    <li>Raspberry Pi Pico</li><li>Screen board</li><li>Trust M chip board</li><li>4-wire cable with plug</li>
    <li>Case: lid, base, joystick cap, 4 buttons</li><li>Wire cutters and strippers</li><li>Electrical tape</li>
    <li>A stiff breadboard jumper wire</li><li>Tweezers</li><li>USB-C data cable</li><li>A computer with Chrome</li>
  </ul>
  <div class="art"><img src="${img("d14.webp")}"></div>
</section>
${STEPS.map((s, i) => `<section class="step">
  <div class="draw"><img src="${img(s.d ? `d${s.d}.webp` : `p/${s.ph[0]}.webp`)}"></div>
  <div class="copy">
    <div class="head"><span class="num c${i % 3}">${i + 1}</span><h3>${s.t}</h3></div>
    <p>${plain(s.p)}</p>
    ${s.art ? `<div class="art">${s.art}</div>` : ""}
    ${s.tip ? `<p class="note">${plain(s.tip)}</p>` : ""}
    ${s.warn ? `<p class="note bad">${plain(s.warn)}</p>` : ""}
  </div>
</section>`).join("")}
<section class="trouble">
  <h2>If something's off</h2>
  <dl>${TROUBLE.map(([q, a]) => `<dt>${q}</dt><dd>${a}</dd>`).join("")}</dl>
  <div class="more">${qr}<p>Still stuck? The web version has photos of every step:<br><b>wedgie.dev/assemble</b></p></div>
</section></body></html>`;

await pdf(html, "public/assemble.pdf", "Put a wedgie together · latest version: wedgie.dev/assemble");
