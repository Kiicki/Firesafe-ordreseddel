const { chromium } = require('playwright');
const fs = require('fs');
async function stable(p, sel) { let last = '', same = 0; for (let i = 0; i < 50; i++) { const v = (await p.$$eval(sel + ' option', o => o.map(x => x.value))).join(','); if (v === last) { if (++same >= 5) return v ? v.split(',') : []; } else { last = v; same = 0; } await p.waitForTimeout(60); } return last ? last.split(',') : []; }
(async () => {
  const b = await chromium.launch({ executablePath: process.env.EXE || undefined, headless: true });
  const p = await b.newPage();
  await p.goto('https://fireprotect.isover.se/hsq', { waitUntil: 'load' });
  await p.waitForSelector('form'); await p.waitForTimeout(3000);
  const out = {};
  for (const side of ['hsq0','hsq1']) for (const d of ['8','10','12','15','20','25']) for (const rho of ['660','1800','2300']) for (const T of ['400','500','600']) {
    await p.click('label[for="' + side + '"]'); await p.waitForTimeout(150);
    await p.selectOption('#dimensionSelect', d); await p.waitForTimeout(150);
    await p.selectOption('#ConcreteDensistySelect', rho); await p.waitForTimeout(150);
    await p.selectOption('#temperatureSelect', T);
    const rs = await stable(p, '#fireResistanceSelect');
    for (const R of rs) {
      await p.selectOption('#fireResistanceSelect', R); await p.waitForTimeout(150);
      // alert must be hidden before calculating
      await p.click('button[type=submit]');
      let txt = '';
      for (let i = 0; i < 60 && !txt; i++) { await p.waitForTimeout(70); txt = await p.$$eval('.alert', a => a.filter(x => !x.hidden).map(x => x.textContent.trim()).join(' / ')); }
      const key = [side, d, rho, T, R].join('|'); out[key] = (txt.match(/is (\d+) mm/) || [, txt])[1];
      process.stderr.write(key + ' => ' + out[key] + '\n');
      await p.selectOption('#temperatureSelect', T === '400' ? '500' : '400'); await p.waitForTimeout(150); await p.selectOption('#temperatureSelect', T); await stable(p, '#fireResistanceSelect');
    }
    if (!rs.length) out[[side, d, rho, T].join('|') + '|none'] = 'no R';
  }
  fs.writeFileSync(process.env.OUT || 'hsq_run.json', JSON.stringify(out, null, 1));
  await b.close();
})();
