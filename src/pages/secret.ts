// /secret: messages only a wedgie can read. The wedgie app is clawdbotatg/wedgie-secret; the format is
// src/secret/box.ts.
//   /secret#<key>  a wedgie's share link: write to it, sealed in this browser. No wedgie needed.
//   /secret        your wedgie's key and its link, and paste a sealed message to read it: it opens on the
//                  wedgie's screen after a press there, never on this page.
// The key rides in the # so it never reaches a server.
import * as W from "../serial/wedgies";
import * as Drive from "../serial/drive";
import * as S from "../secret/box";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const msgOf = (e: any) => e?.message || String(e);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function secret(main: HTMLElement) {
  main.innerHTML = `
  <section class="test-page safe-page secret-page">
    <div class="safe-box recess" id="x-write"></div>
    <div class="safe-box recess" id="x-read">
      <h2>Read a secret</h2>
      <textarea id="x-in" rows="4" placeholder="Paste a message that starts with ${S.PREFIX}"></textarea>
      <p class="row"><button class="btn btn-green" id="x-open" disabled>Open on wedgie</button> <span id="x-rmsg" class="fine"></span></p>
    </div>
    <div class="safe-box recess" id="x-me"></div>
  </section>`;
  const $ = (id: string) => document.getElementById(id)!;
  const copy = (s: string, b: HTMLElement) => navigator.clipboard.writeText(s).then(() => { const t = b.textContent; b.textContent = "Copied"; setTimeout(() => b.textContent = t, 1200); }, () => {});

  // ---- write: to the key in the # ----
  let to: Uint8Array | null = null, sealed = "";
  async function paintWrite() {
    to = S.parseKey(location.hash.slice(1));
    const box = $("x-write");
    if (!to) {
      box.innerHTML = `<h2>Write a secret</h2>
        <p><input id="x-key" placeholder="Their wedgie.dev/secret link" style="width:100%"></p>
        <p class="fine">Only their wedgie can open it.</p>`;
      $("x-key").oninput = () => { const k = S.parseKey(($("x-key") as HTMLInputElement).value); if (k) location.hash = S.b64u(k); };
      return;
    }
    box.innerHTML = `<h2>Write a secret to <span class="mono">${esc(await S.keyId(to))}</span></h2>
      <textarea id="x-text" rows="5" placeholder="Your message"></textarea>
      <p class="row"><button class="btn btn-green" id="x-seal" disabled>Seal</button> <span id="x-count" class="fine"></span></p>
      <div id="x-out" hidden><textarea id="x-blob" rows="4" readonly></textarea>
      <p class="row"><button class="btn btn-sm btn-green" id="x-copy">Copy</button> <span class="fine">Send it in any chat. Only the wedgie showing <b class="mono">${esc(await S.keyId(to))}</b> can open it.</span></p></div>`;
    const text = $("x-text") as HTMLTextAreaElement;
    text.oninput = () => {
      const n = S.size(text.value);
      $("x-count").innerHTML = n > S.MAX ? `<b class="bad">${n} / ${S.MAX} bytes: too long</b>` : n ? `${n} / ${S.MAX}` : "";
      ($("x-seal") as HTMLButtonElement).disabled = !n || n > S.MAX;
      $("x-out").hidden = true;
    };
    $("x-seal").onclick = async () => {
      try { sealed = await S.seal(to!, text.value); } catch (e) { $("x-count").innerHTML = `<b class="bad">${esc(msgOf(e))}</b>`; return; }
      ($("x-blob") as HTMLTextAreaElement).value = sealed;
      $("x-out").hidden = false;
      if (/[^\x20-\x7e\n]/.test(text.value)) $("x-count").textContent = "The wedgie shows emoji and accents as ?";
    };
    $("x-copy").onclick = () => copy(sealed, $("x-copy"));
  }
  window.addEventListener("hashchange", paintWrite);
  paintWrite();

  // ---- the wedgie: its key, and reading ----
  const DRIVE = { key: -1, state: "ready", running: "secret", short: "", log: "" } as unknown as W.Wedgie;
  let driveState = "";
  const ask = <T,>(w: W.Wedgie, fn: (r: Drive.Asker) => Promise<T>): Promise<T> => w === DRIVE ? Drive.withDrive(fn) : W.withRepl(w, fn);
  const ready = () => Drive.inApp() ? (driveState === "here" ? [DRIVE] : []) : W.wedgies().filter((w) => w.state === "ready");
  let wedgie: W.Wedgie | null = null, key: { pub: string; id: string } | null = null, noKey = false, reading = false, tries = 0;

  async function readKey(w: W.Wedgie) {
    wedgie = w;
    try {
      const h = await ask(w, (r) => r.request({ type: "hello" }, 5000));
      key = h.secret || null;
      noKey = !key;
      tries = 0;
      paintMe();
      if (noKey) { await sleep(3000); if (wedgie === w) { wedgie = null; paintMe(); } }   // look again: the wedgie's own A makes it
    } catch {
      if (++tries <= 6) { await sleep(800 * tries); wedgie = null; paintMe(); }    // a port still held by the last page
    }
  }

  function paintMe() {
    const ws = ready(), app = ws.filter((w) => w.running === "secret");
    if (wedgie && !ws.includes(wedgie)) { wedgie = null; key = null; noKey = false; }
    let h = `<h2>Your wedgie</h2>`;
    if (Drive.inApp() && !ws.length) h += `<p class="fine">Plug in your wedgie. <button class="btn btn-sm" id="x-drive">Find it</button></p>`;
    else if (!Drive.inApp() && !W.supported()) h += `<p class="fine">This browser can't talk to a wedgie over USB. Use Chrome, Edge or Brave on a computer.</p>`;
    else if (!ws.length) h += `<p class="fine">Plug it in. Not showing? <a href="/connect">Connect</a> it first.</p>`;
    else if (!app.length) h += `<p class="fine">It isn't running Secrets. <a class="btn btn-sm btn-green" href="/connect/${esc(ws[0].short)}">Install Secrets</a> (on its page, Software: Apps from a GitHub repo, add <b class="mono">clawdbotatg/wedgie-secret</b>).</p>`;
    else if (!key) h += noKey ? `<p><b>Press green on the wedgie to make its key.</b></p>` : `<p class="fine">Reading its key.</p>`;
    else {
      const pub = Uint8Array.from(key.pub.match(/../g)!, (x) => parseInt(x, 16));
      h += `<p>Key <b class="mono">${esc(key.id)}</b> (the wedgie shows the same)</p>
        <p class="row"><button class="btn btn-sm btn-green" id="x-link">Copy my link</button> <span class="fine">Give it out: anyone with it can write to you.</span></p>`;
      $("x-me").innerHTML = h;
      $("x-link").onclick = () => copy(S.link(pub, location.origin), $("x-link"));
      paintOpen();
      return;
    }
    $("x-me").innerHTML = h;
    $("x-drive")?.addEventListener("click", () => Drive.panel());
    paintOpen();
    if (app.length && !key && wedgie !== app[0]) readKey(app[0]);
  }

  const inp = $("x-in") as HTMLTextAreaElement;
  function paintOpen() {
    const v = inp.value.trim();
    ($("x-open") as HTMLButtonElement).disabled = reading || !key || !S.isSealed(v);
    if (!reading) $("x-rmsg").innerHTML = v && !S.isSealed(v) ? `<span class="bad">That isn't a ${S.PREFIX} message.</span>` : v && !key ? "Plug in your wedgie, running Secrets." : "";
  }
  inp.oninput = paintOpen;
  $("x-open").onclick = async () => {
    if (!wedgie || reading) return;
    reading = true; paintOpen();
    $("x-rmsg").innerHTML = "<b>Press green on your wedgie.</b> It shows there, not here.";
    try {
      const r = await ask(wedgie, (q) => q.request({ type: "secret_open", blob: inp.value.trim() }, 200000));
      $("x-rmsg").innerHTML = r.type === "secret_shown" ? `<span class="good">It's on your wedgie. Red closes it.</span>`
        : r.type === "refused" ? "Not opened." : `<span class="bad">${esc(r.error || r.type)}</span>`;
    } catch (e) {
      $("x-rmsg").innerHTML = `<span class="bad">${esc(msgOf(e))}</span>`;
    } finally {
      reading = false;
      ($("x-open") as HTMLButtonElement).disabled = !key || !S.isSealed(inp.value.trim());
    }
  };

  if (Drive.inApp()) {
    const look = async () => { const s = await Drive.status().catch(() => "away"); if (s !== driveState) { driveState = s; paintMe(); } };
    look(); setInterval(look, 1500);
  }
  W.onChange(paintMe);
  if (W.armed()) W.start();
  paintMe();
}
