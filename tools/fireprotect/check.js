// Ukentlig sjekk: har Isover endret FireProtect-kalkulatoren (fireprotect.isover.se)?
// Sammenligner et utvalg mot tallene appen bruker (leses rett fra script-ui.js, så sjekken
// alltid gjelder det som faktisk er publisert). Utvalget varierer fra uke til uke (seed =
// ukenummer), så over tid dekkes hele tabellen.
//
// Sjekker:
//   1. Lister på hver profilside: dimensjoner, temperaturer, antall sidevalg
//   2. Ap/V for et utvalg profil × dimensjon × side
//   3. Tykkelsesgrenser (selvdefinert Ap/V): v gir ≤ t og v+1 gir > t
//   4. HSQ-tabellen (utvalg)
// Mistenkt avvik sjekkes 2 ganger til, sakte — bare vedvarende avvik rapporteres
// (siden kan svare tregt; da er første avlesning noen ganger gammel).
//
// Utskrift: markdown-rapport på stdout. Exit-kode: 0 = ingen endring, 1 = endring funnet,
// 2 = kunne ikke sjekke (blokkert / siden nede / ukjent feil).
//
// Lokalt: EXE=<sti til chrome> node check.js   (uten EXE brukes Playwrights egen chromium)

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const SITE = 'https://fireprotect.isover.se/';
const SCRIPT = process.env.FP_SCRIPT || path.join(__dirname, '..', '..', 'script-ui.js');   // FP_SCRIPT: kun for testing

// ---------- Data fra appen ----------
function loadAppData() {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const a = src.indexOf('var FP_TEMPS');
    const b = src.indexOf('var FP_HSQ');
    const c = src.indexOf('\n', b);
    if (a < 0 || b < 0) throw new Error('Fant ikke FP-dataene i script-ui.js');
    const ctx = {};
    vm.runInNewContext(src.slice(a, c).replace(/^var /gm, 'this.'), ctx);
    return ctx;
}

// Rekkefølgen på sidevalgene i FP_APV (= Isovers radio-id-er på hver profilside).
const SIDES = {
    hea: ['he1', 'he2', 'he3', 'he4', 'he5'], heb: ['he1', 'he2', 'he3', 'he4', 'he5'], hem: ['he1', 'he2', 'he3', 'he4', 'he5'],
    ipe: ['ipe1', 'ipe2', 'ipe3', 'ipe4', 'ipe5'],
    ue: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'], upe: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'], upn: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'],
    l: ['l0', 'l1', 'l2', 'l3'], li: ['li0', 'li1', 'li2', 'li3', 'li4'],
    shs: ['shs0', 'shs1', 'shs2', 'shs3'], rhs: ['rhs0', 'rhs1', 'rhs2', 'rhs3', 'rhs4', 'rhs5'], chs: ['chs0']
};
// Isovers dimensjonsverdi → appens nøkkel.
function siteKey(pt, d, th) {
    let m;
    if ((pt === 'l' || pt === 'li') && (m = d.match(/^L (\S+) x (\S+) x (\S+)$/))) return m[1] + 'x' + m[2] + '|' + m[3];
    if ((pt === 'shs' || pt === 'rhs') && (m = d.match(/^(\S+?)x(\S+?)x(\S+)$/))) return m[1] + 'x' + m[2] + '|' + m[3];
    if (pt === 'chs') return d + '|' + String(th).replace('.', ',');
    return d;
}
function parseApv(str) {
    const rows = {};
    String(str).split(';').forEach(part => { const i = part.indexOf(':'); if (i > 0) rows[part.slice(0, i)] = part.slice(i + 1).split(',').map(Number); });
    return rows;
}
function parseHsq(str) {
    const m = {};
    String(str).split(';').forEach(part => { const i = part.indexOf(':'); if (i < 0) return; const o = {}; part.slice(i + 1).split(',').forEach(rv => { const p = rv.split('='); o[p[0]] = Number(p[1]); }); m[part.slice(0, i)] = o; });
    return m;
}

