// POPUP-AUDIT (27-11-2026) — sjekker ALLE vinduer i appen i en ekte nettleser (headless Chromium):
// lang liste (80 rader), hvert felt med tastatur oppe, tastatur lukket, og åpnet mens tastaturet
// var oppe. Feiler hvis toppen eller nederste knapp (Velg/OK/Lagre) havner utenfor det synlige.
// Tastaturet simuleres med en falsk visualViewport som krymper (som Android Chrome).
//
// Kjør (WSL):
//   1. Playwright finnes via npx-cachen: ~/.npm/_npx/*/node_modules/playwright (ellers: npx -y playwright@1.62 install chromium-headless-shell)
//   2. Mangler libasound.so.2: `apt-get download libasound2t64 && dpkg -x libasound2t64_*.deb x` i en mappe, og
//      LD_LIBRARY_PATH=<mappe>/x/usr/lib/x86_64-linux-gnu
//   3. W=354 H=790 KB=330 node .claude/popup-audit.js   (også 320×568 KB=260 og 412×915 KB=340)
//   «ingen scroll-område» = vinduet ruller som helhet (små meldingsvinduer) — bare info.
const { chromium } = require(process.env.PW || require('child_process').execSync('ls -d ~/.npm/_npx/*/node_modules/playwright | head -1', {shell:'/bin/bash'}).toString().trim());
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell' });
  const W = +(process.env.W || 354), H = +(process.env.H || 790), KB = +(process.env.KB || 330);
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; ONEPLUS) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
  await ctx.addInitScript(([W,H,KB]) => {
    const et = new EventTarget();
    const vv = { height: H, width: W, offsetTop: 0, offsetLeft: 0, scale: 1, pageTop: 0,
      addEventListener: et.addEventListener.bind(et), removeEventListener: et.removeEventListener.bind(et), dispatchEvent: et.dispatchEvent.bind(et) };
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    window.__kbd = (open) => { vv.height = open ? H - KB : H; vv.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize')); };
  }, [W,H,KB]);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,150)));
  await page.goto('file:///mnt/c/Users/Igor/Desktop/Firesafe-ordreseddel/index.html');
  await page.waitForTimeout(2500);
  const res = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const BD = '.confirm-modal, .spec-popup-backdrop, .fakturaadresse-popup-backdrop';
    const CT = '.confirm-modal-content, .spec-popup-sheet, .fakturaadresse-popup-sheet, .template-editor-content';
    const vis = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const lowBtn = sheet => { let best = null; sheet.querySelectorAll('button').forEach(b => { if (!vis(b)) return; const r = b.getBoundingClientRect(); if (!best || r.bottom > best.bottom) best = r; }); return best; };
    const check = (sheet, tag, issues) => {
      const vv = window.visualViewport; const top = vv.offsetTop, bot = vv.offsetTop + vv.height;
      const s = sheet.getBoundingClientRect(); const b = lowBtn(sheet);
      if (s.top < top - 1) issues.push(tag + ': toppen utenfor (' + Math.round(s.top) + ')');
      if (b && (b.bottom > bot + 1 || b.top < top - 1)) {
        let el = null; sheet.querySelectorAll('button').forEach(x => { if (vis(x) && x.getBoundingClientRect().bottom === b.bottom) el = x; });
        let ok = false;
        if (el) { el.scrollIntoView({ block: 'nearest' }); const r2 = el.getBoundingClientRect(); ok = r2.bottom <= bot + 1 && r2.top >= top - 1; }
        issues.push(tag + (ok ? ': (info) knappen nås ved å rulle i vinduet' : ': nederste knapp ' + Math.round(b.top) + '..' + Math.round(b.bottom) + ' > synlig ' + Math.round(bot)));
      }
      if (!b && s.bottom > bot + 1) issues.push(tag + ': arket går under kanten (' + Math.round(s.bottom) + ' > ' + Math.round(bot) + ')');
    };
    const scrollHost = sheet => { let host = null, area = 0;
      sheet.querySelectorAll('*').forEach(el => { const oy = getComputedStyle(el).overflowY; if ((oy === 'auto' || oy === 'scroll') && vis(el)) { const r = el.getBoundingClientRect(); if (r.width * r.height > area) { area = r.width * r.height; host = el; } } });
      return host; };
    const out = {};
    const bds = Array.from(document.querySelectorAll(BD)).filter(b => b.id);
    for (const bd of bds) {
      const sheet = bd.querySelector(CT); if (!sheet) continue;
      const issues = [];
      for (const pre of [false, true]) {
        let ext = null;
        if (pre) { ext = document.createElement('input'); ext.type = 'text'; document.body.appendChild(ext); ext.focus(); window.__kbd(true); await sleep(300); }
        bd.classList.add('active'); await sleep(50);
        if (pre && document.activeElement !== ext) { window.__kbd(false); }   // som telefonen: feltet mistet fokus → tastaturet lukkes
        await sleep(250);
        const host = scrollHost(sheet) || sheet.querySelector('.spec-popup-body, .confirm-modal-body, .template-editor-body') ;
        const filler = document.createElement('div'); filler.className = '__filler';
        for (let i = 0; i < 80; i++) { const d = document.createElement('div'); d.style.cssText = 'height:44px;border-bottom:1px solid #eee'; d.textContent = 'Rad ' + i; filler.appendChild(d); }
        (host || sheet).appendChild(filler);
        if (!host && !["auto","scroll"].includes(getComputedStyle(sheet).overflowY)) issues.push('ingen scroll-område funnet (fyll lagt rett i arket)');
        await sleep(300);
        if (pre) { check(sheet, 'åpnet med tastatur oppe', issues); ext.blur(); window.__kbd(false); await sleep(500); check(sheet, 'etter tastatur lukket (åpnet med tastatur)', issues); ext.remove(); }
        else {
          check(sheet, 'lang liste', issues);
          const inputs = Array.from(sheet.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea')).filter(vis).slice(0, 6);
          for (const inp of inputs) {
            inp.focus(); window.__kbd(true); await sleep(450);
            check(sheet, 'tastatur i ' + (inp.id || inp.placeholder || inp.className || 'felt'), issues);
            inp.blur(); window.__kbd(false); await sleep(450);
            check(sheet, 'lukket etter ' + (inp.id || inp.placeholder || 'felt'), issues);
          }
        }
        filler.remove();
        bd.classList.remove('active'); if (typeof _clearPopupTopAnchor === 'function') _clearPopupTopAnchor(bd.id); await sleep(200);
      }
      out[bd.id] = issues;
    }
    return out;
  });
  let bad = 0;
  for (const [id, iss] of Object.entries(res)) { if (iss.length) { bad++; console.log('✗ ' + id); [...new Set(iss)].forEach(i => console.log('     ' + i)); } }
  console.log('Testet ' + Object.keys(res).length + ' vinduer, ' + bad + ' med funn. OK: ' + Object.entries(res).filter(e => !e[1].length).map(e => e[0]).join(', '));
  await browser.close();
})();
