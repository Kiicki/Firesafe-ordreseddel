const { chromium } = require('playwright');
const { mk, thk } = require('./slow');
const m = require('./maxtable_verified.json');
const TS = [350,400,450,500,525,550,560,600,620,650,700,750], RS = [15,30,45,60,90,120,150,180,240], TH = [20,25,30,40,50,60];
function look(av, T, R) { if (av > 716) return null; const row = m[R][T]; for (const t of TH) if (av <= row[t]) return t; return null; }
(async () => {
  const b = await chromium.launch({ executablePath: process.env.EXE || undefined, headless: true });
  const q = [[55,450,150],[56,450,150],[1,450,150],[1,620,180],[47,600,180],[48,600,180],[95,560,180],[95,550,180],[96,550,180],[52,650,180]];
  let s = 12345; const rnd = n => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; };
  for (let i = 0; i < 150; i++) q.push([1 + rnd(400), TS[rnd(12)], RS[1 + rnd(8)]]);
  const pages = await Promise.all([0,1,2,3].map(() => mk(b))); let idx = 0, bad = 0;
  await Promise.all(pages.map(async p => { while (idx < q.length) { const [av, T, R] = q[idx++]; const r = await thk(p, av, T, R); const e = look(av, T, R); if (r.t !== e) { bad++; console.log('MISMATCH', av, T, R, 'site', r.t, 'mine', e); } } }));
  console.log('done', q.length, 'mismatches', bad); await b.close();
})();
