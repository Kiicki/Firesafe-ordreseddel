const { chromium } = require('playwright');
const fs = require('fs');
const prof = require('./profiles.json');
const TYPES = (process.argv[2] || 'hea,heb,hem,ipe,ue,upe,upn,l,li,shs,rhs,chs').split(',');
async function readApv(p) { return p.evaluate(() => { const l = [...document.querySelectorAll('.form-label')].find(x => /A\s*p\s*\/V/.test(x.textContent)); if (!l) return null; const m = l.textContent.match(/V\s*(-?[\d.,]+)/); return m ? m[1] : null; }); }
async function settle(p, prev) {
  let last = await readApv(p), same = 0;
  for (let i = 0; i < 30; i++) { await p.waitForTimeout(60); const v = await readApv(p); if (v === last) { if (++same >= 7) return v; } else { last = v; same = 0; } }
  return last;
}
(async () => {
  const b = await chromium.launch({ executablePath: process.env.EXE || undefined, headless: true });
  const out = fs.existsSync((process.env.OUT || require('path').join(__dirname, 'apv.json'))) ? require((process.env.OUT || require('path').join(__dirname, 'apv.json'))) : {};
  await Promise.all(TYPES.map(async pt => {
    const p = await b.newPage();
    await p.goto('https://fireprotect.isover.se/' + pt, { waitUntil: 'load' });
    await p.waitForSelector('form'); await p.waitForTimeout(3000);
    const sides = prof[pt].sides.map(s => s.for);
    const dims = prof[pt].selects.find(s => s.id === 'dimensionSelect').opts.map(o => o.split('=')[0]).slice(+process.env.FROM || 0);
    const res = {};
    let prev = null;
    for (const d of dims) {
      await p.selectOption('#dimensionSelect', d); prev = await settle(p, null);
      let ths = [null];
      if (pt === 'chs') ths = await p.$$eval('#thicknessSelect option', o => o.map(x => x.value));
      res[d] = {};
      for (const th of ths) {
        if (th != null) { await p.selectOption('#thicknessSelect', th); }
        for (const s of sides) {
          await p.click('label[for="' + s + '"]');
          const v = await settle(p, null);
          res[d][(th != null ? th + '|' : '') + s] = v;
        }
      }
      process.stderr.write(pt + ' ' + d + ' ' + JSON.stringify(res[d]) + '\n');
    }
    out[pt] = res; fs.writeFileSync((process.env.OUT || require('path').join(__dirname, 'apv.json')), JSON.stringify(out, null, 1));
    await p.close();
  }));
  await b.close();
})();
