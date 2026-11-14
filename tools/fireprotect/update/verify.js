const { chromium } = require('playwright');
const fs = require('fs');
const { mk, thk } = require('./slow');
const m = require('./maxtable.json');
const TS = [350,400,450,500,525,550,560,600,620,650,700,750], RS = [15,30,45,60,90,120,150,180,240], TH = [20,25,30,40,50,60];
const seen = new Set();
(async () => {
  const b = await chromium.launch({ executablePath: process.env.EXE || undefined, headless: true });
  const jobs = []; for (const R of RS) for (const T of TS) jobs.push([R, T]);
  const out = {}; let idx = 0;
  const pages = await Promise.all([0,1,2,3,4].map(() => mk(b)));
  await Promise.all(pages.map(async p => {
    const ok = async (av, T, R, t) => { const r = await thk(p, av, T, R); if (typeof r.t === 'number') seen.add(r.t); else if (r.t !== null) seen.add(String(r.t)); return typeof r.t === 'number' && r.t <= t; };
    while (idx < jobs.length) {
      const [R, T] = jobs[idx++]; const row = {}; const notes = [];
      for (const t of TH) {
        let v = m[R][T][t]; if (v === undefined) v = 716;
        let good;
        if (v === 0) good = !(await ok(1, T, R, t));
        else if (v === 716) good = await ok(716, T, R, t);
        else good = (await ok(v, T, R, t)) && !(await ok(v + 1, T, R, t));
        if (!good) {
          // slow binary search
          if (!(await ok(1, T, R, t))) v = 0; else if (await ok(716, T, R, t)) v = 716; else { let lo = 1, hi = 716; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (await ok(mid, T, R, t)) lo = mid; else hi = mid; } v = lo; }
          notes.push(t + ':' + (m[R][T][t] ?? 716) + '->' + v);
        }
        row[t] = v;
      }
      (out[R] = out[R] || {})[T] = row;
      process.stderr.write(`R${R} ${T} ${JSON.stringify(row)} ${notes.join(' ')}\n`);
      fs.writeFileSync('maxtable_verified.json', JSON.stringify(out, null, 1));
    }
  }));
  console.log('thicknesses seen:', [...seen].join(','));
  await b.close();
})();
