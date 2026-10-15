// The printed assembly manual: node tools/asmpdf.mjs  ->  public/assemble.pdf (linked from /assemble).
// Words, steps and drawings come from src/pages/assemble.ts, same as the web page: edit there.
// Print layout: tools/manual/manual.css. The cover and last page: below.
import { chromium } from "playwright-core";
import { createServer } from "vite";
import QRCode from "qrcode";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, ".."), URL = "https://wedgie.dev/assemble";
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { STEPS, TROUBLE } = await vite.ssrLoadModule("/src/pages/assemble.ts");
await vite.close();

// Chromium keeps a JPEG as is but stores a webp uncompressed, so print from JPEG copies (python3 + Pillow).
const dir = mkdtempSync(join(tmpdir(), "asmpdf-"));
const img = (f) => {
  const out = join(dir, f.replace(/\W/g, "_") + ".jpg");
  execFileSync("python3", ["-c", "import sys;from PIL import Image;Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2],quality=85)", join(ROOT, "public/img/assemble", f), out]);
  return "file://" + out;
};
const font = (f) => "file://" + join(ROOT, "node_modules", f);
const css = readFileSync(join(ROOT, "tools/manual/manual.css"), "utf8")
  .replace("NUNITO", font("@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2"))
  .replace("DMMONO", font("@fontsource/dm-mono/files/dm-mono-latin-500-normal.woff2"));
const qr = await QRCode.toString(URL, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1a1b1a", light: "#0000" } });
// links print as plain bold text: "wedgie.dev/test"
const plain = (h) => h.replace(/<a [^>]*>(.*?)<\/a>/g, "<b>$1</b>");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
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

const page = join(dir, "manual.html");
writeFileSync(page, html);
const cache = homedir() + "/Library/Caches/ms-playwright";
const shell = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse()[0];
const b = await chromium.launch({ executablePath: `${cache}/${shell}/${process.platform === "linux" ? "chrome-headless-shell-linux64" : "chrome-headless-shell-mac-arm64"}/chrome-headless-shell`, args: ["--allow-file-access-from-files"] });
const p = await b.newPage();
await p.goto("file://" + page, { waitUntil: "networkidle" });
await p.evaluate(() => document.fonts.ready);
const out = join(ROOT, "public/assemble.pdf");
await p.pdf({ path: out, format: "Letter", printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="width:100%;font:9px Helvetica, Arial, sans-serif;color:#888;padding:0 0.6in;display:flex;justify-content:space-between">
    <span>Put a wedgie together · latest version: wedgie.dev/assemble</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>` });
await b.close();
console.log(out, (readFileSync(out).length / 1e6).toFixed(1) + " MB");
