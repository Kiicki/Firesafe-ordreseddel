const fs = require('fs');
const prof = require('./profiles.json');
const m = require('./apv_merged.json');
const res = fs.existsSync(__dirname + '/resolved.json') ? require('./resolved.json') : {};
for (const k in res) { const [pt, d, s] = k.split('§'); if (res[k][0] !== res[k][1]) throw 'unresolved ' + k; m[pt][d][s] = res[k][0]; }
const SIDES = { hea:['he1','he2','he3','he4','he5'], heb:['he1','he2','he3','he4','he5'], hem:['he1','he2','he3','he4','he5'], ipe:['ipe1','ipe2','ipe3','ipe4','ipe5'], ue:['u1','u2','u3','u4','u5','u6'], upe:['u1','u2','u3','u4','u5','u6'], upn:['u1','u2','u3','u4','u5','u6'], l:['l0','l1','l2','l3'], li:['li0','li1','li2','li3','li4'], shs:['shs0','shs1','shs2','shs3'], rhs:['rhs0','rhs1','rhs2','rhs3','rhs4','rhs5'] };
const out = {}; let n = 0;
for (const pt of ['hea','heb','hem','ipe','upe','upn','ue','l','li','shs','rhs','chs']) {
  const dims = [...new Set(prof[pt].selects.find(s => s.id === 'dimensionSelect').opts.map(o => o.split('=')[0]))];
  const parts = [];
  for (const d of dims) {
    const v = m[pt][d];
    if (!v) throw 'missing dim ' + pt + ' ' + d;
    if (pt === 'chs') {
      const ths = Object.keys(v).map(k => k.split('|')[0]);
      for (const th of ths) { const x = v[th + '|chs0']; if (x == null) throw 'null ' + pt + d + th; parts.push(d + '|' + th.replace('.', ',') + ':' + x); n++; }
      continue;
    }
    const vals = SIDES[pt].map(s => v[s]);
    if (vals.some(x => x == null || isNaN(x))) throw 'null ' + pt + ' ' + d + JSON.stringify(v);
    let key = d;
    if (pt === 'l' || pt === 'li') { const mm = d.match(/^L (\S+) x (\S+) x (\S+)$/); key = mm[1] + 'x' + mm[2] + '|' + mm[3]; }
    else if (pt === 'shs' || pt === 'rhs') { const mm = d.match(/^(\S+?)x(\S+?)x(\S+)$/); key = mm[1] + 'x' + mm[2] + '|' + mm[3]; }
    parts.push(key + ':' + vals.join(',')); n += vals.length;
  }
  out[pt] = parts.join(';');
}
const mt = require('./maxtable_verified.json');
const TS = [350,400,450,500,525,550,560,600,620,650,700,750], TH = [20,25,30,40,50,60];
const max = {}; for (const R of [15,30,45,60,90,120,150,180,240]) max[R] = TS.map(T => TH.map(t => mt[R][T][t]).join(',')).join(';');
// HSQ
// Union av alle HSQ-runder (hsq*.json fra hsq2.js). En runde kan miste et R-valg (treg side),
// så en R som finnes i én runde tas med — men ulike tykkelser for samme nøkkel = stopp og sjekk.
const hs = {};
for (const f of fs.readdirSync(__dirname).filter(f => /^hsq.*\.json$/.test(f))) {
  const h = require('./' + f);
  for (const k in h) { if (!/^\d+$/.test(h[k])) continue; if (hs[k] && hs[k] !== h[k]) throw 'HSQ-runder uenige: ' + k + ' ' + hs[k] + ' vs ' + h[k]; hs[k] = h[k]; }
}
const hg = {};
for (const k in hs) { const p = k.split('|'); if (p[4] === '0' || p[4] === 'none' || !/^\d+$/.test(hs[k])) continue; const g = p.slice(0, 4).join('|'); (hg[g] = hg[g] || []).push(p[4] + '=' + hs[k]); }
for (const g in hg) hg[g].sort((a, b) => parseInt(a) - parseInt(b));
const hsq = Object.keys(hg).map(g => g + ':' + hg[g].join(',')).join(';');
let js = '';
js += '// Maks Ap/V pr. platetykkelse (20,25,30,40,50,60 mm) for hver kritisk temperatur\n// (FP_TEMPS-rekkefølge, adskilt med «;»). 0 = tykkelsen holder ikke for noen Ap/V.\n';
js += 'var FP_MAX = {\n' + Object.keys(max).map(R => '    ' + R + ": '" + max[R] + "'").join(',\n') + '\n};\n';
js += '// Ap/V (m⁻¹, avrundet som i Isover-kalkulatoren) pr. dimensjon. Verdiene står i samme\n// rekkefølge som FP_SIDE_SETS for profilfamilien. «størrelse|godstykkelse» for split-typer.\n';
js += 'var FP_APV = {\n' + Object.keys(out).map(k => '    ' + k + ": '" + out[k] + "'").join(',\n') + '\n};\n';
js += '// HSQ: side|bunnflens|betong|temp → R=mm. Kombinasjoner som mangler har ingen data hos Isover.\n';
js += "var FP_HSQ = '" + hsq + "';\n";
fs.writeFileSync('./fpdata.js', js);
console.log('values', n, 'bytes', js.length, 'hsq groups', Object.keys(hg).length);
