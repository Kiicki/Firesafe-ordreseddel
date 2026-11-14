const { chromium } = require('playwright');
const fs = require('fs');
const TS = [350,400,450,500,525,550,560,600,620,650,700,750];
const RS = [15,30,45,60,90,120,150,180,240];
const THK = [20,25,30,40,50,60];
async function mkPage(b) {
  const p = await b.newPage();
  await p.goto('https://fireprotect.isover.se/selfdefined', { waitUntil: 'load' });
  await p.waitForSelector('#avInput'); await p.waitForTimeout(3000);
  return p;
}
// returns thickness number, or null if R not available / out of range
async function thk(p, av, T, R) {
  await p.fill('#avInput', String(av)); await p.press('#avInput', 'Tab');
  await p.selectOption('#temperatureSelect', String(T));
  await p.waitForTimeout(120);
  const rs = await p.$$eval('#fireResistanceSelect option', o => o.map(x => +x.value));
  if (!rs.includes(R)) return null;
  await p.selectOption('#fireResistanceSelect', String(R));
  await p.click('button[type=submit]');
  for (let i = 0; i < 40; i++) {
    const t = await p.$$eval('.alert', a => a.filter(x => !x.hidden).map(x => x.textContent.trim()).join(' / '));
    if (t) { const m = t.match(/is (\d+) mm/); return m ? +m[1] : null; }
    await p.waitForTimeout(75);
  }
  throw new Error('no result ' + av + ' ' + T + ' ' + R);
}
// max av (1..716) with thk(av) <= t ; 0 if none. monotonic assumption: thk non-decreasing, null = beyond
async function maxFor(p, T, R, t) {
  const ok = async av => { const r = await thk(p, av, T, R); return r != null && r <= t; };
  if (!(await ok(1))) return 0;
  if (await ok(716)) return 716;
  let lo = 1, hi = 716;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (await ok(m)) lo = m; else hi = m; }
  return lo;
}
(async () => {
  const b = await chromium.launch({ executablePath: process.env.EXE || undefined, headless: true });
  const jobs = []; for (const T of TS) for (const R of RS) jobs.push([T, R]);
  const out = {};
  const N = 6; const pages = await Promise.all(Array.from({ length: N }, () => mkPage(b)));
  let idx = 0;
  await Promise.all(pages.map(async p => {
    while (idx < jobs.length) {
      const [T, R] = jobs[idx++];
      const row = {};
      for (const t of THK) { row[t] = await maxFor(p, T, R, t); if (row[t] === 716) break; }
      (out[R] = out[R] || {})[T] = row;
      process.stderr.write(`R${R} ${T}: ${JSON.stringify(row)}\n`);
      fs.writeFileSync('maxtable.json', JSON.stringify(out, null, 1));
    }
  }));
  await b.close();
})();