// ---------- Nettleser ----------
let s0 = Number(process.env.SEED) || Math.floor(Date.now() / (7 * 864e5));   // nytt utvalg hver uke
function rnd(n) { s0 = (s0 * 1103515245 + 12345) % 2147483648; return s0 % n; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function openPage(browser, route) {
    const p = await browser.newPage();
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await p.goto(SITE + route, { waitUntil: 'load', timeout: 45000 });
            await p.waitForSelector('form', { timeout: 20000 });
            await p.waitForTimeout(3000);   // Blazor kobler opp interaktiv modus
            return p;
        } catch (e) {
            const html = await p.content().catch(() => '');
            if (/Incapsula/i.test(html)) throw new BlockedError('Isover (Incapsula) blokkerte nettleseren på /' + route);
            if (attempt === 2) throw e;
            await sleep(5000);
        }
    }
}
class BlockedError extends Error {}

async function stableOptions(p, sel) {
    let last = '', same = 0;
    for (let i = 0; i < 60; i++) {
        const v = (await p.$$eval(sel + ' option', o => o.map(x => x.value))).join('§');
        if (v === last) { if (++same >= 5) break; } else { last = v; same = 0; }
        await p.waitForTimeout(70);
    }
    return last ? last.split('§') : [];
}
async function readAlert(p) {
    for (let i = 0; i < 80; i++) {
        const t = await p.$$eval('.alert', a => a.filter(x => !x.hidden).map(x => x.textContent.trim()).join(' / '));
        if (t) return t;
        await p.waitForTimeout(75);
    }
    return '';
}
async function readApvLabel(p) {
    let last = null, same = 0;
    for (let i = 0; i < 40; i++) {
        const v = await p.evaluate(() => { const l = [...document.querySelectorAll('.form-label')].find(x => /A\s*p\s*\/V/.test(x.textContent)); const m = l && l.textContent.match(/V\s*(\d+)/); return m ? +m[1] : null; });
        if (v === last) { if (++same >= 6) return v; } else { last = v; same = 0; }
        await p.waitForTimeout(80);
    }
    return last;
}

// Selvdefinert Ap/V → tykkelse (mm), null = R ikke tilgjengelig / utenfor område.
async function siteThickness(p, av, T, R, slow) {
    await p.fill('#avInput', String(av)); await p.press('#avInput', 'Tab');
    await p.selectOption('#temperatureSelect', String(T));
    if (slow) await p.waitForTimeout(600);
    const rs = (await stableOptions(p, '#fireResistanceSelect')).map(Number);
    if (!rs.includes(R)) return null;
    await p.selectOption('#fireResistanceSelect', String(R));
    if (slow) await p.waitForTimeout(400);
    await p.click('button[type=submit]');
    const t = await readAlert(p);
    const m = t.match(/is (\d+) mm/);
    return m ? +m[1] : null;
}
function appThickness(D, av, T, R) {
    if (av > D.FP_APV_MAX) return null;
    const row = String(D.FP_MAX[R]).split(';')[D.FP_TEMPS.indexOf(T)].split(',').map(Number);
    for (let i = 0; i < D.FP_TH.length; i++) if (av <= row[i]) return D.FP_TH[i];
    return null;
}

