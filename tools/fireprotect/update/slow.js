const { chromium } = require('playwright');
async function mk(b) { const p = await b.newPage(); await p.goto('https://fireprotect.isover.se/selfdefined', { waitUntil: 'load' }); await p.waitForSelector('#avInput'); await p.waitForTimeout(3000); return p; }
async function optsStable(p) { let last = '', same = 0; for (let i = 0; i < 40; i++) { const v = (await p.$$eval('#fireResistanceSelect option', o => o.map(x => x.value))).join(','); if (v === last) { if (++same >= 4) return v.split(',').map(Number); } else { last = v; same = 0; } await p.waitForTimeout(60); } return last.split(',').map(Number); }
async function thk(p, av, T, R) {
  await p.fill('#avInput', String(av)); await p.press('#avInput', 'Tab');
  await p.selectOption('#temperatureSelect', String(T));
  const rs = await optsStable(p);
  if (!rs.includes(R)) return { rs, t: null };
  await p.selectOption('#fireResistanceSelect', String(R));
  await p.waitForTimeout(100);
  await p.click('button[type=submit]');
  for (let i = 0; i < 60; i++) { const t = await p.$$eval('.alert', a => a.filter(x => !x.hidden).map(x => x.textContent.trim()).join(' / ')); if (t) { const m = t.match(/is (\d+) mm/); return { rs, t: m ? +m[1] : t }; } await p.waitForTimeout(60); }
  return { rs, t: 'TIMEOUT' };
}
module.exports = { mk, thk };
if (require.main === module) (async () => {
  const b = await chromium.launch({ executablePath: process.env.EXE || undefined, headless: true }); const p = await mk(b);
  const q = JSON.parse(process.argv[2]);
  for (const [av, T, R] of q) { const r = await thk(p, av, T, R); console.log(av, T, R, '=>', r.t, '[' + r.rs.join(',') + ']'); }
  await b.close();
})();
