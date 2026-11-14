const { chromium } = require('playwright');
const fs = require('fs');
const IMG = process.env.IMG;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.EXE || undefined, headless: true });
  const p = await b.newPage();
  const out = {};
  for (const pt of ['hea','heb','hem','ipe','ue','upe','upn','l','li','shs','rhs','hsq','chs']) {
    await p.goto('https://fireprotect.isover.se/' + pt, { waitUntil: 'load' });
    await p.waitForSelector('form'); await p.waitForTimeout(2500);
    const info = await p.evaluate(() => ({
      sides: [...document.querySelectorAll('label.btn')].map(l => ({ for: l.htmlFor, text: l.textContent.trim().replace(/\s+/g,' '), img: l.querySelector('img') && l.querySelector('img').getAttribute('src') })),
      selects: [...document.querySelectorAll('select')].map(s => ({ id: s.id, label: (document.querySelector('label[for="'+s.id+'"]')||{}).textContent, opts: [...s.options].map(o => o.value + '=' + o.textContent) })),
      inputs: [...document.querySelectorAll('input:not([type=hidden]):not([type=radio])')].map(i => i.id),
      labels: [...document.querySelectorAll('.form-label')].map(l => l.textContent.trim()),
    }));
    out[pt] = info;
    if (IMG) for (const s of info.sides) if (s.img) {
      const r = await p.request.get('https://fireprotect.isover.se/' + s.img);
      fs.writeFileSync(IMG + '/' + s.img.replace(/\//g,'_'), await r.body());
    }
    console.log(pt, info.sides.map(s=>s.text).join(' | '), '||', info.selects.map(s => s.id + '(' + s.opts.length + ')').join(' '), info.inputs.join(','));
  }
  fs.writeFileSync('profiles.json', JSON.stringify(out, null, 1));
  await b.close();
})();