// ---------- Sjekkene ----------
async function run() {
    const D = loadAppData();
    const diffs = [];      // vedvarende avvik
    const stats = { lists: 0, apv: 0, thickness: 0, hsq: 0 };
    const browser = await chromium.launch({ executablePath: process.env.EXE || undefined, headless: true });
    try {
        // 1 + 2: profilsider (lister + Ap/V-utvalg)
        const types = Object.keys(SIDES);
        await Promise.all([0, 1, 2].map(async w => {
            for (let ti = w; ti < types.length; ti += 3) {
                const pt = types[ti];
                const p = await openPage(browser, pt);
                const rows = parseApv(D.FP_APV[pt]);
                // Lister
                const siteDims = [...new Set(await p.$$eval('#dimensionSelect option', o => o.map(x => x.value)))];
                const siteTemps = await p.$$eval('#temperatureSelect option', o => o.map(x => +x.value));
                const siteSides = await p.$$eval('label.btn', l => l.map(x => x.htmlFor));
                stats.lists++;
                if (JSON.stringify(siteTemps) !== JSON.stringify(D.FP_TEMPS)) diffs.push(`**${pt}**: temperaturlista er endret (${siteTemps.join(', ')})`);
                if (JSON.stringify(siteSides) !== JSON.stringify(SIDES[pt])) diffs.push(`**${pt}**: sidevalgene er endret (${siteSides.join(', ')})`);
                const appSizes = new Set(Object.keys(rows).map(k => pt === 'chs' ? k.split('|')[0] : k));
                const siteSizes = new Set(siteDims.map(d => pt === 'chs' ? d : siteKey(pt, d)));
                const added = [...siteSizes].filter(x => !appSizes.has(x)), removed = [...appSizes].filter(x => !siteSizes.has(x));
                if (added.length) diffs.push(`**${pt}**: nye dimensjoner hos Isover: ${added.slice(0, 15).join(', ')}${added.length > 15 ? ' …' : ''}`);
                if (removed.length) diffs.push(`**${pt}**: dimensjoner fjernet hos Isover: ${removed.slice(0, 15).join(', ')}${removed.length > 15 ? ' …' : ''}`);
                // Ap/V-utvalg: 4 tilfeldige dimensjoner × alle sider
                const pool = siteDims.filter(d => pt === 'chs' || appSizes.has(siteKey(pt, d)));
                for (let k = 0; k < 4 && pool.length; k++) {
                    const d = pool[rnd(pool.length)];
                    await p.selectOption('#dimensionSelect', d); await readApvLabel(p);
                    let th = null;
                    if (pt === 'chs') { const ths = await stableOptions(p, '#thicknessSelect'); th = ths[rnd(ths.length)]; await p.selectOption('#thicknessSelect', th); }
                    const key = siteKey(pt, d, th);
                    if (!rows[key]) { diffs.push(`**${pt} ${d}${th ? ' × ' + th : ''}**: finnes hos Isover, mangler i appen`); continue; }
                    for (let si = 0; si < SIDES[pt].length; si++) {
                        const read = async () => { await p.click('label[for="' + SIDES[pt][si] + '"]'); return readApvLabel(p); };
                        let v = await read();
                        if (v !== rows[key][si]) {   // bekreft sakte (via annen dimensjon og tilbake)
                            const vals = [v];
                            for (let rep = 0; rep < 2; rep++) {
                                await p.selectOption('#dimensionSelect', pool[(pool.indexOf(d) + 1) % pool.length]); await p.waitForTimeout(900);
                                await p.selectOption('#dimensionSelect', d); await p.waitForTimeout(900);
                                if (th) { await p.selectOption('#thicknessSelect', th); await p.waitForTimeout(900); }
                                await p.click('label[for="' + SIDES[pt][si] + '"]'); await p.waitForTimeout(1200);
                                vals.push(await readApvLabel(p));
                            }
                            if (vals[1] !== rows[key][si] && vals[1] === vals[2]) diffs.push(`**${pt} ${d}${th ? ' × ' + th : ''}**, side ${si + 1}: Ap/V hos Isover ${vals[1]}, i appen ${rows[key][si]}`);
                        }
                        stats.apv++;
                    }
                }
                await p.close();
            }
        }));

        // 3: tykkelsesgrenser via selvdefinert Ap/V
        const cells = [];
        for (const R of D.FP_RS) D.FP_TEMPS.forEach((T, ti) => {
            const row = String(D.FP_MAX[R]).split(';')[ti].split(',').map(Number);
            D.FP_TH.forEach((t, i) => cells.push({ R, T, t, v: row[i] }));
        });
        const sample = [];
        const interesting = cells.filter(c => c.v > 0 && c.v < D.FP_APV_MAX);
        for (let i = 0; i < 120; i++) sample.push(interesting[rnd(interesting.length)]);
        for (let i = 0; i < 15; i++) { const c = cells[rnd(cells.length)]; if (!(c.v > 0 && c.v < D.FP_APV_MAX)) sample.push(c); }
        let idx = 0;
        await Promise.all([0, 1, 2].map(async () => {
            const p = await openPage(browser, 'selfdefined');
            while (idx < sample.length) {
                const c = sample[idx++];
                // Punkter som sjekkes: v og v+1 (grense), eller 1 / 716 for kanttilfeller.
                const pts = c.v > 0 && c.v < D.FP_APV_MAX ? [c.v, c.v + 1] : [c.v === 0 ? 1 : D.FP_APV_MAX];
                for (const av of pts) {
                    const want = appThickness(D, av, c.T, c.R);
                    let got = await siteThickness(p, av, c.T, c.R, false);
                    if (got !== want) {
                        const g2 = await siteThickness(p, av, c.T, c.R, true), g3 = await siteThickness(p, av, c.T, c.R, true);
                        if (g2 === g3 && g2 !== want) diffs.push(`R${c.R}, ${c.T} °C, Ap/V ${av}: Isover gir ${g2 == null ? '«ikke mulig»' : g2 + ' mm'}, appen ${want == null ? '«ikke mulig»' : want + ' mm'}`);
                    }
                    stats.thickness++;
                }
            }
            await p.close();
        }));

        // 4: HSQ-utvalg
        const hsq = parseHsq(D.FP_HSQ);
        const p = await openPage(browser, 'hsq');
        for (let i = 0; i < 12; i++) {
            const side = ['hsq0', 'hsq1'][rnd(2)], d = ['8', '10', '12', '15', '20', '25'][rnd(6)], rho = ['660', '1800', '2300'][rnd(3)], T = ['400', '500', '600'][rnd(3)];
            const read = async () => {
                await p.click('label[for="' + side + '"]'); await p.waitForTimeout(500);
                await p.selectOption('#dimensionSelect', d); await p.waitForTimeout(500);
                await p.selectOption('#ConcreteDensistySelect', rho); await p.waitForTimeout(500);
                await p.selectOption('#temperatureSelect', T === '400' ? '500' : '400'); await p.waitForTimeout(400);
                await p.selectOption('#temperatureSelect', T); await p.waitForTimeout(900);
                const rs = await stableOptions(p, '#fireResistanceSelect');
                const o = {};
                for (const R of rs) {
                    await p.selectOption('#fireResistanceSelect', R); await p.waitForTimeout(300);
                    await p.click('button[type=submit]');
                    const m = (await readAlert(p)).match(/is (\d+) mm/); if (m) o[R] = +m[1];
                    await p.selectOption('#temperatureSelect', T === '400' ? '500' : '400'); await p.waitForTimeout(400);
                    await p.selectOption('#temperatureSelect', T); await p.waitForTimeout(700);
                }
                return JSON.stringify(o);
            };
            const want = JSON.stringify(hsq[[side, d, rho, T].join('|')] || {});
            let got = await read();
            if (got !== want) { const g2 = await read(), g3 = await read(); if (g2 === g3 && g2 !== want) diffs.push(`HSQ ${side === 'hsq1' ? 'isolert' : 'uisolert'} flenskant, ${d} mm, ${rho} kg/m³, ${T} °C: Isover ${g2}, appen ${want}`); }
            stats.hsq++;
        }
        await p.close();
    } finally {
        await browser.close();
    }
    return { diffs, stats };
}

