// The user manual in every box, "You've got a wedgie": node tools/userpdf.mjs  ->  public/manual.pdf.
// Words: tools/manual/wedgie.html. Layout: tools/manual/wedgie.css.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, css, qr, img, pdf } from "./manual/pdf.mjs";

let body = readFileSync(join(ROOT, "tools/manual/wedgie.html"), "utf8").replace(/<!--[^]*?-->/g, "");
for (const [m, url] of [...body.matchAll(/\{\{qr (\S+)\}\}/g)]) body = body.replace(m, await qr(url));
body = body.replace(/\{\{img (\S+)\}\}/g, (_, p) => `<img src="${img(p)}">`);
await pdf(`<!doctype html><html><head><meta charset="utf-8"><style>${css("wedgie.css")}</style></head><body>${body}</body></html>`,
  "public/manual.pdf", "You've got a wedgie · help: wedgie@buidlguidl.com · wedgie.dev");
