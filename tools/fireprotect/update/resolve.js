const { chromium } = require('playwright');
const fs = require('fs');
const disp = require('./disputes.json');
async function readApv(p) { return p.evaluate(() => { const l = [...document.querySelectorAll('.form-label')].find(x => /A\s*p\s*\/V/.test(x.textContent)); const m = l && l.textContent.match(/V\s*(\d+)/); return m ? +m[1] : null; }); }
(async () => {
  const b = await chromium.launch({ executablePath: process.env.EXE || undefined, headless: true });
  const groups = {}; disp.forEach(d => (groups[d[0]] = groups[d[0]] || []).push(d));
  const res = {};
  await Promise.all(Object.keys(groups).map(async pt => {
    const p = await b.newPage();
    await p.goto('https://fireprotect.isover.se/' + pt, { waitUntil: 'load' }); await p.waitForSelector('form'); await p.waitForTimeout(3000);
    for (const [, d, k] of groups[pt]) {
      const reads = [];
      for (let rep = 0; rep < 2; rep++) {
        // gå via en annen dimensjon først så vi ser en reell endring
        const opts = await p.$$eval('#dimensionSelect option', o => o.map(x => x.value));
        await p.selectOption('#dimensionSelect', opts[(opts.indexOf(d) + 1) % opts.length]); await p.waitForTimeout(800);
        await p.selectOption('#dimensionSelect', d); await p.waitForTimeout(1000);
        let side = k;
        if (k.includes('|')) { const [th, s] = k.split('|'); await p.selectOption('#thicknessSelect', th); await p.waitForTimeout(1000); side = s; }
        await p.click('label[for="' + side + '"]'); await p.waitForTimeout(1200);
        reads.push(await readApv(p));
      }
      res[[pt, d, k].join('§')] = reads;
      console.log(pt, d, k, reads.join(' / '));
    }
    await p.close();
  }));
  fs.writeFileSync('resolved.json', JSON.stringify(res, null, 1));
  await b.close();
})();