(async () => {
    const date = new Date().toISOString().slice(0, 10).split('-').reverse().join('-');
    try {
        const res = await run(), stats = res.stats;
        const diffs = [...new Set(res.diffs)];   // samme punkt kan trekkes to ganger i utvalget
        const summary = `Sjekket ${date}: ${stats.lists} profilsider, ${stats.apv} Ap/V-verdier, ${stats.thickness} tykkelsesgrenser, ${stats.hsq} HSQ-kombinasjoner.`;
        if (!diffs.length) { console.log('Ingen endring hos Isover FireProtect Calc.\n\n' + summary); process.exit(0); }
        console.log('## Isover FireProtect Calc er endret\n\nTallene på fireprotect.isover.se stemmer ikke lenger med appen (Verktøy → Brannisolering stål). ' +
            'Ta det opp med Claude: tabellene må hentes på nytt (se `tools/fireprotect/README.md`).\n\n### Avvik\n\n' +
            diffs.map(d => '- ' + d).join('\n') + '\n\n' + summary);
        process.exit(1);
    } catch (e) {
        console.log('## Sjekken av Isover FireProtect Calc kunne ikke kjøres\n\n' +
            (e instanceof BlockedError ? 'Isover-siden blokkerte den automatiske nettleseren (botvern). ' : 'Noe gikk galt under sjekken. ') +
            'Dette betyr IKKE at tabellen er endret — bare at den ikke ble sjekket denne gangen.\n\n```\n' + String(e && e.stack || e).slice(0, 1500) + '\n```');
        process.exit(2);
    }
})();
