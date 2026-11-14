const fs = require('fs');
const prof = require('./profiles.json');
function parseLog(f) { const o = {}; if (!fs.existsSync(f)) return o; for (const line of fs.readFileSync(f, 'utf8').split('\n')) { const m = line.match(/^(\w+) (.*?) (\{.*\})$/); if (!m) continue; (o[m[1]] = o[m[1]] || {})[m[2]] = JSON.parse(m[3]); } return o; }
// Alle avlesningsrunder: hver apv*.log (stderr fra apv.js) er én uavhengig runde.
const runs = fs.readdirSync(__dirname).filter(f => /^apv.*\.log$/.test(f)).map(f => parseLog(require('path').join(__dirname, f)));
const final = {}, disputes = [];
for (const pt of Object.keys(prof)) {
  if (pt === 'hsq') continue;
  const dims = [...new Set(prof[pt].selects.find(s => s.id === 'dimensionSelect').opts.map(o => o.split('=')[0]))];
  final[pt] = {};
  for (const d of dims) {
    const vals = runs.map(r => r[pt] && r[pt][d]).filter(Boolean);
    const keys = [...new Set(vals.flatMap(v => Object.keys(v)))];
    final[pt][d] = {};
    for (const k of keys) {
      const cnt = {}; vals.forEach(v => { if (v[k] != null) cnt[v[k]] = (cnt[v[k]] || 0) + 1; });
      const ent = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
      if (ent.length === 1 && ent[0][1] >= 2) final[pt][d][k] = +ent[0][0];
      else { final[pt][d][k] = null; disputes.push([pt, d, k, cnt]); }
    }
  }
}
fs.writeFileSync('apv_merged.json', JSON.stringify(final, null, 1));
fs.writeFileSync('disputes.json', JSON.stringify(disputes));
console.log('disputes', disputes.length);
const byPt = {}; disputes.forEach(d => byPt[d[0]] = (byPt[d[0]] || 0) + 1); console.log(byPt);
disputes.slice(0, 25).forEach(d => console.log(JSON.stringify(d)));
