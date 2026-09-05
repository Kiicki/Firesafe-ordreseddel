const STORAGE_KEY = 'firesafe_ordresedler';
const ARCHIVE_KEY = 'firesafe_arkiv';
const TEMPLATE_KEY = 'firesafe_maler';
const SETTINGS_KEY = 'firesafe_settings';
const DEFAULTS_KEY = 'firesafe_defaults';
const MATERIALS_KEY = 'firesafe_materials';
const REQUIRED_KEY = 'firesafe_required';
const PLANS_KEY = 'firesafe_plans';
const SERVICE_DEFAULTS_KEY = 'firesafe_defaults_service';
const SERVICE_STORAGE_KEY = 'firesafe_service';
const SERVICE_ARCHIVE_KEY = 'firesafe_service_arkiv';
const BIL_STORAGE_KEY = 'firesafe_bil_pafylling';
const KAPPE_STORAGE_KEY = 'firesafe_kappe';
const KAPPE_ARCHIVE_KEY = 'firesafe_kappe_arkiv';
const KAPPE_DEFAULTS_KEY = 'firesafe_defaults_kappe';
const KAPPE_CATALOG_KEY = 'firesafe_kappe_catalog';
const KAPPE_PRODUCTS_KEY = 'firesafe_kappe_products';
const KAPPE_STIFT_SIZES_KEY = 'firesafe_kappe_stift_sizes';
const KAPPE_DEFAULT_PRODUCTS = [
    { name: 'Fireprotect', type: 'isolasjon', units: ['meter', 'pakker'], defaultUnit: 'meter', usesDimensions: true }
];
const KAPPE_DEFAULT_STIFT_SIZES = ['22mm', '27mm', '32mm', '42mm', '52mm'];
const KAPPE_DEFAULT_DIMENSIONS = ['25mm', '40mm', '60mm'];
const KAPPE_DEFAULT_FASTENER_UNIT = 'stk';
const KAPPE_DEFAULT_ISOLATION_UNIT = 'meter';
const KAPPE_KERF_KEY = 'firesafe_kappe_kerf';
const KAPPE_DEFAULT_KERF = 2;
const KAPPE_PLATE_KEY = 'firesafe_kappe_plate';
const KAPPE_DEFAULT_PLATE = { lengde: 1200, bredde: 1000 };
const LEVERINGSADRESSE_KEY = 'firesafe_leveringsadresser';
// ─── Timebok ────────────────────────────────────────────────────────────────
const TIMEBOK_STORAGE_KEY = 'firesafe_timebok';              // array av dag-docs (cache, 50-vindu)
const TIMEBOK_SETTINGS_KEY = 'firesafe_timebok_settings';   // { timesats }
const TIMEBOK_TIMETYPES_KEY = 'firesafe_timebok_timetypes'; // { list }
const TIMEBOK_BRACKETS_KEY = 'firesafe_timebok_brackets';   // { list }
const TIMEBOK_PROJECTS_KEY = 'firesafe_timebok_projects';   // { list }
// Forhåndsfylte tidstyper (blanke satser — fylles fra tariff senere). Tillegg/
// oppmøte ligger KUN i brackets (under) for å unngå dobbelttelling.
const TIMEBOK_DEFAULT_TIMETYPES = [
    { id: 'tt_ordinaer', label: 'Ordinær', kind: 'ordinary', rate: null, multiplier: null },
    { id: 'tt_overtid50', label: 'Overtid 50%', kind: 'overtime', rate: null, multiplier: 1.5 },
    { id: 'tt_overtid100', label: 'Overtid 100%', kind: 'overtime', rate: null, multiplier: 2 },
    { id: 'tt_reisetid', label: 'Reisetid', kind: 'travel', rate: null, multiplier: null },
    { id: 'tt_km', label: 'Km-godtgjørelse', kind: 'km', rate: null, multiplier: null }
];
// Avstands-brackets for reisegodtgjørelse (oppmøtetillegg). Sats per dag/prosjekt.
const TIMEBOK_DEFAULT_BRACKETS = [
    { id: 'br_0715', label: '7,5–15 km', rate: null },
    { id: 'br_1530', label: '15–30 km', rate: null },
    { id: 'br_3045', label: '30–45 km', rate: null },
    { id: 'br_4560', label: '45–60 km', rate: null },
    { id: 'br_6075', label: '60–75 km', rate: null }
];
const MIN_INFO_KEY = 'firesafe_min_info';
const KOLLEGER_KEY = 'firesafe_kolleger';        // { list: [{id, navn}] }
const MIN_INFO_FIELDS = ['montor', 'avdeling', 'mobil', 'epost', 'sted'];
const MIN_INFO_TOGGLES = ['montor', 'avdeling', 'mobil', 'epost', 'sted', 'uke', 'dato'];

// Single lager-objekt (én lager-adresse)
function getLager() {
    try {
        var raw = localStorage.getItem(LEVERINGSADRESSE_KEY);
        if (!raw) return null;
        var data = JSON.parse(raw);
        // Migrer fra gammelt array-format hvis aktuelt
        if (Array.isArray(data)) {
            if (!data.length) return null;
            var first = data[0];
            return { veiadresse: first.veiadresse || '', postnr: first.postnr || '', poststed: first.poststed || '' };
        }
        return data;
    } catch (e) { return null; }
}

// Skriver bare til localStorage — kallere som ønsker Firebase-sync må selv kalle
// enqueueUserDocSet('settings', 'lager', ...). Brukes fra Firebase-fetch-pathen
// (cache-tilbakeskriving) og fra _saveLagerInline (som håndterer Firebase separat).
function _saveLagerLocalOnly(obj) {
    try { localStorage.setItem(LEVERINGSADRESSE_KEY, JSON.stringify(obj || null)); } catch (e) {}
}

// ─── Locale-aware number helpers ────────────────────────────────────────────
// Brukerinputs kan ha både komma og punktum som desimalskilletegn —
// JavaScripts parseFloat krever punktum. Disse hjelperne normaliserer.
function parseLocaleNum(v) {
    if (v == null || v === '') return NaN;
    return parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
}

// Formatter et tall til norsk visning (komma som desimalskilletegn).
// decimals=null gir ingen avkorting, decimals=N gir maks N desimaler men trimmer trailing nuller.
function formatLocaleNum(n, decimals) {
    if (n == null || (typeof n === 'number' && isNaN(n))) return '';
    var num = (typeof n === 'number') ? n : parseFloat(n);
    if (isNaN(num)) return '';
    var s;
    if (decimals == null) {
        s = String(num);
    } else {
        s = num.toFixed(decimals);
        // Trim trailing nuller etter desimaltegn (7.40 → 7.4, 7.00 → 7)
        if (s.indexOf('.') >= 0) {
            s = s.replace(/0+$/, '').replace(/\.$/, '');
        }
    }
    return s.replace('.', ',');
}

// ─── Timebok: gettere (cache-først) ─────────────────────────────────────────
function getTimebokTimesats() {
    var d = safeParseJSON(TIMEBOK_SETTINGS_KEY, null);
    var v = d && d.timesats != null ? parseLocaleNum(d.timesats) : NaN;
    return isNaN(v) ? null : v;
}
function getTimebokTimeTypes() {
    var d = safeParseJSON(TIMEBOK_TIMETYPES_KEY, null);
    if (d && Array.isArray(d.list) && d.list.length) return d.list;
    return TIMEBOK_DEFAULT_TIMETYPES.map(function (t) { return Object.assign({}, t); });
}
function getTimebokBrackets() {
    var d = safeParseJSON(TIMEBOK_BRACKETS_KEY, null);
    if (d && Array.isArray(d.list) && d.list.length) return d.list;
    return TIMEBOK_DEFAULT_BRACKETS.map(function (b) { return Object.assign({}, b); });
}
function getTimebokProjects() {
    var d = safeParseJSON(TIMEBOK_PROJECTS_KEY, null);
    return d && Array.isArray(d.list) ? d.list : [];
}

// ─── Timebok: oppslag ───────────────────────────────────────────────────────
function _timebokTypeById(id) {
    if (!id) return null;
    var list = getTimebokTimeTypes();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
}
function _timebokBracketById(id) {
    if (!id) return null;
    var list = getTimebokBrackets();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
}
function _timebokProject(line) {
    // Match på projectId først (stabil), deretter navn (historiske linjer).
    var list = getTimebokProjects();
    var i;
    if (line && line.projectId) for (i = 0; i < list.length; i++) if (list[i].id === line.projectId) return list[i];
    var nm = (line && line.project ? String(line.project) : '').toLowerCase();
    if (nm) for (i = 0; i < list.length; i++) if (String(list[i].name || '').toLowerCase() === nm) return list[i];
    return null;
}

// ─── Timebok: beregninger (null = ikke beregnbart → vis «—») ─────────────────
// Effektiv kr/time for en linje sin tidstype. timesats kan være null.
function _timebokEffectiveRate(type, timesats) {
    if (!type) return null;
    switch (type.kind) {
        case 'ordinary': return timesats;
        case 'overtime':
            if (type.rate != null) return type.rate;
            if (timesats != null && type.multiplier != null) return timesats * type.multiplier;
            return null;
        case 'travel': return type.rate != null ? type.rate : timesats;
        case 'km': return type.rate;          // kr/km; «hours»-feltet tolkes som km
        case 'supplement': return type.rate;
        case 'absence': return null;
        default: return type.rate != null ? type.rate : timesats;
    }
}
function _timebokLineWage(line, timesats) {
    if (!line) return null;
    var type = _timebokTypeById(line.timeType);
    var r = _timebokEffectiveRate(type, timesats);
    var h = parseLocaleNum(line.hours);
    if (r == null || isNaN(h)) return null;
    return r * h;
}
// Normaliser en dag-doc til flat liste pseudo-linjer for time/lønn-math.
// Ny modell: projects[].codes[] (kode = {typeId, hours}). Eldre modell: lines[].
function _timebokDayLines(dayDoc) {
    if (!dayDoc) return [];
    if (Array.isArray(dayDoc.projects)) {
        var out = [];
        dayDoc.projects.forEach(function (p) {
            (p.codes || []).forEach(function (c) {
                out.push({ projectId: p.projectId || '', project: p.name || '', timeType: c.typeId, hours: c.hours });
            });
        });
        return out;
    }
    return dayDoc.lines || [];
}
function _timebokDayWage(dayDoc, timesats) {
    var total = 0, any = false;
    _timebokDayLines(dayDoc).forEach(function (l) {
        var w = _timebokLineWage(l, timesats);
        if (w != null) { total += w; any = true; }
    });
    return any ? total : null;
}
// Sum timer (ekskl. km-type — der er «hours» en distanse, ikke timer).
function _timebokDayHours(dayDoc) {
    var total = 0;
    _timebokDayLines(dayDoc).forEach(function (l) {
        var type = _timebokTypeById(l.timeType);
        if (type && type.kind === 'km') return;
        var h = parseLocaleNum(l.hours);
        if (!isNaN(h)) total += h;
    });
    return total;
}
// Reisegodtgjørelse for en dag: ÉN gang per distinkt prosjekt med data.
function _timebokDayTravelComp(dayDoc) {
    var seen = {}, total = 0, any = false;
    _timebokDayLines(dayDoc).forEach(function (l) {
        var key = (l.projectId || l.project || '');
        if (!key || seen[key]) return;
        seen[key] = true;
        var proj = _timebokProject(l);
        var br = proj && proj.bracketId ? _timebokBracketById(proj.bracketId) : null;
        if (br && br.rate != null) { total += br.rate; any = true; }
    });
    return any ? total : null;
}
// Sum kvitteringer (utlegg) for en dag.
function _timebokDayReceipts(dayDoc) {
    if (!dayDoc || !Array.isArray(dayDoc.receipts) || !dayDoc.receipts.length) return null;
    var total = 0, any = false;
    dayDoc.receipts.forEach(function (r) {
        var a = parseLocaleNum(r.amount);
        if (!isNaN(a)) { total += a; any = true; }
    });
    return any ? total : null;
}
// Dagstotal (utbetaling): lønn + reise + kvitteringer.
function _timebokDayTotal(dayDoc, timesats) {
    var w = _timebokDayWage(dayDoc, timesats);
    var tr = _timebokDayTravelComp(dayDoc);
    var rc = _timebokDayReceipts(dayDoc);
    if (w == null && tr == null && rc == null) return null;
    return (w || 0) + (tr || 0) + (rc || 0);
}
// Har dagen noen registrering (linjer eller kvitteringer)?
function _timebokDayHasData(dayDoc) {
    return _timebokDayLines(dayDoc).length > 0 ||
        (dayDoc && Array.isArray(dayDoc.receipts) && dayDoc.receipts.length > 0);
}
// Periode-aggregat over flere dag-docs.
function _timebokPeriodSummary(dayDocs) {
    var timesats = getTimebokTimesats();
    var hours = 0, wage = 0, travel = 0, receipts = 0, days = 0;
    var anyW = false, anyT = false, anyR = false;
    (dayDocs || []).forEach(function (d) {
        if (_timebokDayHasData(d)) days++;
        hours += _timebokDayHours(d);
        var w = _timebokDayWage(d, timesats); if (w != null) { wage += w; anyW = true; }
        var t = _timebokDayTravelComp(d); if (t != null) { travel += t; anyT = true; }
        var r = _timebokDayReceipts(d); if (r != null) { receipts += r; anyR = true; }
    });
    var wageV = anyW ? wage : null, travelV = anyT ? travel : null, recV = anyR ? receipts : null;
    var total = (wageV == null && travelV == null && recV == null) ? null : (wage + travel + receipts);
    return { hours: hours, wage: wageV, travel: travelV, receipts: recV, total: total, days: days };
}

// ─── Timebok: dato-hjelpere ─────────────────────────────────────────────────
function _timebokPad2(n) { return (n < 10 ? '0' : '') + n; }
function _timebokDateId(dateObj) {
    var d = dateObj || new Date();
    return d.getFullYear() + '-' + _timebokPad2(d.getMonth() + 1) + '-' + _timebokPad2(d.getDate());
}
function _timebokTodayId() { return _timebokDateId(new Date()); }
function _timebokParseId(id) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(id || ''));
    if (!m) return null;
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}
// Visning: «Lør 14.06»
function _timebokFormatDateId(id) {
    var d = _timebokParseId(id);
    if (!d) return String(id || '');
    var dayNames = ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør'];
    return dayNames[d.getDay()] + ' ' + _timebokPad2(d.getDate()) + '.' + _timebokPad2(d.getMonth() + 1);
}
var _TIMEBOK_WEEKDAYS_FULL = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
var _TIMEBOK_MONTHS_FULL = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
var _TIMEBOK_MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
// Kort dato fra Date-objekt: «29. jun»
function _timebokShortDate(dateObj) {
    if (!dateObj) return '';
    return dateObj.getDate() + '. ' + _TIMEBOK_MONTHS_SHORT[dateObj.getMonth()];
}
// Deler for dag-kort: { date:'29. juni', weekday:'Mandag', isWeekend, isToday }
function _timebokDayParts(id) {
    var d = _timebokParseId(id);
    if (!d) return { date: String(id || ''), weekday: '', isWeekend: false, isToday: false };
    var dow = d.getDay();
    return {
        date: d.getDate() + '. ' + _TIMEBOK_MONTHS_FULL[d.getMonth()],
        weekday: _TIMEBOK_WEEKDAYS_FULL[dow],
        isWeekend: (dow === 0 || dow === 6),
        isToday: (id === _timebokTodayId())
    };
}

// Strip eventuell etternavn fra en montør-streng. Etternavn er placeholder for fremtiden
// og skal aldri vises i UI eller eksport. Bruk denne overalt der montør hentes/settes.
function stripEtternavn(montorVal) {
    if (!montorVal) return '';
    return String(montorVal).trim().split(/\s+/)[0] || '';
}

// ── Kolleger ────────────────────────────────────────────────────────────────
// Navnene du kan føre timer på ved siden av deg selv. Forvaltes i
// Innstillinger → Prosjekter & lager, og synkes til Firebase som alle andre
// brukerdata, så samme liste finnes på telefon, nettbrett og PC.
function getKolleger() {
    var d = safeParseJSON(KOLLEGER_KEY, null);
    return (d && Array.isArray(d.list)) ? d.list : [];
}

// Navnet mitt slik det skal stå på timene. Montør-feltet i det ÅPNE skjemaet er
// fasit — det er navnet som allerede står på dokumentet — med Min info som
// reserve når feltet ikke er fylt ut ennå.
function currentFormMontorName() {
    var el = document.getElementById('mobile-montor');
    var v = el ? String(el.value || '').trim() : '';
    if (!v) {
        el = document.getElementById('montor');
        v = el ? String(el.value || '').trim() : '';
    }
    if (!v) {
        var info = (typeof getMinInfo === 'function') ? getMinInfo() : {};
        v = info.montor || '';
    }
    return stripEtternavn(v);
}

function getMinInfo() {
    var info = {};
    try {
        var raw = localStorage.getItem(MIN_INFO_KEY);
        if (raw) info = JSON.parse(raw) || {};
    } catch (e) {}
    // Montør skal alltid være fornavn (uten etternavn) ved henting
    if (info.fornavn !== undefined && info.fornavn !== '') {
        info.montor = String(info.fornavn).trim();
    } else if (info.montor) {
        info.montor = stripEtternavn(info.montor);
    }
    return info;
}

function _migrateMinInfo() {
    if (localStorage.getItem(MIN_INFO_KEY)) return;
    var own = {};
    var svc = {};
    var kappe = {};
    try { own = JSON.parse(localStorage.getItem(DEFAULTS_KEY) || '{}'); } catch (e) {}
    try { svc = JSON.parse(localStorage.getItem(SERVICE_DEFAULTS_KEY) || '{}'); } catch (e) {}
    try { kappe = JSON.parse(localStorage.getItem(KAPPE_DEFAULTS_KEY) || '{}'); } catch (e) {}
    var merged = {
        montor: own.montor || svc.montor || kappe.bestiller || '',
        avdeling: own.avdeling || kappe.avdeling || '',
        mobil: '',
        epost: '',
        sted: own.sted || ''
    };
    MIN_INFO_TOGGLES.forEach(function(k) {
        var key = 'autofill_' + k;
        var val = own[key];
        if (val === undefined) val = svc[key];
        if (val === undefined) val = kappe[key];
        if (val !== undefined) merged[key] = val;
    });
    try { localStorage.setItem(MIN_INFO_KEY, JSON.stringify(merged)); } catch (e) {}
}

_migrateMinInfo();

function _normalizeKappeDimension(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    return text.replace(/\s*mm$/i, '');
}

function _normalizeKappeCatalogProduct(product) {
    if (!product) return null;
    var name = String(product.name || '').trim();
    if (!name) return null;
    var type = product.type === 'festemiddel' ? 'festemiddel' : 'isolasjon';
    var units = Array.isArray(product.units) ? product.units : [];
    var seen = {};
    units = units.map(function(unit) { return String(unit || '').trim(); }).filter(function(unit) {
        var key = unit.toLowerCase();
        if (!key || seen[key]) return false;
        seen[key] = true;
        return true;
    });
    var defaultUnit = String(product.defaultUnit || '').trim();
    if (!units.length || !units.some(function(unit) { return unit.toLowerCase() === defaultUnit.toLowerCase(); })) {
        defaultUnit = units.length ? units[0] : '';
    }
    return {
        name: name,
        type: type,
        units: units,
        defaultUnit: defaultUnit,
        usesDimensions: product.usesDimensions !== false
    };
}

function _dedupeKappeDimensions(values) {
    var seen = {};
    var result = [];
    (values || []).forEach(function(value) {
        var dim = _normalizeKappeDimension(value);
        if (!dim) return;
        var key = dim.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        result.push(dim);
    });
    _sortKappeMaterialSizes(result);
    return result;
}

function _normalizeKappePlate(plate) {
    if (!plate) return null;
    var L = parseFloat(String(plate.length || plate.lengde || '').replace(',', '.'));
    var W = parseFloat(String(plate.width || plate.bredde || '').replace(',', '.'));
    if (!L || L <= 0 || !W || W <= 0) return null;
    var pn = Array.isArray(plate.productNames) ? plate.productNames : [];
    var seen = {};
    pn = pn.map(function(n) { return String(n || '').trim(); }).filter(function(n) {
        if (!n) return false;
        var k = n.toLowerCase();
        if (seen[k]) return false;
        seen[k] = true;
        return true;
    });
    return { length: L, width: W, productNames: pn };
}

function _buildKappeCatalog(products, dimensions, plates) {
    var seenProducts = {};
    var normalizedProducts = [];
    (products || []).forEach(function(product) {
        var normalized = _normalizeKappeCatalogProduct(product);
        if (!normalized) return;
        var key = normalized.name.toLowerCase();
        if (seenProducts[key]) return;
        seenProducts[key] = true;
        normalizedProducts.push(normalized);
    });
    if (!normalizedProducts.length) normalizedProducts = KAPPE_DEFAULT_PRODUCTS.map(_normalizeKappeCatalogProduct).filter(Boolean);
    normalizedProducts.sort(function(a, b) {
        if (a.type !== b.type) return a.type === 'isolasjon' ? -1 : 1;
        return a.name.localeCompare(b.name, 'no');
    });
    // Plate-register: hver plate har dimensjoner + tilknyttede produkter.
    // Første plate fungerer som fallback for uassignede produkter.
    var normalizedPlates = [];
    (plates || []).forEach(function(p) {
        var np = _normalizeKappePlate(p);
        if (np) normalizedPlates.push(np);
    });
    // Sørg for minst én default-plate (migrer fra global getKappePlate hvis ingen finnes).
    if (!normalizedPlates.length) {
        var defaultGP = (typeof getKappePlate === 'function') ? getKappePlate() : { lengde: 1200, bredde: 1000 };
        normalizedPlates.push({ length: defaultGP.lengde, width: defaultGP.bredde, productNames: [] });
    }
    // Sikre at hvert produkt kun finnes i én plate sin productNames (siste-skriver vinner).
    var assigned = {};
    for (var i = normalizedPlates.length - 1; i >= 0; i--) {
        normalizedPlates[i].productNames = normalizedPlates[i].productNames.filter(function(n) {
            var k = n.toLowerCase();
            if (assigned[k]) return false;
            assigned[k] = true;
            return true;
        });
    }
    return {
        products: normalizedProducts,
        dimensions: _dedupeKappeDimensions(dimensions),
        plates: normalizedPlates
    };
}

function _readLegacyKappeProductsRaw() {
    try {
        var raw = localStorage.getItem(KAPPE_PRODUCTS_KEY);
        if (!raw) return { products: KAPPE_DEFAULT_PRODUCTS.slice(), dimensions: KAPPE_DEFAULT_DIMENSIONS.slice() };
        var parsed = JSON.parse(raw);
        if (!parsed) return { products: KAPPE_DEFAULT_PRODUCTS.slice(), dimensions: KAPPE_DEFAULT_DIMENSIONS.slice() };

        var products = Array.isArray(parsed.products) ? parsed.products : [];
        var dimensions = Array.isArray(parsed.dimensions) ? parsed.dimensions.slice() : [];

        // Migrasjon 1: eldre format med "Brand 25mm" som ett produkt → split til merke + dim
        if (products.length && typeof products[0] === 'object' && !products[0].hasOwnProperty('dimensions') && !dimensions.length) {
            // Allerede i nytt format (objekt med kun name) — ingen dimensjon å hente. La være.
        } else if (products.length && (typeof products[0] === 'string' || (products[0].name && /\d+(?:\.\d+)?mm$/i.test(products[0].name) && !products[0].dimensions))) {
            // Gammelt streng-format eller "Brand Xmm" navn — split
            var migrated = _migrateOldKappeProducts(products);
            products = migrated.products;
            dimensions = migrated.dimensions;
            try { localStorage.setItem(KAPPE_PRODUCTS_KEY, JSON.stringify({ products: products, dimensions: dimensions })); } catch (e) {}
        } else if (products.length && products[0].hasOwnProperty('dimensions')) {
            // Mellomformat: hver brand har egen dimensions-array → samle til global
            var allDims = {};
            var simpleBrands = products.map(function(p) {
                (p.dimensions || []).forEach(function(d) { allDims[d] = true; });
                return { name: p.name };
            });
            products = simpleBrands;
            // Slå sammen med eventuelt eksisterende global dimensions
            dimensions.forEach(function(d) { allDims[d] = true; });
            dimensions = Object.keys(allDims);
            try { localStorage.setItem(KAPPE_PRODUCTS_KEY, JSON.stringify({ products: products, dimensions: dimensions })); } catch (e) {}
        }

        if (!products.length) products = KAPPE_DEFAULT_PRODUCTS.slice();
        return { products: products, dimensions: dimensions };
    } catch (e) {
        return { products: KAPPE_DEFAULT_PRODUCTS.slice(), dimensions: KAPPE_DEFAULT_DIMENSIONS.slice() };
    }
}

function _readLegacyKappeStiftSizes() {
    try {
        var raw = localStorage.getItem(KAPPE_STIFT_SIZES_KEY);
        if (!raw) return KAPPE_DEFAULT_STIFT_SIZES.slice();
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.sizes) && parsed.sizes.length) return parsed.sizes;
    } catch (e) {}
    return KAPPE_DEFAULT_STIFT_SIZES.slice();
}

function _migrateKappeCatalog() {
    var legacy = _readLegacyKappeProductsRaw();
    var products = (legacy.products || []).map(function(product) {
        return _normalizeKappeCatalogProduct({
            name: product && product.name ? product.name : product,
            type: 'isolasjon',
            units: [],
            defaultUnit: '',
            usesDimensions: true
        });
    }).filter(Boolean);
    if (!products.some(function(product) { return product.name.toLowerCase() === 'stift'; })) {
        products.push({
            name: 'Stift',
            type: 'festemiddel',
            units: [],
            defaultUnit: '',
            usesDimensions: true
        });
    }
    var dimensions = (legacy.dimensions || []).concat(_readLegacyKappeStiftSizes());
    if (!dimensions.length) dimensions = KAPPE_DEFAULT_DIMENSIONS.concat(KAPPE_DEFAULT_STIFT_SIZES);
    // Plate-register: start med global default-plate som første entry (uten tilknyttede produkter).
    return _buildKappeCatalog(products, dimensions, []);
}

function getKappeCatalog() {
    try {
        var raw = localStorage.getItem(KAPPE_CATALOG_KEY);
        if (raw) {
            var parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.products)) {
                // Slå sammen eventuell tidligere fastenerDimensions-liste tilbake til
                // en felles dim-liste. _dedupeKappeDimensions sorterer og fjerner duplikater.
                var combined = (parsed.dimensions || []).concat(parsed.fastenerDimensions || []);
                return _buildKappeCatalog(parsed.products, combined, parsed.plates || []);
            }
        }
    } catch (e) {}
    var migrated = _migrateKappeCatalog();
    try { localStorage.setItem(KAPPE_CATALOG_KEY, JSON.stringify(migrated)); } catch (e) {}
    return migrated;
}

// Slår opp plate-størrelse for et gitt produkt. Returnerer { length, width } som strenger.
// Plate tildelt eksplisitt → bruk den. Ellers → første plate i registeret (fallback).
function getKappePlateForProduct(productName) {
    var catalog = getKappeCatalog();
    var plates = catalog.plates || [];
    var lookup = String(productName || '').toLowerCase();
    if (lookup) {
        for (var i = 0; i < plates.length; i++) {
            var pn = plates[i].productNames || [];
            for (var j = 0; j < pn.length; j++) {
                if (String(pn[j]).toLowerCase() === lookup) {
                    return { length: String(plates[i].length), width: String(plates[i].width) };
                }
            }
        }
    }
    // Fallback: første plate i registeret (default)
    if (plates.length) {
        return { length: String(plates[0].length), width: String(plates[0].width) };
    }
    var gp = (typeof getKappePlate === 'function') ? getKappePlate() : { lengde: 1200, bredde: 1000 };
    return { length: String(gp.lengde), width: String(gp.bredde) };
}

function getKappeCatalogProducts(type) {
    var products = getKappeCatalog().products || [];
    if (!type) return products;
    return products.filter(function(product) { return product.type === type; });
}

function getKappeCatalogProduct(name) {
    var lookup = String(name || '').trim().toLowerCase();
    if (!lookup) return null;
    return getKappeCatalogProducts().find(function(product) {
        return product.name.toLowerCase() === lookup;
    }) || null;
}

function getKappeProducts() {
    return getKappeCatalogProducts('isolasjon').map(function(product) {
        return { name: product.name, type: product.type, units: product.units, defaultUnit: product.defaultUnit, usesDimensions: product.usesDimensions };
    });
}

function getKappeFastenerProducts() {
    return getKappeCatalogProducts('festemiddel').map(function(product) {
        return { name: product.name, type: product.type, units: product.units, defaultUnit: product.defaultUnit, usesDimensions: product.usesDimensions };
    });
}

function getKappeDimensions() {
    return getKappeCatalog().dimensions;
}

// Beholdt som semantisk alias — peker til samme felles dim-liste.
// Brukes som indikasjon på at picker forventer festemiddel-lengder (vs iso-tykkelser).
function getKappeFastenerDimensions() {
    return getKappeDimensions();
}

function _migrateOldKappeProducts(oldProducts) {
    var brandMap = {};
    var brandOrder = [];
    var allDims = {};
    oldProducts.forEach(function(p) {
        var name = (typeof p === 'string') ? p : (p && p.name) || '';
        if (!name) return;
        var match = name.match(/^(.+?)\s+(\d+(?:\.\d+)?)mm$/i);
        if (match) {
            var brand = match[1].trim();
            var dim = match[2];
            if (!brandMap[brand]) {
                brandMap[brand] = { name: brand };
                brandOrder.push(brand);
            }
            allDims[dim] = true;
        } else {
            if (!brandMap[name]) {
                brandMap[name] = { name: name };
                brandOrder.push(name);
            }
        }
    });
    var products = brandOrder.map(function(n) { return brandMap[n]; });
    return { products: products, dimensions: Object.keys(allDims) };
}

function getKappeKerf() {
    try {
        var raw = localStorage.getItem(KAPPE_KERF_KEY);
        if (!raw) return KAPPE_DEFAULT_KERF;
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed.kerf === 'number') return parsed.kerf;
        return KAPPE_DEFAULT_KERF;
    } catch (e) {
        return KAPPE_DEFAULT_KERF;
    }
}

function getKappePlate() {
    try {
        var raw = localStorage.getItem(KAPPE_PLATE_KEY);
        if (!raw) return { lengde: KAPPE_DEFAULT_PLATE.lengde, bredde: KAPPE_DEFAULT_PLATE.bredde };
        var parsed = JSON.parse(raw);
        var l = parsed && typeof parsed.lengde === 'number' && parsed.lengde > 0 ? parsed.lengde : KAPPE_DEFAULT_PLATE.lengde;
        var b = parsed && typeof parsed.bredde === 'number' && parsed.bredde > 0 ? parsed.bredde : KAPPE_DEFAULT_PLATE.bredde;
        return { lengde: l, bredde: b };
    } catch (e) {
        return { lengde: KAPPE_DEFAULT_PLATE.lengde, bredde: KAPPE_DEFAULT_PLATE.bredde };
    }
}

function getKappeStiftSizes() {
    return getKappeFastenerDimensions();
}

function _formatKappeMaterialSize(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    return /mm$/i.test(text) ? text.replace(/\s*mm$/i, 'mm') : text + 'mm';
}

function _sortKappeMaterialSizes(values) {
    values.sort(function(a, b) {
        var na = parseFloat(String(a).replace(',', '.'));
        var nb = parseFloat(String(b).replace(',', '.'));
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return String(a).localeCompare(String(b), 'no');
    });
}

function _getUniqueKappeMaterialSizes(values) {
    var seen = {};
    var result = [];
    (values || []).forEach(function(value) {
        var label = _formatKappeMaterialSize(value);
        if (!label) return;
        var key = label.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        result.push(label);
    });
    _sortKappeMaterialSizes(result);
    return result;
}

const MATERIAL_KAPPE_LAUNCHER = '__kappe_materialer';
const MATERIAL_ISOLATION_LAUNCHER = '__kappe_isolasjon';
const MATERIAL_FESTEMIDDEL_LAUNCHER = '__kappe_festemiddel';
const MATERIAL_STIFT_LAUNCHER = 'Stift';

function getMaterialKappeLabel() {
    return typeof t === 'function' ? t('material_kappe') : 'Isolering';
}

function getMaterialIsolationLabel() {
    return typeof t === 'function' ? t('material_isolation') : 'Isolasjon';
}

function getMaterialStiftLabel() {
    return typeof t === 'function' ? t('kappe_section_staples') : 'Stift';
}

function getKappeFastenerLabel() {
    return typeof t === 'function' ? t('kappe_section_fasteners') : 'Festemidler';
}

function _stripPickerSuffix(name) {
    return String(name || '').replace(/__(\d+|meter|eske)$/i, '');
}

function _getKappeProductName(name) {
    var lookup = _stripPickerSuffix(name).toLowerCase();
    if (!lookup || lookup === MATERIAL_KAPPE_LAUNCHER || lookup === MATERIAL_ISOLATION_LAUNCHER) return '';
    var product = getKappeProducts().find(function(p) {
        return p && p.name && p.name.toLowerCase() === lookup;
    });
    return product ? product.name : '';
}

function isKappeIsolationMaterial(name, source) {
    if (source === 'kappe-products') return true;
    return !!_getKappeProductName(name);
}

function isKappeStiftMaterial(name, source, enhet) {
    if (source === 'kappe-stift' || source === 'kappe-fastener') return true;
    var lookup = _stripPickerSuffix(name).toLowerCase();
    var isFastenerProduct = getKappeFastenerProducts().some(function(product) {
        return product.name.toLowerCase() === lookup;
    });
    if (!isFastenerProduct && lookup !== MATERIAL_STIFT_LAUNCHER.toLowerCase()) return false;
    if (hasConfiguredMaterialName(name)) return false;
    if (!enhet) return true;
    var size = _formatKappeMaterialSize(enhet);
    return getKappeFastenerDimensions().some(function(s) {
        return _formatKappeMaterialSize(s).toLowerCase() === size.toLowerCase();
    });
}

function hasConfiguredMaterialName(name) {
    var lookup = _stripPickerSuffix(name).toLowerCase();
    if (!lookup || !cachedMaterialOptions) return false;
    return cachedMaterialOptions.some(function(material) {
        return material && material.name && material.name.toLowerCase() === lookup;
    });
}

function shouldGroupAsKappeIsolation(material) {
    if (!material || !material.name) return false;
    if (material.source === 'kappe-products') return true;
    return isKappeIsolationMaterial(material.name, material.source) && !hasConfiguredMaterialName(material.name);
}

function shouldGroupAsKappeStift(material) {
    if (!material || !material.name) return false;
    return isKappeStiftMaterial(material.name, material.source, material.enhet);
}

function formatKappeIsolationName(name, enhet, bredde, specMode) {
    var productName = _getKappeProductName(name) || _stripPickerSuffix(name);
    var dim = _formatKappeMaterialSize(enhet || '');
    // Kun produkt + tykkelse. Bredde/plate er kun input til plate-
    // kalkulasjon — irrelevant visuelt her (antall-kolonnen viser "X plater").
    return dim ? productName + ' ' + dim : productName;
}

function _ceilToHalf(value) {
    return Math.ceil(value * 2) / 2;
}

function calcKappePlateCount(material) {
    if (!material) return 0;
    var antall = parseFloat(String(material.antall || '0').replace(',', '.'));
    if (!antall || antall <= 0) return 0;
    if (material.specMode === 'plate') return _ceilToHalf(antall);
    if (material.specMode !== 'bredde') return 0;
    if (!material.bredde || !material.plate) return 0;
    var bredde = String(material.bredde).replace(/mm$/i, '');
    var pL = parseFloat(String(material.plate.length || '').replace(',', '.'));
    var pW = parseFloat(String(material.plate.width || '').replace(',', '.'));
    if (!pL || !pW) return 0;
    if (typeof _calcKappeWN630 !== 'function') return 0;
    var wn = _calcKappeWN630(bredde, antall, '1', pL, pW, getKappeKerf(), '1', '1');
    if (!wn || !wn.langs || !wn.langs.length) return 0;
    // Bruk RÅ flyttall (antall meter / meter per plate) i stedet for antallStk/stripes,
    // siden antallStk allerede er ceil'd. Det vil ellers gi heltall og miste halv-plate.
    // Behold orienteringen (stripLengdeMm) så bruker kan velge kappe-retning.
    var perOrient = wn.langs.map(function(o) {
        if (!o.stripes || o.stripes < 1 || !o.stripLengde) return null;
        var metersPerPlate = o.stripes * o.stripLengde;
        return metersPerPlate > 0
            ? { slm: o.stripLengdeMm, plates: antall / metersPerPlate }
            : null;
    }).filter(function(x) { return x && x.plates > 0; });
    if (!perOrient.length) return 0;
    var orient = String(material.kappeOrient || '').trim();
    // 'L' = strimler langs platelengden, 'W' = langs platebredden.
    if (orient === 'L' || orient === 'W') {
        var wantSlm = (orient === 'L') ? pL : pW;
        var hit = null;
        for (var i = 0; i < perOrient.length; i++) {
            if (Math.abs(perOrient[i].slm - wantSlm) < 0.5) { hit = perOrient[i]; break; }
        }
        if (hit) return _ceilToHalf(hit.plates);
    }
    // Default 'auto': konservativ — retningen som krever flest plater (mest
    // svinn). Beskytter mot under-fakturering hvis montøren var mindre
    // effektiv enn optimalt.
    return _ceilToHalf(Math.max.apply(null, perOrient.map(function(x) { return x.plates; })));
}

// Begge kappe-retninger for UI: { auto, L:{slm,plates}, W:{slm,plates} }.
// L = strimler langs platelengden, W = langs platebredden. Brukes til å
// vise begge tall i Isolering-popupen så bruker kan velge retning per rad.
function calcKappePlateOrientations(material) {
    var res = { auto: 0, L: null, W: null };
    if (!material) return res;
    var antall = parseFloat(String(material.antall || '0').replace(',', '.'));
    if (!antall || antall <= 0) return res;
    if (material.specMode !== 'bredde' || !material.bredde || !material.plate) return res;
    var bredde = String(material.bredde).replace(/mm$/i, '');
    var pL = parseFloat(String(material.plate.length || '').replace(',', '.'));
    var pW = parseFloat(String(material.plate.width || '').replace(',', '.'));
    if (!pL || !pW || typeof _calcKappeWN630 !== 'function') return res;
    var wn = _calcKappeWN630(bredde, antall, '1', pL, pW, getKappeKerf(), '1', '1');
    if (!wn || !wn.langs || !wn.langs.length) return res;
    var all = [];
    wn.langs.forEach(function(o) {
        if (!o.stripes || o.stripes < 1 || !o.stripLengde) return;
        var mpp = o.stripes * o.stripLengde;
        if (mpp <= 0) return;
        var p = _ceilToHalf(antall / mpp);
        all.push(p);
        if (Math.abs(o.stripLengdeMm - pL) < 0.5) res.L = { slm: pL, plates: p };
        if (Math.abs(o.stripLengdeMm - pW) < 0.5) res.W = { slm: pW, plates: p };
    });
    if (all.length) res.auto = _ceilToHalf(Math.max.apply(null, wn.langs.map(function(o) {
        return (o.stripes >= 1 && o.stripLengde) ? antall / (o.stripes * o.stripLengde) : 0;
    })));
    return res;
}

// Formaterer plate-antall for visning: alltid én desimal for visuell konsistens
// med formatRunningMeters (stk/meter/eske). "4,0 plater", "4,5 plater", "0,5 plater".
function formatKappePlateCount(value) {
    return value.toFixed(1).replace('.', ',');
}

// Svinn-påslag på kappe-isolasjon i m² (ordreseddel/servicebil). 10% på toppen
// av plate-arealet — samme svinn-prinsipp som kappeskjemaets "Veil. m²"-kolonne.
var KAPPE_M2_SVINN_FACTOR = 1.10;

// Materialforbruk i m² for kappe-isolasjon: antall plater × plate-areal × svinn-påslag.
// Gjelder begge moduser (kapp/bredde og hele plater) siden begge sender plateCount hit.
// Plate-mål hentes fra produktets egen plate (material.plate), ellers standard 1200×1000.
function calcKappeAreaM2(material, plateCount) {
    if (!plateCount || plateCount <= 0) return 0;
    var pL = material && material.plate ? parseFloat(String(material.plate.length || '').replace(',', '.')) : 0;
    var pW = material && material.plate ? parseFloat(String(material.plate.width || '').replace(',', '.')) : 0;
    if (!pL || pL <= 0) pL = KAPPE_DEFAULT_PLATE.lengde;
    if (!pW || pW <= 0) pW = KAPPE_DEFAULT_PLATE.bredde;
    return plateCount * (pL * pW) / 1000000 * KAPPE_M2_SVINN_FACTOR;
}

// Formaterer m²-verdi: én desimal, norsk komma. "16,2".
function formatKappeArea(value) {
    return value.toFixed(1).replace('.', ',');
}

function formatKappeStiftName(enhet, name, quantityUnit) {
    var productName = _stripPickerSuffix(name || '') || getMaterialStiftLabel();
    var dim = _formatKappeMaterialSize(enhet || '');
    if (dim && productName.toLowerCase() === dim.toLowerCase()) {
        productName = getMaterialStiftLabel();
    }
    // quantityUnit tas bevisst IKKE i bruk til et navne-suffiks: eske/stk står i
    // Enhet-kolonnen, og et « eske» her ville gjort den cella dødvekt. Parameteren
    // beholdes i signaturen fordi kallerne sender den og den beskriver raden.
    return dim ? productName + ' ' + dim : productName;
}

function getKappeProductDefaultUnit(name) {
    var product = getKappeCatalogProduct(name);
    if (!product) return '';
    if (product.defaultUnit) return product.defaultUnit;
    return product.type === 'festemiddel' ? KAPPE_DEFAULT_FASTENER_UNIT : KAPPE_DEFAULT_ISOLATION_UNIT;
}

function getMaterialPickerOptions(baseMaterials) {
    var materials = Array.isArray(baseMaterials) ? baseMaterials.slice() : [];

    var derived = [];
    var hasKappeProducts = getKappeProducts().length > 0;
    var hasFasteners = getKappeFastenerProducts().length > 0 && getKappeFastenerDimensions().length > 0;
    // Isolering-launcher (isolasjonsprodukter).
    if (hasKappeProducts) {
        derived.push({
            name: MATERIAL_KAPPE_LAUNCHER,
            displayName: getMaterialIsolationLabel(),
            type: 'kappe-isolation',
            defaultUnit: '',
            allowedUnits: [],
            quantityUnit: 'meter',
            source: 'kappe-materials-launcher'
        });
    }
    // Egen Festemidler-launcher (festemiddel-produkter, uavhengig av isolasjon).
    if (hasFasteners) {
        derived.push({
            name: MATERIAL_STIFT_LAUNCHER,
            displayName: getKappeFastenerLabel(),
            type: 'kappe-stift',
            defaultUnit: 'stk',
            allowedUnits: [],
            quantityUnit: 'stk',
            source: 'kappe-stift-launcher'
        });
    }

    return materials.concat(derived);
}

function getMaterialPickerConfig(materialName) {
    var lookupName = _stripPickerSuffix(materialName).toLowerCase();
    if (!lookupName) return null;
    var baseMaterials = (typeof cachedMaterialOptions !== 'undefined' && cachedMaterialOptions) ? cachedMaterialOptions : [];
    var materialConfig = getMaterialPickerOptions(baseMaterials).find(function(material) {
        return material && material.name && material.name.toLowerCase() === lookupName;
    });
    if (materialConfig) return materialConfig;
    var productName = _getKappeProductName(lookupName);
    if (productName) return {
        name: productName,
        type: 'standard',
        quantityUnit: 'meter',
        source: 'kappe-products'
    };
    if (getKappeFastenerProducts().some(function(product) { return product.name.toLowerCase() === lookupName; }) && !hasConfiguredMaterialName(materialName) && getKappeFastenerDimensions().length) {
        return {
            name: _stripPickerSuffix(materialName),
            type: 'standard',
            quantityUnit: 'stk',
            source: lookupName === MATERIAL_STIFT_LAUNCHER.toLowerCase() ? 'kappe-stift' : 'kappe-fastener'
        };
    }
    return null;
}

// ── Kolonne-modellen: Beskrivelse / Antall / Enhet ───────────────────────────
// Tre kolonner, tre ansvar — gjelder ALLE flater (ordreseddel, PDF, ordrekort,
// servicebil, bil-historikk, materialvelger):
//   Beskrivelse = produktidentiteten = MÅLET, eller produktnavnet når mål mangler
//   Antall      = mengden
//   Enhet       = hva tallet faktisk teller (stk / eske / meter / m²)
//
// Enhets-kolonnen fortjener plassen sin KUN når den varierer og tilfører noe.
// Testen på hver rad er: tvinger beskrivelsen enheten? Gjør den det, er cella
// dødvekt. «Ø125mm eske · 2 · stk» besto ikke den testen — «stk» kunne ikke vært
// noe annet når beskrivelsen alt sa eske. Derfor bærer Enhet formen:
//   «Ø125mm · 2 · eske»   \u2014 to esker av det målet
//   «Ø125mm · 4 · stk»    \u2014 fire løse av samme mål; SKILLET ligger i Enhet,
//                            som er nøyaktig det kolonnen finnes for
//   «FSC · 3,0 · meter»   \u2014 tallet er en lengde, ikke et antall
//
// Rader uten mål viser PRODUKTNAVNET i Beskrivelse. Prøvd og forkastet underveis:
// en tankestrek (sa ingenting), og formordene «Løpende»/«Eske» der (flyttet
// enheten inn i Beskrivelse og gjorde Enhet-cella dødvekt på de radene).
// Kostnaden er at produktnavnet også står i gruppe-overskriften — bevisst valgt
// framfor en celle som ikke tilfører noe.
//
// GRENSE: standard-materialer med brukerdefinerte VARIANTER (FSA Patron, Pølse)
// legger fortsatt varianten i navnet og telles i stk. En variant er en egen vare,
// ikke en pakningsform — det systemet er urørt.
//
// ── RULL-produkter er et eget tilfelle ───────────────────────────────────────
// For et RULLPRODUKT (FSC, FSW — mansjett/brannpakning uten fixedSize) ER en
// dimensjonsrad en LENGDE: du kapper π×Ø×lag meter av rullen for hver mansjett.
// Slike rader viser derfor omregnet meter i Antall/Enhet, og beholder dimensjon
// + stykktall i BESKRIVELSEN:
//     Ø160mm (4 stk)  ·  2,1  ·  meter
// Da kan leseren se hvorfor gruppe-totalen blir som den blir — radene summerer
// seg eksakt til den, fordi meterTenths bruker samme opprunding som rad-visningen.
// FAST-STØRRELSE (Promastop FC6) er motsatt: der er dimensjon + stk hele saken,
// og det finnes ingen meter-total å forklare.

// Er raden en dimensjonsrad på et RULLPRODUKT? Returnerer omregningen, ellers null.
// Eske-rader gir null: en eske er ikke kappet av rullen, og holdes derfor også
// utenfor gruppe-totalen (se specGroupMeterTotal).
function getSpecMeterRow(m) {
    if (!m || m.enhet === 'eske') return null;
    if (typeof getRunningMeterInfo !== 'function') return null;
    var info = getRunningMeterInfo(m.name);
    if (!info) return null;
    var antall = parseFloat(String(m.antall || '').replace(',', '.'));
    if (isNaN(antall) || antall <= 0) return null;
    return { meters: calculateRunningMeters(info, antall), rounds: info.rounds || 1, stk: m.antall };
}

// «(4 stk)» / «(3 stk × 2 lag)»-suffikset til Beskrivelse. Tomt for alt annet enn
// rull-dimensjonsrader. ÉN kilde — logikken fantes tidligere i tre kopier
// (servicebil, bil-historikk og eksporten), som er nettopp hvordan de rakk å
// vise samme rad på tre ulike måter.
function materialStkSuffix(m) {
    var lm = getSpecMeterRow(m);
    if (!lm) return '';
    var stk = String(lm.stk || '').replace('.', ',');
    return lm.rounds > 1 ? ' (' + stk + ' stk × ' + lm.rounds + ' lag)' : ' (' + stk + ' stk)';
}

// ÉN kilde for Antall-kolonnen. For rull-dimensjonsrader er tallet den omregnede
// LENGDEN, ikke stykktallet — stykktallet står i Beskrivelse.
function getMaterialRowAntall(m) {
    if (!m) return '';
    var lm = getSpecMeterRow(m);
    return formatRunningMeters(lm ? lm.meters : m.antall);
}

// ÉN kilde for Enhet-kolonnen på alle flater. Før fantes det to konkurrerende
// regler (denne og materialvelgerens egen if/else), og de ga «stk» i eksporten og
// «eske» i servicebil for nøyaktig samme rad.
function getMaterialRowUnit(m) {
    if (!m) return 'stk';
    // Rull-dimensjonsrad → meter. MÅ ligge før quantityUnit-oppslaget: raden er
    // lagret med enhet «stk», men det tallet vises ikke lenger i Antall-kolonnen.
    if (getSpecMeterRow(m)) return 'meter';
    return m.quantityUnit || getMaterialQuantityUnit(m.name, m.enhet, m.source) || 'stk';
}

// ÉN kilde for «skal varianten stå i NAVNET?». Normalt nei: varianten ER enheten
// (se getMaterialQuantityUnit) og hører i Enhet-kolonnen — ellers står
// pakningsformen to steder («FSA pølse · 1,0 pølse»). Eneste unntak er en
// FORELDRELØS variant (slettet eller omdøpt) som ikke ble enheten: da beholdes
// ordet i navnet så informasjonen ikke forsvinner sporløst.
// Lå tidligere som fire nesten like kopier — begge eksport-veiene,
// materialvelgeren og ordrekortet — og de drev fra hverandre: ordrekortet
// appendet ubetinget og skrev derfor varianten dobbelt.
function materialVariantSuffix(m) {
    if (!m) return '';
    var variant = String(normalizeVariant(m.name, m.enhet || '') || '').toLowerCase();
    if (!variant || variant === 'stk' || variant === 'meter') return '';
    if (variant === String(getMaterialRowUnit(m) || '').toLowerCase()) return '';
    return ' ' + variant;
}

function getMaterialQuantityUnit(materialName, enhet, source) {
    if (source && source.indexOf('unit:') === 0) return source.substring(5);
    var enhetLower = (enhet || '').toLowerCase();
    if (enhetLower === 'meter' || enhetLower === 'løpende' || enhetLower === 'lm') return 'meter';
    // enhet 'eske' → «eske» under Enhet. Gjelder BÅDE et spec-derivert navn
    // («FC6 Ø250mm», eske med mål) og spec-basen selv («FSC», eske uten mål).
    // Tidligere krevde denne et spec-DERIVERT navn, så eske-rader uten mål fikk
    // «stk» — altså feil enhet på et dokument kunden signerer. Det var et bevisst
    // valg for å unngå «Esker · 2 · eske». Det problemet er nå borte på ordentlig:
    // «eske» er en pakningsform i Beskrivelse og Enhet er «stk» (se
    // getMaterialRowUnit), så ordet står ett sted og enheten er alltid sann.
    // Type-vakten står igjen og hindrer fortsatt at et STANDARD-materiale med
    // brukervarianten «Eske» bytter enhet — det skal fremdeles telles i stk.
    if (enhetLower === 'eske' && (cachedMaterialOptions || []).some(function(m) {
        if (m.type !== 'mansjett' && m.type !== 'brannpakning' && m.type !== 'kabelhylse') return false;
        var lower = String(materialName || '').toLowerCase();
        var base = m.name.toLowerCase();
        return lower === base || lower.startsWith(base + ' ');
    })) return 'eske';
    var productDefault = getKappeProductDefaultUnit(materialName);
    if (productDefault) return productDefault;
    if (source === 'kappe-products') return 'meter';
    var config = getMaterialPickerConfig(materialName);
    // Et standard-materiales VARIANT ER enheten. «Sekk», «Pølse», «Patron» er
    // pakningsformer man faktisk bestiller i — «stk» ville vært den tomme
    // enheten, og ordet måtte da klemmes inn i Beskrivelse i stedet («GPG sekk
    // · 4,0 · stk»). Spec-materialene har alltid gjort det riktig («Ø250mm ·
    // 3,0 · eske»); dette gjør standard-materialene like.
    // Kun når enheten faktisk ER en av materialets varianter — et foreldreløst
    // navn (variant slettet/omdøpt) faller fortsatt tilbake til «stk», og da
    // beholder Beskrivelse ordet så informasjonen ikke forsvinner.
    if (config && (config.type || 'standard') === 'standard' && enhetLower
        && (config.allowedUnits || []).some(function(u) {
            var label = typeof u === 'string' ? u : (u.plural || u.singular || '');
            return String(label).toLowerCase() === enhetLower;
        })) {
        return enhetLower;
    }
    return (config && config.quantityUnit === 'meter') ? 'meter' : 'stk';
}

const DEV_MODE = location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

let authReady = false; // true after first onAuthStateChanged
let cachedRequiredSettings = null;

// Apply non-breaking spaces inside (…) and zero-width spaces after × for cleaner line-wrapping.
// Display-only — never call on data that will be stored or compared.
function formatDisplayForBreak(text) {
    if (!text) return text;
    text = text.replace(/\u00d7/g, '\u00d7\u200b');
    text = text.replace(/\(([^)]*)\)/g, function(_, inner) {
        return '(' + inner.replace(/ /g, '\u00a0') + ')';
    });
    return text;
}

// Normalize kabelhylse formats and ensure consistent × usage
function formatKabelhylseSpec(name) {
    return name
        // Round kabelhylse: Ø60x250mm / Ø60mm dyp 250 / Ø60mm (d250) → Ø60×250mm
        .replace(/Ø(\d+)mm Dybde (\d+)(?:mm)?/, 'Ø$1×$2mm')
        .replace(/Ø(\d+)mm dyp (\d+)(?:mm)?/, 'Ø$1×$2mm')
        .replace(/Ø(\d+)mm \(d(\d+)(?:mm)?\)/, 'Ø$1×$2mm')
        .replace(/Ø(\d+)x(\d+)mm\b/, 'Ø$1×$2mm')
        // Square kabelhylse: 90x90x400mm / 90x90mm dyp 400 / 90x90mm (d400) → 90×90×400mm
        .replace(/(\d+)x(\d+)mm Dybde (\d+)(?:mm)?/, '$1×$2×$3mm')
        .replace(/(\d+)x(\d+)mm dyp (\d+)(?:mm)?/, '$1×$2×$3mm')
        .replace(/(\d+)x(\d+)mm \(d(\d+)(?:mm)?\)/, '$1×$2×$3mm')
        .replace(/(\d+)x(\d+)x(\d+)mm/, '$1×$2×$3mm')
        // General: normalize x → × between dimensions
        .replace(/(\d+)x(\d+)/, '$1×$2');
}

function getBaseMaterialName(name, enhet) {
    if (cachedMaterialOptions) {
        var specBase = cachedMaterialOptions.find(function(m) {
            if (m.type !== 'mansjett' && m.type !== 'brannpakning' && m.type !== 'kabelhylse') return false;
            if (name.toLowerCase().startsWith(m.name.toLowerCase() + ' ')) return true;
            if (enhet === 'meter' && name.toLowerCase() === m.name.toLowerCase()) return true;
            // Eske-rad på spec-basen (samme mønster som løpende meter): dimensjonsløs
            // post lagret rett på basenavnet, diskriminert av enhet. Streng små-
            // bokstav med vilje — en gammel standard-variant «Eske» (stor E) skal
            // fortsatt IKKE treffe her.
            if (enhet === 'eske' && name.toLowerCase() === m.name.toLowerCase()) return true;
            return false;
        });
        if (specBase) return specBase.name;
    }
    return name;
}

function isSpecGroupedMaterial(name, enhet) {
    if (!cachedMaterialOptions) return false;
    return cachedMaterialOptions.some(function(m) {
        if (m.type !== 'mansjett' && m.type !== 'brannpakning' && m.type !== 'kabelhylse') return false;
        if (name.toLowerCase().startsWith(m.name.toLowerCase() + ' ')) return true;
        if (enhet === 'meter' && name.toLowerCase() === m.name.toLowerCase()) return true;
        // Eske-rad på spec-basen — se kommentar i getBaseMaterialName.
        if (enhet === 'eske' && name.toLowerCase() === m.name.toLowerCase()) return true;
        return false;
    });
}

// Aggregate duplicate materials for export: same name + same enhet → sum antall.
// Skjema-visningen beholder separate rader; dette er kun for eksport.
function aggregateExportMaterials(materials) {
    var byKey = {};
    var ordered = [];
    materials.forEach(function(m) {
        var name = m.name || '';
        var enhet = (m.enhet || '').toLowerCase();
        if (!name) {
            // Tomme/ukjente entries holdes separate
            ordered.push(m);
            return;
        }
        // Kappe-isolasjon må IKKE forhåndsaggregeres: platebehovet er ikke-
        // lineært (per-rad opprunding til halv plate + per-rad valgt
        // kutteretning). Å summere løpemeter først og regne én gang gir feil
        // tall vs. ordrekortet. Behold hver rad separat med ALLE felt (inkl.
        // kappeOrient) — eksportens iso-aggregering summerer da
        // calcKappePlateCount per rad, identisk med ordrekortet.
        if (m.source === 'kappe-products') {
            var kc = { name: m.name, antall: m.antall || '', enhet: m.enhet || '' };
            if (m.source) kc.source = m.source;
            if (m.quantityUnit) kc.quantityUnit = m.quantityUnit;
            if (m.bredde) kc.bredde = m.bredde;
            if (m.specMode) kc.specMode = m.specMode;
            if (m.plate && (m.plate.length || m.plate.width)) kc.plate = m.plate;
            if (m.lmPerSide) kc.lmPerSide = m.lmPerSide;
            if (m.antallObjekter) kc.antallObjekter = m.antallObjekter;
            if (m.sider) kc.sider = m.sider;
            if (m.kappeOrient) kc.kappeOrient = m.kappeOrient;
            if (m.kappeIsoGroup) kc.kappeIsoGroup = m.kappeIsoGroup;
            if (m.kappeIsoGroupName) kc.kappeIsoGroupName = m.kappeIsoGroupName;
            ordered.push(kc);
            return;
        }
        var source = m.source || '';
        var quantityUnit = m.quantityUnit || '';
        var bredde = m.bredde || '';
        var specMode = m.specMode || '';
        // Inkluder bredde + specMode i agg-nøkkelen så bredde-mode og plate-mode
        // av samme produkt ikke smelter sammen (de har ulik regneenhet for plater).
        var key = name.toLowerCase() + '|' + enhet + '|' + source + '|' + quantityUnit + '|' + bredde + '|' + specMode;
        if (byKey[key]) {
            var existing = parseFloat(String(byKey[key].antall || '').replace(',', '.')) || 0;
            var addNum = parseFloat(String(m.antall || '').replace(',', '.')) || 0;
            var sum = existing + addNum;
            byKey[key].antall = (sum % 1 === 0)
                ? String(sum)
                : String(sum).replace('.', ',');
        } else {
            byKey[key] = { name: m.name, antall: m.antall || '', enhet: m.enhet || '' };
            if (source) byKey[key].source = source;
            if (quantityUnit) byKey[key].quantityUnit = quantityUnit;
            // Bevar bredde/plate/specMode — trengs for calcKappePlateCount i eksport.
            if (bredde) byKey[key].bredde = bredde;
            if (specMode) byKey[key].specMode = specMode;
            if (m.plate && (m.plate.length || m.plate.width)) byKey[key].plate = m.plate;
            ordered.push(byKey[key]);
        }
    });
    return ordered;
}

// Sort-nøkkel for spec-entries: [diameter, lag/høyde, meter-flag]
// Brukes til å sortere stigende: Ø100 2 lag før Ø100 3 lag før Ø200 2 lag.
// Meter-entries (__meter) plasseres sist i gruppen.
// Rekkefølgen enhets-blokkene vises i. Dette er en PRODUKTBESLUTNING, ikke en
// implementasjonsdetalj — derfor en navngitt tabell og ikke tall inline:
// stk (de fleste radene) → meter → eske. Eske sist gir en fin bivirkning: blokken
// havner rett over «Totalt (uten esker)», så forbeholdet står inntil radene det
// gjelder. Ukjent enhet havner bakerst i stedet for å blande seg inn i en blokk.
var SPEC_UNIT_SORT_RANK = { stk: 0, meter: 1, eske: 2 };
var SPEC_UNIT_SORT_RANK_UNKNOWN = 3;

// Sorteringsnøkkel for én rad i en spec-gruppe: [enhet, harMål, bredde, høyde,
// dybde, lag]. ENHET er primær — det er den eneste rekkefølgen der Enhet-kolonnen
// faktisk leser sortert. (Mål primært gjør enhet til en tiebreaker mellom rader med
// samme mål, og siden nesten alle mål er unike ville kolonnen forblitt spredt.)
//
// Tar materialet, ikke bare navnet: enheten kan ikke utledes av navnet alene.
//
// Erstattet en lokal regex som hadde to feil: den lette etter «Ø» for å finne
// bredden, så FIRKANT-mål («250x250mm») fikk bredde 0 og havnet øverst i gruppa;
// og den hadde en gren for «__meter»-suffikset som aldri traff, fordi suffikset
// strippes før lagring. Enhets-rangeringen over dekker nå intensjonen bak den.
function getSpecSortKey(m, baseName) {
    var name = (m && m.name) || '';
    var unit = String(getMaterialRowUnit(m) || '').toLowerCase();
    var unitRank = SPEC_UNIT_SORT_RANK[unit];
    if (unitRank == null) unitRank = SPEC_UNIT_SORT_RANK_UNKNOWN;
    // Gjenbruker _parseSpecFromName (samme parser som resten av appen) i stedet for
    // en egen regex — den kjenner ALLE formene appen produserer: Ø100mm, 100x200mm,
    // Ø50x250mm, 100x200x300mm og «… 2 lag». Det var nettopp en hjemmesnekret regex
    // uten firkant-støtte som var bugen. Returnerer null når navnet ikke har mål.
    var dims = (typeof _parseSpecFromName === 'function') ? _parseSpecFromName(name, baseName) : null;
    // Rader uten mål (løpemeter, eske uten mål) først i sin egen enhets-blokk.
    if (!dims || dims.isMeter) return [unitRank, 0, 0, 0, 0, 0];
    // Lik bredde: rund før firkant, siden en rund spec ikke har høyde (0 < N).
    return [unitRank, 1, dims.width || 0, dims.height || 0, dims.depth || 0, dims.rounds || 0];
}

function groupMaterialsByBase(materials, options) {
    options = options || {};
    var groups = [];
    var groupMap = {};
    materials.forEach(function(m) {
        var mName = m.name || '';
        var isIsolation = shouldGroupAsKappeIsolation(m);
        var isStift = shouldGroupAsKappeStift(m);
        // Kappe-materialer splittes nå i to grupper: Isolasjon og Festemiddel.
        var baseName;
        if (isIsolation) baseName = MATERIAL_ISOLATION_LAUNCHER;
        else if (isStift) baseName = MATERIAL_FESTEMIDDEL_LAUNCHER;
        else baseName = getBaseMaterialName(mName, m.enhet);
        var isSpec = isSpecGroupedMaterial(mName, m.enhet);
        if ((isSpec || isIsolation || isStift) && groupMap[baseName]) {
            // Add to existing spec group
            groupMap[baseName].items.push(m);
        } else if (isSpec || isIsolation || isStift) {
            // Start new spec group
            var groupDisplayName;
            if (isIsolation) groupDisplayName = getMaterialIsolationLabel();
            else if (isStift) groupDisplayName = getKappeFastenerLabel();
            else groupDisplayName = baseName;
            groupMap[baseName] = {
                baseName: baseName,
                displayName: groupDisplayName,
                items: [m],
                isSpecGroup: isSpec,
                isIsolationGroup: isIsolation,
                isStiftGroup: isStift
            };
            groups.push(groupMap[baseName]);
        } else {
            // Standard material — always flat (own group with 1 item)
            groups.push({ baseName: baseName, displayName: baseName, items: [m], isSpecGroup: false, isIsolationGroup: false, isStiftGroup: false });
        }
    });
    // Sort items inside each spec group only when explicitly requested (eksport)
    if (options.sortItems) {
        groups.forEach(function(g) {
            if (g.isSpecGroup && g.items.length > 1) {
                g.items.sort(function(a, b) {
                    var ka = getSpecSortKey(a, g.baseName);
                    var kb = getSpecSortKey(b, g.baseName);
                    // Alle nivåene i rekkefølge. Den gamle koden sammenlignet bare
                    // tre av dem, og i rekkefølgen [2],[0],[1] — så dybde/lag slo
                    // bredden.
                    for (var i = 0; i < ka.length; i++) {
                        if (ka[i] !== kb[i]) return ka[i] - kb[i];
                    }
                    return 0;
                });
            }
        });
    }
    // Sort: single/standard items first, then spec groups alfabetisk
    groups.sort(function(a, b) {
        var aSpec = (a.isSpecGroup || a.isIsolationGroup || a.isStiftGroup) && a.items.length >= 1 ? 1 : 0;
        var bSpec = (b.isSpecGroup || b.isIsolationGroup || b.isStiftGroup) && b.items.length >= 1 ? 1 : 0;
        if (aSpec !== bSpec) return aSpec - bSpec;
        return (a.displayName || a.baseName).localeCompare(b.displayName || b.baseName, 'nb');
    });
    // Etter alfabetisk sortering: tving Festemidler-gruppen til å stå rett etter
    // Isolasjon-gruppen (de hører konseptuelt sammen som "kapp"-materialer, men vi
    // unngår en ekstra header-nivå).
    var isoIdx = groups.findIndex(function(g) { return g.isIsolationGroup; });
    var festIdx = groups.findIndex(function(g) { return g.isStiftGroup; });
    if (isoIdx !== -1 && festIdx !== -1 && festIdx !== isoIdx + 1) {
        var festGroup = groups.splice(festIdx, 1)[0];
        var newIsoIdx = groups.findIndex(function(g) { return g.isIsolationGroup; });
        groups.splice(newIsoIdx + 1, 0, festGroup);
    }
    return groups;
}

// Get display name for a sub-item within a group (strip base name for spec materials, show variant for standard)
function getGroupedDisplayName(m, baseName) {
    var name = m.name || '';
    if (baseName === MATERIAL_FESTEMIDDEL_LAUNCHER) {
        return formatKappeStiftName(m.enhet, name, m.quantityUnit);
    }
    if (baseName === MATERIAL_KAPPE_LAUNCHER && shouldGroupAsKappeStift(m)) {
        return formatKappeStiftName(m.enhet, name, m.quantityUnit);
    }
    if (baseName === MATERIAL_KAPPE_LAUNCHER || baseName === MATERIAL_ISOLATION_LAUNCHER) {
        return formatKappeIsolationName(name, m.enhet, m.bredde, m.specMode);
    }
    if (baseName === MATERIAL_STIFT_LAUNCHER) {
        return formatKappeStiftName(m.enhet, name, m.quantityUnit);
    }
    if (shouldGroupAsKappeStift(m)) {
        return formatKappeStiftName(m.enhet, name, m.quantityUnit);
    }
    // Dimensjonsl\u00f8se poster p\u00e5 spec-basen: l\u00f8pemeter og esker uten m\u00e5l.
    // Begge f\u00e5r et FORMORD som beskriver hva raden er, uten \u00e5 gjenta noe:
    //   \u00abL\u00f8pende\u00bb \u00b7 meter   \u2014 p\u00e5 rull, ikke ferdigkappet
    //   \u00abStandard\u00bb \u00b7 eske   \u2014 standard pakning, ingen st\u00f8rrelse valgt
    // Ingen av dem gjentar gruppe-overskriften eller enhets-kolonnen.
    // Forkastet underveis: produktnavnet (gjentok overskriften), \u00abEsker\u00bb (gjentok
    // enheten), \u00abUten m\u00e5l\u00bb (negativ formulering), tom celle (leses som glemt
    // utfylling p\u00e5 et signert dokument) og tankestrek.
    if (m.enhet === 'meter' && name.toLowerCase() === baseName.toLowerCase()) {
        return 'l\u00f8pende';
    }
    if (m.enhet === 'eske' && name.toLowerCase() === baseName.toLowerCase()) {
        return 'standard';
    }
    // Spec-avledet: strip produktnavnet, vis m\u00e5let. En eske-rad og en stk-rad
    // med samme m\u00e5l skilles av Enhet-kolonnen \u2014 det er den forskjellen kolonnen
    // finnes for, og derfor skal ordet \u00abeske\u00bb ikke ogs\u00e5 st\u00e5 her.
    // materialStkSuffix legger p\u00e5 \u00ab(4 stk)\u00bb for RULL-produkter, der Antall-kolonnen
    // viser meter og stykktallet ellers ville forsvunnet helt.
    if (name.toLowerCase().startsWith(baseName.toLowerCase() + ' ')) {
        var spec = name.substring(baseName.length + 1);
        var stkSuffix = materialStkSuffix(m);
        // Suffikset b\u00e6rer ALLEREDE lag-tallet (\u00ab3 stk \u00d7 2 lag\u00bb), s\u00e5 lag-delen m\u00e5
        // strippes av spec-en \u2014 ellers st\u00e5r det to ganger:
        // \u00ab\u00d8100mm 2 lag (3 stk \u00d7 2 lag)\u00bb. Gjelder brannpakning, som er den ene
        // typen der spec-navnet selv inneholder antall lag.
        if (stkSuffix) spec = spec.replace(/\s+\d+\s*lag$/i, '').replace(/r\d+$/i, '');
        return spec + stkSuffix;
    }
    // For standard materials with variants (like FSA), show the variant from enhet
    var enhetVal = normalizeVariant(name, m.enhet || '').toLowerCase();
    if (enhetVal && enhetVal !== 'stk' && enhetVal !== 'meter') {
        return enhetVal;
    }
    return name;
}

// Normalize stored enhet against current variant names from settings
function normalizeVariant(materialName, enhet) {
    if (!enhet || enhet === 'stk' || enhet === 'meter') return enhet;
    var matConfig = getMaterialPickerConfig(materialName);
    if (!matConfig || !matConfig.allowedUnits || matConfig.allowedUnits.length === 0) return enhet;
    // Check if stored enhet matches a variant (case-insensitive, startsWith to handle old plural forms)
    var enhetLower = enhet.toLowerCase();
    for (var i = 0; i < matConfig.allowedUnits.length; i++) {
        var v = matConfig.allowedUnits[i];
        var variantName = (typeof v === 'string' ? v : (v.plural || v.singular || v)).toLowerCase();
        if (enhetLower === variantName || enhetLower.startsWith(variantName) || variantName.startsWith(enhetLower)) {
            return typeof v === 'string' ? v : (v.plural || v.singular || v);
        }
    }
    return enhet;
}

// Safe JSON parse from localStorage - prevents crash on corrupt data
function safeParseJSON(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v || fallback; }
    catch(e) { console.error('Corrupt localStorage key:', key); return fallback; }
}

// Safe localStorage write - prevents crash on quota exceeded
function safeSetItem(key, value) {
    try { localStorage.setItem(key, value); }
    catch(e) { console.error('localStorage quota exceeded:', key); }
}

function enqueueUserDocSet(collectionName, docId, data, context, options) {
    if (!currentUser || !db || !docId) return;
    if (!window._pendingFirestoreOps) window._pendingFirestoreOps = Promise.resolve();
    window._pendingFirestoreOps = window._pendingFirestoreOps.then(function() {
        var ref = db.collection('users').doc(currentUser.uid).collection(collectionName).doc(docId);
        return options ? ref.set(data, options) : ref.set(data);
    }).catch(function(e) {
        console.error((context || 'Firestore set') + ' error:', e);
    });
    if (typeof _pendingFirestoreOps !== 'undefined') _pendingFirestoreOps = window._pendingFirestoreOps;
}

function enqueueUserDocDelete(collectionName, docId, context) {
    if (!currentUser || !db || !docId) return;
    if (!window._pendingFirestoreOps) window._pendingFirestoreOps = Promise.resolve();
    window._pendingFirestoreOps = window._pendingFirestoreOps.then(function() {
        return db.collection('users').doc(currentUser.uid).collection(collectionName).doc(docId).delete();
    }).catch(function(e) {
        console.error((context || 'Firestore delete') + ' error:', e);
    });
    if (typeof _pendingFirestoreOps !== 'undefined') _pendingFirestoreOps = window._pendingFirestoreOps;
}

function enqueueUserDocMove(targetCollection, sourceCollection, docId, data, context) {
    if (!currentUser || !db || !docId) return;
    if (!window._pendingFirestoreOps) window._pendingFirestoreOps = Promise.resolve();
    window._pendingFirestoreOps = window._pendingFirestoreOps.then(function() {
        return db.collection('users').doc(currentUser.uid).collection(targetCollection).doc(docId).set(data);
    }).then(function() {
        return db.collection('users').doc(currentUser.uid).collection(sourceCollection).doc(docId).delete();
    }).catch(function(e) {
        console.error((context || 'Firestore move') + ' error:', e);
    });
    if (typeof _pendingFirestoreOps !== 'undefined') _pendingFirestoreOps = window._pendingFirestoreOps;
}

// Fler-valg: flytt N dokumenter i ÉN atomisk batch i stedet for 2 Firestore-kall
// pr. skjema i en lang sekvensiell kjede. Deling sender appen i bakgrunnen, og
// Android/Chrome kan fryse eller forkaste PWA-siden mens brukeren står i
// e-postappen — da mistes resten av køen. Resultatet var at bare de første
// skjemaene faktisk ble flyttet til archive i Firestore, mens localStorage sa at
// alle var sendt; neste refresh hentet Firestore-fasiten og «angret» resten.
// En batch er alt-eller-ingenting og krever bare én round-trip.
// ops = [{ target, source, id, data }] — source kan utelates (ren set).
function enqueueUserDocMoveBatch(ops, context) {
    if (!currentUser || !db || !ops || !ops.length) return;
    if (!window._pendingFirestoreOps) window._pendingFirestoreOps = Promise.resolve();
    // Firestore-grensen er 500 writes pr. batch; hver move er 2 writes.
    var chunks = [];
    for (var i = 0; i < ops.length; i += 200) chunks.push(ops.slice(i, i + 200));
    window._pendingFirestoreOps = window._pendingFirestoreOps.then(function() {
        var userRef = db.collection('users').doc(currentUser.uid);
        return Promise.all(chunks.map(function(chunk) {
            var batch = db.batch();
            chunk.forEach(function(op) {
                batch.set(userRef.collection(op.target).doc(op.id), op.data);
                if (op.source && op.source !== op.target) {
                    batch.delete(userRef.collection(op.source).doc(op.id));
                }
            });
            return batch.commit();
        }));
    }).catch(function(e) {
        console.error((context || 'Firestore batch move') + ' error:', e);
    });
    if (typeof _pendingFirestoreOps !== 'undefined') _pendingFirestoreOps = window._pendingFirestoreOps;
}

// Global HTML escape function - prevents XSS attacks
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeJsStringAttr(str) {
    return escapeHtml(String(str || '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029'));
}

// ============================================
// FLERSPRÅK
// ============================================
let currentLang = localStorage.getItem('firesafe_lang') || 'no';

function t(key, ...args) {
    let str = (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) || (TRANSLATIONS['no'] && TRANSLATIONS['no'][key]) || key;
    args.forEach((val, i) => { str = str.replace('{' + i + '}', val); });
    return str;
}

function setLanguage(lang) {
    currentLang = lang;
    safeSetItem('firesafe_lang', lang);
    applyTranslations();
    // Save to Firebase if logged in
    if (currentUser && db) {
        enqueueUserDocSet('settings', 'language', { lang: lang }, 'Save language');
    }
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    // Update login button
    updateLoginButton();
    // Update language checkmarks
    const checkNo = document.getElementById('lang-check-no');
    const checkEn = document.getElementById('lang-check-en');
    if (checkNo) checkNo.textContent = currentLang === 'no' ? '\u2713' : '';
    if (checkEn) checkEn.textContent = currentLang === 'en' ? '\u2713' : '';
    // Re-number order cards
    renumberOrders();
    if (typeof renumberServiceEntries === 'function') renumberServiceEntries();
}

// ============================================
// FIREBASE KONFIGURASJON
// Fyll inn dine egne verdier fra Firebase Console
// ============================================
const firebaseConfig = {
    apiKey: "AIzaSyDeo-InG090ISeP-C_oLYS63cpXGB9SLHo",
    authDomain: "firesafe-ordreseddler.firebaseapp.com",
    projectId: "firesafe-ordreseddler",
    storageBucket: "firesafe-ordreseddler.firebasestorage.app",
    messagingSenderId: "410377100638",
    appId: "1:410377100638:web:cc1c59765535198d5f43cf"
};

// Initialize Firebase
let db = null;
let auth = null;
let currentUser = null;
let isAdmin = localStorage.getItem('firesafe_admin') === '1';

try {
    if (typeof firebase !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        auth = firebase.auth();
    }
} catch (e) {
    // Firebase not configured
}

// Enable offline persistence for faster reads/writes
if (db) {
    db.enablePersistence({ synchronizeTabs: true }).catch(function(err) {
        if (err.code === 'failed-precondition') {
            console.warn('Firestore persistence: multiple tabs open');
        } else if (err.code === 'unimplemented') {
            console.warn('Firestore persistence not supported');
        }
    });
}

// Check if user is admin
async function checkAdminStatus(uid) {
    if (!db || !uid) return false;
    try {
        const doc = await db.collection('admins').doc(uid).get();
        return doc.exists;
    } catch (e) {
        return false;
    }
}

// Auth state listener
if (auth) {
    auth.onAuthStateChanged(function(user) {
        authReady = true;
        currentUser = user;
        isAdmin = false;
        localStorage.removeItem('firesafe_admin');
        updateLoginButton();
        loadedForms = [];

        if (!user) {
            // Dev bypass: skip login screen on local dev
            if (DEV_MODE) {
                currentUser = { uid: 'dev-local', email: 'dev@localhost', displayName: 'Dev Mode' };
                isAdmin = true;
                safeSetItem('firesafe_logged_in', '1');
                updateLoginButton();
                showTemplateModal();
                return;
            }
            window._explicitLogout = false;
            if (localStorage.getItem('firesafe_logged_in')) {
                // Kan være midlertidig null under auth-init. Vent før vi rydder.
                setTimeout(function() {
                    if (!currentUser) {
                        localStorage.removeItem('firesafe_logged_in');
                        sessionStorage.removeItem('firesafe_current');
                        sessionStorage.removeItem('firesafe_current_sent');
                        showView('login-view');
                        var loginCard = document.getElementById('login-card');
                        if (loginCard) loginCard.style.display = '';
                        document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open', 'calculator-modal-open');
                    }
                }, 3000);
                return;
            }
            sessionStorage.removeItem('firesafe_current');
            sessionStorage.removeItem('firesafe_current_sent');
            showView('login-view');
            var loginCard = document.getElementById('login-card');
            if (loginCard) loginCard.style.display = '';
            document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open', 'calculator-modal-open');
            return;
        }

        // Ignore stale auth events after explicit logout
        if (window._explicitLogout) {
            window._explicitLogout = false;
            return;
        }

        // Clear cached data when switching to a different user
        var lastUid = localStorage.getItem('firesafe_last_uid');
        if (lastUid && lastUid !== user.uid) {
            [SETTINGS_KEY, DEFAULTS_KEY, MATERIALS_KEY, REQUIRED_KEY, USED_NUMBERS_KEY,
             STORAGE_KEY, ARCHIVE_KEY, TEMPLATE_KEY, PLANS_KEY, BIL_STORAGE_KEY,
             SERVICE_STORAGE_KEY, SERVICE_ARCHIVE_KEY, SERVICE_DEFAULTS_KEY,
             KAPPE_STORAGE_KEY, KAPPE_ARCHIVE_KEY, KAPPE_DEFAULTS_KEY,
             KAPPE_CATALOG_KEY, KAPPE_PRODUCTS_KEY, KAPPE_STIFT_SIZES_KEY, KAPPE_KERF_KEY, KAPPE_PLATE_KEY,
             TIMEBOK_STORAGE_KEY, TIMEBOK_SETTINGS_KEY, TIMEBOK_TIMETYPES_KEY, TIMEBOK_BRACKETS_KEY, TIMEBOK_PROJECTS_KEY,
             LEVERINGSADRESSE_KEY, MIN_INFO_KEY, KOLLEGER_KEY,
             'firesafe_lang', 'firesafe_plate_size', 'firesafe_stopwatches']
                .forEach(function(key) { localStorage.removeItem(key); });
            cachedRequiredSettings = null;
            if (typeof cachedMaterialOptions !== 'undefined') cachedMaterialOptions = null;
            if (typeof cachedPlanOptions !== 'undefined') cachedPlanOptions = [];
            currentLang = 'no';
            applyTranslations();
            if (typeof resetPaginationState === 'function') resetPaginationState();
        }
        safeSetItem('firesafe_last_uid', user.uid);

        safeSetItem('firesafe_logged_in', '1');

        var wasOnLogin = document.getElementById('login-view').classList.contains('active');

        if (db) {
            // Show template modal immediately (cache-first)
            if (wasOnLogin) showTemplateModal();

            // Sync everything in background (non-blocking)
            Promise.all([
                checkAdminStatus(user.uid).then(function(admin) {
                    isAdmin = admin;
                    if (admin) safeSetItem('firesafe_admin', '1');
                }).catch(function() {}),
                db.collection('users').doc(user.uid).collection('settings').doc('language').get().then(function(doc) {
                    if (doc.exists && doc.data().lang) {
                        currentLang = doc.data().lang;
                        safeSetItem('firesafe_lang', currentLang);
                        applyTranslations();
                    }
                }).catch(function() {}),
                syncOrderNumberIndex().catch(function() {}),
                syncDefaultsToLocal().catch(function() {}),
                syncSettingsToLocal().catch(function() {}),
                typeof getDropdownOptions === 'function' ? getDropdownOptions().catch(function() {}) : Promise.resolve(),
                typeof loadPlanOptions === 'function' ? loadPlanOptions().catch(function() {}) : Promise.resolve(),
                typeof syncBilHistory === 'function' ? syncBilHistory().catch(function() {}) : Promise.resolve(),
                typeof getRequiredSettings === 'function' ? getRequiredSettings().then(function(data) {
                    cachedRequiredSettings = data;
                    if (typeof updateRequiredIndicators === 'function') updateRequiredIndicators();
                }).catch(function() {}) : Promise.resolve(),
                typeof getTemplates === 'function' ? getTemplates().then(function(result) {
                    _templateLastDoc = result.lastDoc;
                    _templateHasMore = result.hasMore;
                    safeSetItem(TEMPLATE_KEY, JSON.stringify(result.forms.slice(0, 50)));
                    window.loadedTemplates = result.forms;
                    // Prosjektene er fasit for prosjektfeltene i skjemaene. Lister som
                    // rakk å rendre FØR malene var lastet ble synket mot en tom
                    // fasit — rendre dem på nytt nå som fasiten finnes.
                    if (typeof _rerenderListsAfterProjectCorrection === 'function') {
                        _rerenderListsAfterProjectCorrection();
                    }
                    // Refresh template modal if still visible
                    if (document.body.classList.contains('template-modal-open')) {
                        var active = result.forms.filter(function(t) { return t.active !== false; });
                        renderTemplateList(active, false, _templateHasMore);
                    }
                }).catch(function() {}) : Promise.resolve(),
                // Sync Kappeskjema-data fra Firebase ved innlogging.
                // Migreringsmønster: hvis Firebase er tomt men lokal har data, push lokal til Firebase
                // (eldre lokal-only data). Aldri overskriv lokal data med tom Firebase-svar.
                typeof getKappeForms === 'function' ? Promise.all([
                    getKappeForms().catch(function() { return { forms: [] }; }),
                    typeof getKappeSentForms === 'function' ? getKappeSentForms().catch(function() { return { forms: [] }; }) : Promise.resolve({ forms: [] })
                ]).then(function(kappeResults) {
                    var fbSaved = kappeResults[0].forms || [];
                    var fbSent = kappeResults[1].forms || [];
                    var localSaved = safeParseJSON(KAPPE_STORAGE_KEY, []);
                    var localSent = safeParseJSON(KAPPE_ARCHIVE_KEY, []);

                    if (fbSaved.length > 0) {
                        safeSetItem(KAPPE_STORAGE_KEY, JSON.stringify(fbSaved.slice(0, 50)));
                    } else if (localSaved.length > 0) {
                        // Migrer lokal data til Firebase
                        localSaved.forEach(function(form) {
                            if (form && form.id) {
                                enqueueUserDocSet('kappeforms', form.id, form, 'Migrate kappe save');
                            }
                        });
                    }
                    if (fbSent.length > 0) {
                        safeSetItem(KAPPE_ARCHIVE_KEY, JSON.stringify(fbSent.slice(0, 50)));
                    } else if (localSent.length > 0) {
                        localSent.forEach(function(form) {
                            if (form && form.id) {
                                enqueueUserDocSet('kappeArchive', form.id, form, 'Migrate kappe sent');
                            }
                        });
                    }
                }).catch(function() {}) : Promise.resolve(),
                // Sync Kappe-metadata (produkter, stift-størrelser, kerf, plate)
                Promise.all([
                    db.collection('users').doc(user.uid).collection('settings').doc('kappe_catalog').get()
                        .then(function(d) { if (d.exists) safeSetItem(KAPPE_CATALOG_KEY, JSON.stringify(d.data())); }).catch(function() {}),
                    db.collection('users').doc(user.uid).collection('settings').doc('kappe_products').get()
                        .then(function(d) { if (d.exists && !localStorage.getItem(KAPPE_CATALOG_KEY)) safeSetItem(KAPPE_PRODUCTS_KEY, JSON.stringify(d.data())); }).catch(function() {}),
                    db.collection('users').doc(user.uid).collection('settings').doc('kappe_stift_sizes').get()
                        .then(function(d) { if (d.exists && !localStorage.getItem(KAPPE_CATALOG_KEY)) safeSetItem(KAPPE_STIFT_SIZES_KEY, JSON.stringify(d.data())); }).catch(function() {}),
                    db.collection('users').doc(user.uid).collection('settings').doc('kappe_kerf').get()
                        .then(function(d) { if (d.exists) safeSetItem(KAPPE_KERF_KEY, JSON.stringify(d.data())); }).catch(function() {}),
                    db.collection('users').doc(user.uid).collection('settings').doc('kappe_plate').get()
                        .then(function(d) { if (d.exists) safeSetItem(KAPPE_PLATE_KEY, JSON.stringify(d.data())); }).catch(function() {})
                ]).catch(function() {}),
                // Timebok: siste dager (cache) + innstillinger (timesats/tidstyper/brackets/prosjekter)
                getTimebokRecentDays().then(function(days) {
                    if (Array.isArray(days)) safeSetItem(TIMEBOK_STORAGE_KEY, JSON.stringify(days.slice(0, 60)));
                }).catch(function() {}),
                db.collection('users').doc(user.uid).collection('settings').doc('timebok_settings').get()
                    .then(function(d) { if (d.exists) safeSetItem(TIMEBOK_SETTINGS_KEY, JSON.stringify(d.data())); }).catch(function() {}),
                db.collection('users').doc(user.uid).collection('settings').doc('timebok_timetypes').get()
                    .then(function(d) { if (d.exists) safeSetItem(TIMEBOK_TIMETYPES_KEY, JSON.stringify(d.data())); }).catch(function() {}),
                db.collection('users').doc(user.uid).collection('settings').doc('timebok_travel_brackets').get()
                    .then(function(d) { if (d.exists) safeSetItem(TIMEBOK_BRACKETS_KEY, JSON.stringify(d.data())); }).catch(function() {}),
                db.collection('users').doc(user.uid).collection('settings').doc('timebok_projects').get()
                    .then(function(d) { if (d.exists) safeSetItem(TIMEBOK_PROJECTS_KEY, JSON.stringify(d.data())); }).catch(function() {}),
                // Sync min_info, leveringsadresser, plate_size (autofyll-data — må være tilgjengelig før bruker åpner skjema)
                db.collection('users').doc(user.uid).collection('settings').doc('min_info').get()
                    .then(function(d) { if (d.exists) safeSetItem(MIN_INFO_KEY, JSON.stringify(d.data())); }).catch(function() {}),
                db.collection('users').doc(user.uid).collection('settings').doc('kolleger').get()
                    .then(function(d) { if (d.exists) safeSetItem(KOLLEGER_KEY, JSON.stringify(d.data())); }).catch(function() {}),
                db.collection('users').doc(user.uid).collection('settings').doc('lager').get()
                    .then(function(d) { if (d.exists) safeSetItem(LEVERINGSADRESSE_KEY, JSON.stringify(d.data())); }).catch(function() {}),
                db.collection('users').doc(user.uid).collection('settings').doc('plateSize').get()
                    .then(function(d) { if (d.exists) safeSetItem('firesafe_plate_size', JSON.stringify(d.data())); }).catch(function() {}),
                db.collection('users').doc(user.uid).collection('settings').doc('stopwatches').get()
                    .then(function(d) {
                        if (d.exists && Array.isArray(d.data().list)) {
                            safeSetItem('firesafe_stopwatches', JSON.stringify(d.data().list));
                            // Re-render hvis stopwatch-pagen er åpen; ellers returnerer
                            // _swRenderList tidlig (ingen #sw-list i DOM).
                            if (typeof _swRenderList === 'function') _swRenderList();
                        }
                    }).catch(function() {})
            ]).then(function() {
                // Slå sammen prosjektnavn fra ordresedler/maler inn i timebok-prosjektlista
                // (legger kun til nye; rører aldri manuelle/bracket-koblinger).
                if (typeof syncTimebokProjectsFromForms === 'function') syncTimebokProjectsFromForms();
                if (typeof refreshActiveView === 'function') refreshActiveView();
            });
        } else if (wasOnLogin) {
            showTemplateModal();
        }
    });
}

function updateLoginButton() {
    const btn = document.getElementById('btn-login-home');
    if (!btn) return;

    if (currentUser) {
        var email = currentUser.email || currentUser.displayName || '';
        btn.textContent = email;
        btn.classList.add('logged-in');
        safeSetItem('firesafe_email', email);
    } else if (!localStorage.getItem('firesafe_logged_in')) {
        // Bare vis "Logg inn" hvis vi vet at brukeren IKKE er innlogget.
        // Unngå å overskrive cached e-post mens Firebase verifiserer token.
        btn.textContent = t('login');
        btn.classList.remove('logged-in');
        localStorage.removeItem('firesafe_email');
    }
}

function handleAuth() {
    if (!auth) {
        showNotificationModal(t('firebase_not_configured'));
        return;
    }

    var onLoggedInView = document.body.classList.contains('settings-modal-open') ||
        document.body.classList.contains('template-modal-open') ||
        document.body.classList.contains('saved-modal-open') ||
        document.body.classList.contains('calculator-modal-open') ||
        document.getElementById('view-form').classList.contains('active');

    if (currentUser || onLoggedInView) {
        // Logg ut
        showConfirmModal(t('logout_confirm'), () => {
            // Rydd opp umiddelbart — ikke vent på Firebase nettverkskall
            // Behold firesafe_last_uid — trengs for å oppdage brukerbytte ved neste innlogging
            localStorage.removeItem('firesafe_logged_in');
            sessionStorage.removeItem('firesafe_current');
            sessionStorage.removeItem('firesafe_current_sent');
            currentUser = null;
            isAdmin = false;
            window._explicitLogout = true;
            document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open', 'calculator-modal-open');
            history.replaceState(null, '', window.location.pathname);
            showView('login-view');
            var loginCard = document.getElementById('login-card');
            if (loginCard) loginCard.style.display = '';
            updateLoginButton();
            // SignOut i bakgrunnen
            auth.signOut().then(() => {
                showNotificationModal(t('logout_success'), true);
            });
        }, t('logout'), '#6c757d');
    } else {
        showActionPopup(t('login_choose_provider'), [
            { label: '<svg width="18" height="18" viewBox="0 0 48 48" style="vertical-align:middle;margin-right:8px"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 010-9.18l-7.98-6.19a24.04 24.04 0 000 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Google', onclick: 'signInWithGoogle()' },
            { label: '<svg width="18" height="18" viewBox="0 0 23 23" style="vertical-align:middle;margin-right:8px"><rect x="1" y="1" width="10" height="10" fill="#f25022"/><rect x="12" y="1" width="10" height="10" fill="#7fba00"/><rect x="1" y="12" width="10" height="10" fill="#00a4ef"/><rect x="12" y="12" width="10" height="10" fill="#ffb900"/></svg> Microsoft', onclick: 'signInWithMicrosoft()' }
        ]);
    }
}

function signInWithGoogle() {
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithPopup(provider)
        .then(function(result) {
            showNotificationModal(t('login_success') + result.user.email, true);
        })
        .catch(function(error) {
            if (error.code !== 'auth/popup-closed-by-user') {
                showNotificationModal(t('login_failed') + error.message);
            }
        });
}

function signInWithMicrosoft() {
    var provider = new firebase.auth.OAuthProvider('microsoft.com');
    provider.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithPopup(provider)
        .then(function(result) {
            showNotificationModal(t('login_success') + result.user.email, true);
        })
        .catch(function(error) {
            if (error.code !== 'auth/popup-closed-by-user') {
                showNotificationModal(t('login_failed') + error.message);
            }
        });
}

// Paginated Firestore helpers — returns { forms, lastDoc, hasMore }
var PAGE_SIZE = 50;

async function getSavedForms(lastDoc) {
    if (currentUser && db) {
        try {
            var q = db.collection('users').doc(currentUser.uid).collection('forms').orderBy('savedAt', 'desc').limit(PAGE_SIZE);
            if (lastDoc) q = q.startAfter(lastDoc);
            var snapshot = await q.get();
            return { forms: snapshot.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); }), lastDoc: snapshot.docs[snapshot.docs.length - 1] || null, hasMore: snapshot.docs.length === PAGE_SIZE };
        } catch (e) {
            console.error('Firestore error:', e);
            return { forms: safeParseJSON(STORAGE_KEY, []), lastDoc: null, hasMore: false };
        }
    }
    if (auth && !authReady) return { forms: [], lastDoc: null, hasMore: false };
    return { forms: safeParseJSON(STORAGE_KEY, []), lastDoc: null, hasMore: false };
}

async function getSentForms(lastDoc) {
    if (currentUser && db) {
        try {
            var q = db.collection('users').doc(currentUser.uid).collection('archive').orderBy('savedAt', 'desc').limit(PAGE_SIZE);
            if (lastDoc) q = q.startAfter(lastDoc);
            var snapshot = await q.get();
            return { forms: snapshot.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); }), lastDoc: snapshot.docs[snapshot.docs.length - 1] || null, hasMore: snapshot.docs.length === PAGE_SIZE };
        } catch (e) {
            console.error('Firestore error:', e);
            return { forms: safeParseJSON(ARCHIVE_KEY, []), lastDoc: null, hasMore: false };
        }
    }
    if (auth && !authReady) return { forms: [], lastDoc: null, hasMore: false };
    return { forms: safeParseJSON(ARCHIVE_KEY, []), lastDoc: null, hasMore: false };
}

// --- Order number index (lightweight cache of all used order numbers) ---
const USED_NUMBERS_KEY = 'firesafe_used_numbers';

async function syncOrderNumberIndex() {
    if (!currentUser || !db) return;
    var settingsRef = db.collection('users').doc(currentUser.uid).collection('settings').doc('usedNumbers');
    var doc = await settingsRef.get();
    if (doc.exists && doc.data().numbers) {
        safeSetItem(USED_NUMBERS_KEY, JSON.stringify(doc.data().numbers));
    } else {
        // Migrasjon: første gang — scan collections én gang og lagre til Firestore-dokument
        const numbers = new Set();
        const collections = ['forms', 'archive'];
        var snaps = await Promise.all(collections.map(function(col) {
            return db.collection('users').doc(currentUser.uid).collection(col).get().catch(function() { return { docs: [] }; });
        }));
        snaps.forEach(function(snap) {
            snap.docs.forEach(function(d) {
                var nr = d.data().ordreseddelNr;
                if (nr) numbers.add(String(nr));
            });
        });
        var arr = [...numbers];
        safeSetItem(USED_NUMBERS_KEY, JSON.stringify(arr));
        if (arr.length > 0) {
            settingsRef.set({ numbers: arr }, { merge: true }).catch(function(e) {
                console.error('Migration usedNumbers:', e);
            });
        }
    }
}

function addToOrderNumberIndex(nr) {
    if (!nr) return;
    var nums = safeParseJSON(USED_NUMBERS_KEY, []);
    var s = String(nr);
    if (nums.indexOf(s) === -1) {
        nums.push(s);
        safeSetItem(USED_NUMBERS_KEY, JSON.stringify(nums));
    }
    if (currentUser && db) {
        db.collection('users').doc(currentUser.uid).collection('settings')
            .doc('usedNumbers').set({ numbers: firebase.firestore.FieldValue.arrayUnion(s) }, { merge: true })
            .catch(function(e) { console.error('addToOrderNumberIndex Firestore:', e); });
    }
}

function removeFromOrderNumberIndex(nr) {
    if (!nr) return;
    var nums = safeParseJSON(USED_NUMBERS_KEY, []);
    var s = String(nr);
    var idx = nums.indexOf(s);
    if (idx !== -1) {
        nums.splice(idx, 1);
        safeSetItem(USED_NUMBERS_KEY, JSON.stringify(nums));
    }
    if (currentUser && db) {
        db.collection('users').doc(currentUser.uid).collection('settings')
            .doc('usedNumbers').set({ numbers: firebase.firestore.FieldValue.arrayRemove(s) }, { merge: true })
            .catch(function(e) { console.error('removeFromOrderNumberIndex Firestore:', e); });
    }
}

// Track last saved form data for unsaved changes detection
let lastSavedData = null;

function getFormDataSnapshot() {
    const data = getFormData();
    delete data.savedAt;
    return JSON.stringify(data);
}

function getServiceFormDataSnapshot() {
    const data = getServiceFormData();
    delete data.savedAt;
    return JSON.stringify(data);
}

// Confirmation modal
let pendingConfirmAction = null;

function showConfirmModal(message, onConfirm, buttonText, buttonColor) {

    document.getElementById('confirm-modal-text').textContent = message;
    const okBtn = document.getElementById('confirm-btn-ok');
    okBtn.textContent = buttonText || t('btn_remove');
    okBtn.style.backgroundColor = buttonColor || '#e74c3c';
    pendingConfirmAction = onConfirm;
    document.getElementById('confirm-modal').classList.add('active');
}

function closeConfirmModal(confirmed) {
    document.getElementById('confirm-modal').classList.remove('active');
    if (confirmed && pendingConfirmAction) {
        pendingConfirmAction();
    }
    pendingConfirmAction = null;

}

let pendingInputAction = null;
function showInputModal(title, currentValue, onConfirm) {
    document.getElementById('input-modal-title').textContent = title;
    var input = document.getElementById('input-modal-input');
    input.value = currentValue || '';
    pendingInputAction = onConfirm;
    document.getElementById('input-modal').classList.add('active');
    setTimeout(function() {
        input.focus();
        input.select();
    }, 50);
}

function closeInputModal(confirmed) {
    var modal = document.getElementById('input-modal');
    var value = document.getElementById('input-modal-input').value;
    modal.classList.remove('active');
    if (confirmed && pendingInputAction) {
        pendingInputAction(value);
    }
    pendingInputAction = null;
}

// Toast notification
let toastTimeout = null;
function showNotificationModal(message, isSuccess) {
    const toast = document.getElementById('notification-modal');
    document.getElementById('notification-modal-text').textContent = message;
    if (toastTimeout) clearTimeout(toastTimeout);
    toast.classList.remove('success');
    if (isSuccess) toast.classList.add('success');
    toast.classList.add('active');
    toastTimeout = setTimeout(closeNotificationModal, isSuccess ? 2000 : 3000);
}

function closeNotificationModal() {
    const toast = document.getElementById('notification-modal');
    toast.classList.remove('active');
    if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null; }
    setTimeout(() => toast.classList.remove('success'), 300);
}

// Lagrer scroll-posisjoner for det underliggende viewet før vi skjuler det
// (display: none → flex resetter scrollTop til 0).
function _saveScrollPositions() {
    var positions = { window: window.scrollY || window.pageYOffset || 0 };
    var activeView = document.querySelector('.view.active');
    if (activeView) positions.view = { el: activeView, top: activeView.scrollTop };
    document.querySelectorAll('.view.active .modal-body, .view.active .mobile-form-content').forEach(function(el, idx) {
        positions['child' + idx] = { el: el, top: el.scrollTop };
    });
    return positions;
}
function _restoreScrollPositions(positions) {
    if (!positions) return;
    requestAnimationFrame(function() {
        if (positions.view && positions.view.el) positions.view.el.scrollTop = positions.view.top;
        Object.keys(positions).forEach(function(k) {
            if (k.indexOf('child') === 0 && positions[k].el) positions[k].el.scrollTop = positions[k].top;
        });
        window.scrollTo(0, positions.window);
    });
}

// Validate DD.MM.YYYY format and return Date object or null
function parseDateDMY(str) {
    if (!str) return null;
    var m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return null;
    var d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
    if (d.getDate() !== parseInt(m[1]) || d.getMonth() !== parseInt(m[2]) - 1) return null;
    return d;
}

// Init date input: comma→dot, validate on blur
function initDateInput(input) {
    if (!input || input._dateInitDone) return;
    input._dateInitDone = true;
    // Create error message element
    var errMsg = document.createElement('div');
    errMsg.className = 'date-error-msg';
    errMsg.textContent = 'Ugyldig dato. Bruk DD.MM.ÅÅÅÅ';
    errMsg.style.display = 'none';
    input.parentNode.appendChild(errMsg);

    function showDateError(show) {
        if (show) {
            input.classList.add('date-invalid');
            errMsg.style.display = '';
        } else {
            input.classList.remove('date-invalid');
            errMsg.style.display = 'none';
        }
    }

    input.addEventListener('input', function() {
        this.value = this.value.replace(/,/g, '.');
        var val = this.value.trim();
        showDateError(val && !parseDateDMY(val));
    });
    input.addEventListener('blur', function() {
        var val = this.value.trim();
        if (!val) { showDateError(false); return; }
        showDateError(!parseDateDMY(val));
    });
}

// Format today's date as DD.MM.YYYY
function formatDate(date) {
    const d = date.getDate().toString().padStart(2, '0');
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const y = date.getFullYear();
    return `${d}.${m}.${y}`;
}

// Get ISO 8601 week number
function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Signering-dato: alltid dagens dato, unntatt når man åpner et sendt skjema.
// Regelen er enkel — denne helperen kapsler den inn slik at alle kall-steder
// (ny, last, startup, konvertering, eksport) ser lik ut.
function _setSigneringDatoToday() {
    var today = formatDate(new Date());
    var sd = document.getElementById('signering-dato');
    var msd = document.getElementById('mobile-signering-dato');
    if (sd) sd.value = today;
    if (msd) msd.value = today;
}

function _setUkeToToday() {
    var week = String(getWeekNumber(new Date()));
    var d = document.getElementById('dato');
    var md = document.getElementById('mobile-dato');
    if (d) d.value = week;
    if (md) md.value = week;
    // Uke-feltet styrer «Timer uke X»-chipen — oppdater den når uken endres
    // (f.eks. ved duplisering: setFormData satte gammel uke, så settes dagens her).
    if (typeof updateTimerChip === 'function') updateTimerChip();
}

// Check if mobile/tablet (≤1024px) or PC (>1024px)
function isMobile() {
    return window.innerWidth <= 1024;
}

// Auto-resize textarea to fit content (maxLines caps visible lines)
function autoResizeTextarea(textarea, maxLines) {
    textarea.style.overflow = 'hidden';
    textarea.rows = 1;
    textarea.style.height = 'auto';
    void textarea.offsetHeight;
    var scrollH = textarea.scrollHeight;
    var cs = getComputedStyle(textarea);
    var border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    var height = scrollH + border;
    if (maxLines) {
        var lineH = parseFloat(cs.lineHeight);
        var pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        var maxH = Math.ceil(lineH * maxLines + pad + border);
        height = Math.min(height, maxH);
    }
    var minH = textarea.classList.contains('work-material') ? 18 : 24;
    textarea.style.height = Math.max(height, minH) + 'px';
}

// Inline auto-ekspandering for merknad-feltet i ordreseddel.
// Vokser uten øvre grense og holder bunnen synlig over tastaturet.
// Scroller kun når høyden faktisk endret seg (ny linje), og bruker instant
// scroll for å unngå konflikt med browserens egen cursor-following.
// Finn nærmeste scrollable forelder (overflow: auto/scroll). Faller tilbake
// til document.scrollingElement hvis ingen finnes.
function _findScrollableAncestor(el) {
    var p = el.parentElement;
    while (p && p !== document.body) {
        var cs = getComputedStyle(p);
        var oy = cs.overflowY;
        if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return p;
        p = p.parentElement;
    }
    return document.scrollingElement || document.documentElement;
}

// Sikrer at textareaens bunn er synlig over toolbar/tastatur.
// Bruker visualViewport når tilgjengelig for å håndtere åpent tastatur korrekt.
// Fokuser-resize uten å flytte tappet linje. Tekstarea med `overflow:hidden`
// kan ha vist deler av innholdet via intern scrollTop (resterende linjer
// «skjult» over/under). autoResizeTextarea ekspanderer textareaen til å
// vise ALT innhold (og nullstiller textarea.scrollTop). Det «åpenbarer»
// tidligere skjulte linjer over den tappede posisjonen — visuelt hopper
// den tappede linja nedover på skjermen. For å holde den tappede linja
// på samme skjerm-Y kompenserer vi ved å scrolle siden ned med eksakt
// det antallet piksler som var skjult over (= textarea.scrollTop før
// resize). Brukes site-wide for alle multilinje-felt med auto-resize.
function _focusResizeWithoutShift(textarea) {
    var scroller = _findScrollableAncestor(textarea);
    var preTextareaScrollTop = textarea.scrollTop || 0;
    autoResizeTextarea(textarea);
    if (preTextareaScrollTop > 0 && scroller) {
        scroller.scrollTop += preTextareaScrollTop;
    }
    textarea._initialScrollOnFocus = scroller ? scroller.scrollTop : 0;
}

function _ensureTextareaBottomVisible(textarea) {
    if (!textarea || !document.body.contains(textarea)) return;
    var rect = textarea.getBoundingClientRect();
    var visualH = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    var toolbarEl = document.querySelector('.toolbar');
    var toolbarH = 0;
    if (toolbarEl) {
        var tbStyle = getComputedStyle(toolbarEl);
        if (tbStyle.position === 'fixed' && tbStyle.display !== 'none') {
            toolbarH = toolbarEl.offsetHeight;
        }
    }
    var targetBottom = visualH - toolbarH - 8;
    if (rect.bottom > targetBottom) {
        var scroller = _findScrollableAncestor(textarea);
        if (scroller) scroller.scrollTop += rect.bottom - targetBottom;
    }
}

function _autoResizeMerknadAndScroll(textarea) {
    var prevHeight = textarea.offsetHeight;
    autoResizeTextarea(textarea);  // ingen maxLines = ubegrenset vekst
    var newHeight = textarea.offsetHeight;
    if (newHeight === prevHeight || document.activeElement !== textarea) return;

    // Scroll-target: alltid textareas egen bunn, med smal buffer over toolbar.
    // Slik blir textareas bunn-border synlig rett over toolbar — neste felt
    // (Materialer-label etc.) eller kortets border-bottom havner under toolbar
    // og er ikke synlig. Dette er konsistent for både beskrivelse (første felt)
    // og merknad (siste felt).
    var rect = textarea.getBoundingClientRect();
    var visualH = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    // Trekk fra fixed toolbar-høyde hvis den dekker bunnen av viewport (typisk når
    // tastatur er lukket — toolbar er position:fixed bottom:0).
    var toolbarEl = document.querySelector('.toolbar');
    var toolbarH = 0;
    if (toolbarEl) {
        var tbStyle = getComputedStyle(toolbarEl);
        if (tbStyle.position === 'fixed' && tbStyle.display !== 'none') {
            toolbarH = toolbarEl.offsetHeight;
        }
    }
    var targetBottom = visualH - toolbarH - 8;  // smal buffer — kun textareas egen bunn synlig
    var scroller = _findScrollableAncestor(textarea);

    if (newHeight > prevHeight) {
        // VEKST: scroll opp kun hvis bunnen havner under tastatur-toppen.
        if (rect.bottom > targetBottom) {
            scroller.scrollTop += rect.bottom - targetBottom;
        }
    } else {
        // KRYMPING: gi tilbake scroll mot opprinnelig posisjon (lagret ved focus).
        // Aldri scroll forbi der vi var da feltet ble fokusert — så hvis brukeren
        // ikke har akkumulert scroll under skriving, skjer ingen scroll.
        var initial = textarea._initialScrollOnFocus;
        if (typeof initial === 'number' && scroller.scrollTop > initial) {
            var giveback = Math.min(prevHeight - newHeight, scroller.scrollTop - initial);
            scroller.scrollTop -= giveback;
        }
    }

    // Defensiv sjekk: etter alle scroll-justeringer, sikre at bunnen er synlig.
    // Fanger opp tilfeller hvor giveback ikke kompenserte nok, eller hvor
    // textareaen er deeper i sidens layout enn tidligere antatt.
    requestAnimationFrame(function() {
        _ensureTextareaBottomVisible(textarea);
    });
}


// Fakturaadresse: combine/parse helpers + popup
function combineFakturaadresse(gate, postnr, poststed) {
    var parts = [];
    if (gate) parts.push(gate);
    var postal = [postnr, poststed].filter(Boolean).join(' ');
    if (postal) parts.push(postal);
    return parts.join(', ');
}

function parseFakturaadresse(str) {
    if (!str) return { gate: '', postnr: '', poststed: '' };
    var lastComma = str.lastIndexOf(', ');
    if (lastComma === -1) return { gate: str, postnr: '', poststed: '' };
    var gate = str.substring(0, lastComma);
    var rest = str.substring(lastComma + 2);
    var spaceIdx = rest.indexOf(' ');
    if (spaceIdx === -1) return { gate: gate, postnr: '', poststed: rest };
    return {
        gate: gate,
        postnr: rest.substring(0, spaceIdx),
        poststed: rest.substring(spaceIdx + 1)
    };
}

var _fakturaadresseTarget = null;

function openFakturaadressePopup(target) {

    _fakturaadresseTarget = target;
    var currentVal = '';
    var titleKey = 'label_fakturaadresse';
    var copyBtn = document.getElementById('fak-popup-copy-other');
    if (target === 'form') {
        currentVal = document.getElementById('mobile-fakturaadresse').value;
        if (copyBtn) copyBtn.style.display = 'none';
    } else if (target === 'template-levering') {
        currentVal = document.getElementById('tpl-edit-leveringsadresse').value;
        titleKey = 'kappe_section_delivery';
        if (copyBtn) {
            copyBtn.style.display = '';
            copyBtn.textContent = (typeof t === 'function') ? t('fak_use_fakturaadresse') : 'Bruk fakturaadresse';
        }
        document.getElementById('template-editor-overlay').classList.remove('active');
    } else {
        currentVal = document.getElementById('tpl-edit-fakturaadresse').value;
        if (copyBtn) {
            copyBtn.style.display = '';
            copyBtn.textContent = (typeof t === 'function') ? t('fak_use_leveringsadresse') : 'Bruk leveringsadresse';
        }
        document.getElementById('template-editor-overlay').classList.remove('active');
    }
    var titleEl = document.getElementById('fak-popup-title');
    if (titleEl) titleEl.textContent = (typeof t === 'function') ? t(titleKey) : (titleKey === 'kappe_section_delivery' ? 'Leveringsadresse' : 'Fakturaadresse');
    var parsed = parseFakturaadresse(currentVal);
    document.getElementById('fak-popup-gate').value = parsed.gate;
    document.getElementById('fak-popup-postnr').value = parsed.postnr;
    document.getElementById('fak-popup-poststed').value = parsed.poststed;
    document.getElementById('fakturaadresse-popup').classList.add('active');
    setTimeout(function() { document.getElementById('fak-popup-gate').focus(); }, 100);
}

function _fakCopyFromOther() {
    var sourceId;
    if (_fakturaadresseTarget === 'template-levering') {
        sourceId = 'tpl-edit-fakturaadresse';
    } else if (_fakturaadresseTarget === 'template') {
        sourceId = 'tpl-edit-leveringsadresse';
    } else {
        return;
    }
    var sourceEl = document.getElementById(sourceId);
    var val = sourceEl ? sourceEl.value : '';
    if (!val) return;
    var parsed = parseFakturaadresse(val);
    document.getElementById('fak-popup-gate').value = parsed.gate || '';
    document.getElementById('fak-popup-postnr').value = parsed.postnr || '';
    document.getElementById('fak-popup-poststed').value = parsed.poststed || '';
}

function closeFakturaadressePopup() {
    document.getElementById('fakturaadresse-popup').classList.remove('active');
    if (_fakturaadresseTarget === 'template' || _fakturaadresseTarget === 'template-levering') {
        document.getElementById('template-editor-overlay').classList.add('active');
    }
    _fakturaadresseTarget = null;

}

function confirmFakturaadressePopup() {
    var gate = document.getElementById('fak-popup-gate').value.trim();
    var postnr = document.getElementById('fak-popup-postnr').value.trim();
    var poststed = document.getElementById('fak-popup-poststed').value.trim();
    var combined = combineFakturaadresse(gate, postnr, poststed);

    if (_fakturaadresseTarget === 'form') {
        document.getElementById('mobile-fakturaadresse').value = combined;
        updateFakturaadresseDisplay('fakturaadresse-display-text', combined);
    } else if (_fakturaadresseTarget === 'template') {
        document.getElementById('tpl-edit-fakturaadresse').value = combined;
        updateFakturaadresseDisplay('tpl-fakturaadresse-display-text', combined);
    } else if (_fakturaadresseTarget === 'template-levering') {
        document.getElementById('tpl-edit-leveringsadresse').value = combined;
        updateFakturaadresseDisplay('tpl-leveringsadresse-display-text', combined);
    }
    closeFakturaadressePopup();
}

function updateFakturaadresseDisplay(spanId, value) {
    var span = document.getElementById(spanId);
    if (!span) return;
    if (value) {
        span.textContent = value;
        span.className = 'fakturaadresse-display-text';
    } else {
        span.textContent = '';
        span.className = 'fakturaadresse-display-placeholder';
    }
}

// Convert textareas to divs for export (divs wrap text properly)
function convertTextareasToDiv() {
    const convertedElements = [];

    // Convert ordreseddel-nr input to span (fixes rendering issues with html2canvas)
    const ordreseddelInput = document.getElementById('ordreseddel-nr');
    if (ordreseddelInput) {
        const span = document.createElement('span');
        span.textContent = ordreseddelInput.value;
        span.className = 'ordreseddel-nr-converted';
        ordreseddelInput.style.display = 'none';
        ordreseddelInput.parentNode.insertBefore(span, ordreseddelInput.nextSibling);
        convertedElements.push({ original: ordreseddelInput, replacement: span });
    }

    // Kanonisk uke-etikett i eksport-visningen. Feltet er fritekst, så «30 & 31»,
    // «31 & 30» og «30, ,31» skal alle bli det samme på kundedokumentet.
    const datoInput = document.getElementById('dato');
    if (datoInput && datoInput.value) {
        const originalValue = datoInput.value;
        const ukeLabel = formatUkeLabel(originalValue);
        if (ukeLabel !== originalValue) {
            datoInput.value = ukeLabel;
            convertedElements.push({ datoInput: datoInput, originalValue: originalValue });
        }
    }

    return convertedElements;
}

// Restore textareas after export
function restoreTextareas(convertedElements) {
    convertedElements.forEach(item => {
        if (item.datoInput) {
            item.datoInput.value = item.originalValue;
        } else if (item.original && item.replacement) {
            item.original.style.display = '';
            item.replacement.remove();
        }
    });
}

// ── Utklippstavle: ÉN vei for hele appen ────────────────────────────────────
// Alle «Kopier»-knapper (ordrenummer i skjemaet, i Lagret-lista, i servicebil-
// lista, kappe-tekst, stoppeklokke) går gjennom copyTextToClipboard.
//
// Hvorfor: navigator.clipboard.writeText() feiler jevnlig i praksis — den
// avvises med NotAllowedError når dokumentet ikke har fokus (typisk rett etter
// at tastaturet lukkes, eller når appen nettopp kom tilbake i forgrunnen), og
// navigator.clipboard finnes ikke i det hele tatt i usikker kontekst eller
// eldre WebView. Da MÅ vi ha en fallback, og vi må aldri påstå at noe ble
// kopiert når det ikke ble det: en falsk «Kopiert!» er verre enn en feilmelding,
// fordi brukeren først oppdager det når limingen er tom.

// Synkron fallback via execCommand. Bruker et usynlig <span> + Range i stedet
// for en <textarea>: en textarea må fokuseres for at select() skal virke, og
// fokus på et tekstfelt spretter opp skjermtastaturet på mobil. Et Range-utvalg
// på et ikke-redigerbart element kopierer uten å røre fokus i det hele tatt.
// Returnerer om kopieringen FAKTISK lyktes.
function _execCommandCopy(text) {
    var span = null, sel = null, prevRanges = [];
    try {
        span = document.createElement('span');
        span.textContent = text;
        span.style.cssText = 'position:fixed;top:0;left:-9999px;white-space:pre;user-select:text;';
        document.body.appendChild(span);
        sel = window.getSelection();
        for (var i = 0; i < sel.rangeCount; i++) prevRanges.push(sel.getRangeAt(i));
        sel.removeAllRanges();
        var range = document.createRange();
        range.selectNodeContents(span);
        sel.addRange(range);
        var ok = document.execCommand('copy');
        return !!ok;
    } catch (e) {
        return false;
    } finally {
        // Rydd opp uansett utfall — og legg tilbake brukerens eget tekstutvalg.
        try {
            if (sel) {
                sel.removeAllRanges();
                prevRanges.forEach(function(r) { try { sel.addRange(r); } catch (e) {} });
            }
            if (span && span.parentNode) span.parentNode.removeChild(span);
        } catch (e) {}
    }
}

// Kopier tekst og gi ÆRLIG tilbakemelding. okMsg/failMsg er valgfrie.
function copyTextToClipboard(text, okMsg, failMsg) {
    text = (text == null) ? '' : String(text);
    if (!text) return;
    var ok = function() { showNotificationModal(okMsg || t('copied_to_clipboard'), true); };
    var fail = function() { showNotificationModal(failMsg || t('copy_failed')); };
    // Mangler async-API-et (usikker kontekst / eldre WebView): gå rett på
    // execCommand mens vi fortsatt er inne i brukerens trykk.
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
        _execCommandCopy(text) ? ok() : fail();
        return;
    }
    try {
        navigator.clipboard.writeText(text).then(ok, function() {
            _execCommandCopy(text) ? ok() : fail();
        });
    } catch (e) {
        // writeText kan kaste synkront (bl.a. når navigator.clipboard finnes,
        // men er avskrudd av policy).
        _execCommandCopy(text) ? ok() : fail();
    }
}

function copyOrderNumber() {
    // Leser .value (ikke DOM-utvalg) — virker også når feltet er disabled på et
    // sendt skjema, der den gamle input.select()-fallbacken var en no-op.
    const nr = document.getElementById('mobile-ordreseddel-nr').value;
    copyTextToClipboard(nr);
}

// --- Order card functions ---
const deleteIcon = '<svg viewBox="4 2 16 20" width="24" height="24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
const editIcon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
const copyIcon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
const duplicateIcon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/><path d="M12 10h2v3h3v2h-3v3h-2v-3h-2v-2h2v-3z"/></svg>';

function createOrderCard(orderData, expanded) {
    const card = document.createElement('div');
    card.className = 'mobile-order-card';

    const desc = orderData.description || '';

    card.innerHTML = `
        <div class="mobile-order-header" onclick="toggleOrder(this)">
            <span class="mobile-order-arrow">${expanded ? '&#9650;' : '&#9660;'}</span>
            <span class="mobile-order-title"></span>
            <button type="button" class="mobile-order-header-delete" onclick="event.stopPropagation(); removeOrder(this)">${deleteIcon}</button>
        </div>
        <div class="mobile-order-body-wrap${expanded ? ' expanded' : ''}">
        <div class="mobile-order-body">
            <div class="mobile-field${((cachedRequiredSettings || getDefaultRequiredSettings()).save.beskrivelse !== false) ? ' field-required' : ''}">
                <label data-i18n="order_description">${t('order_description')}</label>
                <textarea class="mobile-order-desc" rows="1" autocapitalize="sentences"></textarea>
            </div>
            <div class="mobile-field${cachedRequiredSettings && cachedRequiredSettings.save && cachedRequiredSettings.save.merknad ? ' field-required' : ''}">
                <label data-i18n="order_merknad">${t('order_merknad')}</label>
                <textarea class="mobile-order-merknad" rows="1" autocapitalize="sentences"></textarea>
            </div>
            <div class="mobile-order-materials-section${cachedRequiredSettings && cachedRequiredSettings.save && cachedRequiredSettings.save.materialer ? ' field-required' : ''}">
                <label class="mobile-order-sublabel" data-i18n="order_materials_label">${t('order_materials_label')}</label>
                <div class="mobile-order-materials"></div>
                <button type="button" class="mobile-add-mat-btn" onclick="openMaterialPicker(this)">+ ${t('order_add_material')}</button>
                <button type="button" class="section-skip-link" onclick="toggleOrderSkip(this, 'materier')" data-i18n="order_skip_materialer">${t('order_skip_materialer')}</button>
                <div class="section-skip-status" hidden>
                    <span class="section-skip-icon">✓</span>
                    <span class="section-skip-text" data-i18n="order_skipped_materialer">${t('order_skipped_materialer')}</span>
                    <button type="button" class="section-skip-undo" onclick="toggleOrderSkip(this, 'materier')" data-i18n="btn_undo">${t('btn_undo')}</button>
                </div>
            </div>
            <div class="mobile-field mobile-field--plan-hidden" style="display:none">
                <label data-i18n="order_plan">${t('order_plan')}</label>
                <button type="button" class="mobile-plan-btn" onclick="openPlanPicker(this)">+ ${t('order_plan')}</button>
                <div class="plan-display" onclick="openPlanPicker(this)">
                    <span class="plan-display-text"></span>
                    <span class="fakturaadresse-chevron">›</span>
                </div>
            </div>
            <div class="mobile-field mobile-order-arbeidstid-section${cachedRequiredSettings && cachedRequiredSettings.save && cachedRequiredSettings.save.dager ? ' field-required' : ''}">
                <label data-i18n="order_days_section">${t('order_days_section')}</label>
                <button type="button" class="mobile-arbeidstid-btn" onclick="openDagTimerModal(this)">+ ${t('order_days_section')}</button>
                <div class="dag-timer-display" onclick="openDagTimerModal(this)">
                    <span class="dag-timer-display-text"></span>
                    <span class="fakturaadresse-chevron">›</span>
                </div>
                <button type="button" class="section-skip-link" onclick="toggleOrderSkip(this, 'dager')" data-i18n="order_skip_arbeidstid">${t('order_skip_arbeidstid')}</button>
                <div class="section-skip-status" hidden>
                    <span class="section-skip-icon">✓</span>
                    <span class="section-skip-text" data-i18n="order_skipped_arbeidstid">${t('order_skipped_arbeidstid')}</span>
                    <button type="button" class="section-skip-undo" onclick="toggleOrderSkip(this, 'dager')" data-i18n="btn_undo">${t('btn_undo')}</button>
                </div>
            </div>
        </div>
        </div>`;

    // Set description — inline auto-resize uten øvre grense (samme mønster som merknad)
    const descInput = card.querySelector('.mobile-order-desc');
    descInput.value = desc;
    descInput.addEventListener('focus', function() {
        _focusResizeWithoutShift(this);
    });
    descInput.addEventListener('input', function() {
        _autoResizeMerknadAndScroll(this);
        updateOrderTitle(card);
    });
    descInput.addEventListener('blur', function() {
        autoResizeTextarea(this);
    });
    requestAnimationFrame(function() {
        _autoResizeMerknadAndScroll(descInput);
    });

    // Update order title from description
    updateOrderTitle(card);

    // Set dager, timer og etasjer på kortet.
    // Per-dag etasjer er primær (orderData.dayPlans = {ma: 'U3, U2', ti: 'U1'}).
    // Bestilling-nivå (orderData.plans) støttes kun for bakoverkompatibilitet —
    // _getCardDayPlans replikerer plans til dager med timer ved første lesning.
    const dager = orderData.dager || [];
    const timerData = orderData.timer || {};
    const dayPlansData = (orderData.dayPlans && typeof orderData.dayPlans === 'object') ? orderData.dayPlans : {};
    var plansData = Array.isArray(orderData.plans) ? orderData.plans.slice() : [];
    card.setAttribute('data-dager', JSON.stringify(dager));
    card.setAttribute('data-timer', JSON.stringify(typeof timerData === 'object' ? timerData : {}));
    card.setAttribute('data-day-plans', JSON.stringify(dayPlansData));
    card.setAttribute('data-plans', JSON.stringify(plansData));
    updateDagTimerSummary(card);

    // Set plan
    const planDisplay = card.querySelector('.plan-display');
    const planText = planDisplay.querySelector('.plan-display-text');
    const planVal = orderData.plan || '';
    planDisplay.setAttribute('data-plan', planVal);
    planText.textContent = planVal;
    const planBtn = card.querySelector('.mobile-plan-btn');
    if (planVal) {
        planBtn.style.display = 'none';
    } else {
        planDisplay.style.display = 'none';
    }

    // Set merknad — inline auto-resize uten øvre grense
    const merknadEl = card.querySelector('.mobile-order-merknad');
    merknadEl.value = orderData.merknad || '';
    merknadEl.addEventListener('focus', function() {
        // Re-kalkuler høyde ved focus — fanger opp tilfeller hvor textarea har stale
        // inline height fra tidligere innhold (f.eks. etter navigasjon tilbake til skjema).
        // Kompenserer for intern scroll-redistribusjon så tappet linje står stille.
        _focusResizeWithoutShift(this);
    });
    merknadEl.addEventListener('input', function() {
        _autoResizeMerknadAndScroll(this);
    });
    merknadEl.addEventListener('blur', function() {
        autoResizeTextarea(this);
    });
    requestAnimationFrame(function() {
        _autoResizeMerknadAndScroll(merknadEl);
    });

    // Add materials
    const matContainer = card.querySelector('.mobile-order-materials');
    const mats = orderData.materials && orderData.materials.length > 0 ? orderData.materials : [];
    renderMaterialSummary(matContainer, mats);

    // "Ikke aktuelt"-flagg per seksjon. Lar brukeren bekrefte at bestillingen
    // bevisst ikke har materialer eller arbeidstid uten å miste required-
    // validering på tilfeller hvor det glemmes. Lagres som data-attributter
    // på kortet og persisteres via getOrdersData (materierSkipped/dagerSkipped).
    if (orderData.materierSkipped === true) card.setAttribute('data-skip-materier', 'true');
    if (orderData.dagerSkipped === true) card.setAttribute('data-skip-dager', 'true');
    _updateOrderSkipUI(card);

    return card;
}

// Oppdaterer UI-tilstanden for "Ikke aktuelt"-knapp/-status i en ordre-kort
// (eller service-entry). Tre tilstander pr seksjon:
//   1. FILLED  — innhold finnes → skjul skip-link + skip-status (skip-flagget
//                fjernes implisitt siden brukeren har fylt ut)
//   2. EMPTY   — ingen innhold, ikke markert som "ikke aktuelt" → vis
//                "+ Add"-knapp og skip-link, skjul status
//   3. SKIPPED — ingen innhold, men eksplisitt markert "ikke aktuelt" → skjul
//                "+ Add"-knapp og skip-link, vis status-pille
// Kalles fra createOrderCard, etter renderMaterialSummary, etter
// updateDagTimerSummary, og fra toggleOrderSkip selv.
function _updateOrderSkipUI(card) {
    if (!card) return;
    // Materialer-seksjon (gjelder også service-entry-card)
    var matSection = card.querySelector('.mobile-order-materials-section');
    if (matSection) {
        var matRows = matSection.querySelectorAll('.mobile-material-row');
        var matLink = matSection.querySelector('.section-skip-link');
        var matStatus = matSection.querySelector('.section-skip-status');
        var matBtn = matSection.querySelector('.mobile-add-mat-btn');
        var matSkipped = card.getAttribute('data-skip-materier') === 'true';
        if (matRows.length > 0) {
            // FILLED — implisitt fjern stale skip-flagg
            card.removeAttribute('data-skip-materier');
            matSkipped = false;
        }
        if (matBtn) matBtn.style.display = matSkipped ? 'none' : '';
        if (matLink) matLink.hidden = matSkipped || matRows.length > 0;
        if (matStatus) matStatus.hidden = !matSkipped;
    }
    // Arbeidstid-seksjon (kun på .mobile-order-card, ikke service-entry)
    var dagSection = card.querySelector('.mobile-order-arbeidstid-section');
    if (dagSection) {
        var timer = {};
        try { timer = JSON.parse(card.getAttribute('data-timer') || '{}') || {}; } catch (e) {}
        var plans = (typeof _getCardPlans === 'function') ? _getCardPlans(card) : [];
        var dagOrder = ['ma','ti','on','to','fr','lo','so','_generelt'];
        var hasTimer = dagOrder.some(function(d) {
            return !!(timer[d] && String(timer[d]).trim());
        });
        var hasContent = hasTimer || plans.length > 0;
        var dagLink = dagSection.querySelector('.section-skip-link');
        var dagStatus = dagSection.querySelector('.section-skip-status');
        var dagBtn = dagSection.querySelector('.mobile-arbeidstid-btn');
        var dagDisplay = dagSection.querySelector('.dag-timer-display');
        var dagSkipped = card.getAttribute('data-skip-dager') === 'true';
        if (hasContent) {
            // FILLED — implisitt fjern stale skip-flagg
            card.removeAttribute('data-skip-dager');
            dagSkipped = false;
        }
        // Tre tilstander for knapp + display:
        //   SKIPPED       → skjul begge (status-pillen tar plassen)
        //   FILLED        → skjul knapp, vis display
        //   EMPTY         → vis knapp, skjul display
        // Speiler logikken i updateDagTimerSummary uten å kalle den (ville gitt
        // gjensidig rekursjon siden den kaller _updateOrderSkipUI).
        if (dagSkipped) {
            if (dagBtn) dagBtn.style.display = 'none';
            if (dagDisplay) dagDisplay.style.display = 'none';
        } else {
            if (dagBtn) dagBtn.style.display = hasContent ? 'none' : '';
            if (dagDisplay) dagDisplay.style.display = hasContent ? '' : 'none';
        }
        if (dagLink) dagLink.hidden = dagSkipped || hasContent;
        if (dagStatus) dagStatus.hidden = !dagSkipped;
    }
}

// Toggle "Ikke aktuelt"-flagget for en seksjon. Kalt fra både skip-link og
// "Angre"-knapp (samme handler — toggler current state).
function toggleOrderSkip(btn, kind) {
    var card = btn.closest('.mobile-order-card') || btn.closest('.service-entry-card');
    if (!card) return;
    var attr = (kind === 'dager') ? 'data-skip-dager' : 'data-skip-materier';
    if (card.getAttribute(attr) === 'true') {
        card.removeAttribute(attr);
    } else {
        card.setAttribute(attr, 'true');
    }
    _updateOrderSkipUI(card);
    // Persisterer state via samme debounced session-save som annen input.
    if (typeof debouncedSessionSave === 'function') debouncedSessionSave();
    if (typeof debouncedServiceSessionSave === 'function'
        && card.closest('#service-entries')) {
        debouncedServiceSessionSave();
    }
}
window.toggleOrderSkip = toggleOrderSkip;
window._updateOrderSkipUI = _updateOrderSkipUI;

// Pipe sealant helpers
// Kommer produktet i FASTE størrelser (ferdige mansjetter) i stedet for på rull?
// Samme kilde som gaten i getRunningMeterInfo under — popupene må kunne spørre om
// dette for å skjule «+ LM» / meter-toggelen. (Eske-radens mål-felt er IKKE gated
// på dette lenger — det er valgfritt og vises for alle spec-produkter.)
function isFixedSizeMaterial(baseName) {
    if (!baseName) return false;
    var allMats = cachedMaterialOptions || [];
    for (var i = 0; i < allMats.length; i++) {
        if (allMats[i] && allMats[i].name === baseName) return !!allMats[i].fixedSize;
    }
    return false;
}

function getRunningMeterInfo(matName) {
    if (!matName) return null;
    var allMats = cachedMaterialOptions || [];
    for (var i = 0; i < allMats.length; i++) {
        var m = allMats[i];
        // !m.fixedSize: produkter i FASTE størrelser (ferdige mansjetter, f.eks.
        // Promastop FC6) omregnes ikke til løpemeter — de bestilles i stk, og en
        // meter-sum på tvers av ulike diametere summerer ulike varenummer.
        // Rullprodukter (FSC) beholder omregningen: der er meter det som bestilles.
        // Denne ENE porten er grunnen til at flagget virker i alle 8 kallsteder.
        if ((m.type === 'mansjett' || m.type === 'brannpakning') && !m.fixedSize && matName.toLowerCase().startsWith(m.name.toLowerCase() + ' ')) {
            var rest = matName.substring(m.name.length + 1);
            // Normalize "Ø100mm 2 lag" / "90x90mm 3 lag" → "Ø100mmr2" / "90x90mmr3"
            rest = rest.replace(/mm (\d+) lag$/, 'mmr$1');
            // Strip "mm" suffix before parsing
            rest = rest.replace(/mm(?=r\d+$|$)/, '');
            // Parse round "ø50" / "Ø50" / "ø50r2" or square "90x90" / "90x90r2"
            var roundMatch = rest.match(/^[øØ](\d+(?:[.,]\d+)?)(?:r(\d+))?$/);
            if (roundMatch) {
                var diameter = parseFloat(roundMatch[1].replace(',', '.'));
                var rounds = roundMatch[2] ? parseInt(roundMatch[2], 10) : 1;
                return { baseName: m.name, diameter: diameter, rounds: rounds, isSquare: false };
            }
            var squareMatch = rest.match(/^(\d+)x(\d+)(?:r(\d+))?$/);
            if (squareMatch) {
                var width = parseInt(squareMatch[1], 10);
                var height = parseInt(squareMatch[2], 10);
                var sqRounds = squareMatch[3] ? parseInt(squareMatch[3], 10) : 1;
                return { baseName: m.name, width: width, height: height, rounds: sqRounds, isSquare: true };
            }
        }
    }
    return null;
}

function calculateRunningMeters(info, quantity) {
    if (!info || !quantity || isNaN(quantity)) return 0;
    var circumference;
    if (info.isSquare) {
        circumference = 2 * (info.width + info.height);
    } else {
        circumference = Math.PI * info.diameter;
    }
    return circumference * info.rounds * quantity / 1000;
}

function formatRunningMeters(value) {
    var num = parseFloat(String(value).replace(',', '.'));
    if (!num || isNaN(num)) return '0,0';
    var rounded = Math.ceil(num * 10) / 10;
    return rounded.toFixed(1).replace('.', ',');
}

// Antall TIDELER en meter-verdi vises som — speiler opprundingen i
// formatRunningMeters over. Brukes til gruppe-summene i eksporten så totalen
// alltid er lik summen av de VISTE radverdiene: kunden skal kunne legge sammen
// kolonnen og få samme tall. Summerte man de rå lengdene i stedet, samlet
// opprundingen fra hver rad seg opp til et synlig avvik (0,7+2,1+0,7+3,0 = 6,5
// mot 6,3 for rå sum). Per rad er opprunding riktig — 0,628 m mansjett er ikke
// en bestillbar mengde, 0,7 er — så summen av bestillbare mengder er det som
// faktisk skal bestilles.
// Heltall-tideler (ikke float) så akkumuleringen ikke drar med seg
// flyttallsfeil når mange rader legges sammen.
function meterTenths(value) {
    var num = parseFloat(String(value).replace(',', '.'));
    if (!num || isNaN(num)) return 0;
    return Math.ceil(num * 10);
}

// Formater en tidels-sum tilbake til visningsformat. Ingen ny opprunding — verdien
// er allerede et helt antall tideler.
function formatMeterTenths(tenths) {
    return (tenths / 10).toFixed(1).replace('.', ',');
}

// Meter-total for en spec-gruppe (FSC/FSW/brannpakning). ÉN kilde for tre
// konsumenter: de to eksport-kopiene og ordrekortets sammendrag — regnes den
// inline hver gang, driver de fra hverandre.
//
// Radene viser stk; meter finnes BARE her. Derfor:
//  - dimensjonsrader bidrar via getRunningMeterInfo (rullprodukter; fast-størrelse
//    gir null der og bidrar dermed ingenting → ingen total for FC6)
//  - «Løpende»-rader bidrar med den førte meterverdien
//  - eske-rader bidrar aldri (meter pr. eske er ikke registrert), men flagges så
//    etiketten kan si «Totalt uten esker»
function specGroupMeterTotal(items) {
    var tenths = 0, rows = 0, hasEske = false;
    (items || []).forEach(function(m) {
        if (!m) return;
        if (m.enhet === 'eske') { hasEske = true; return; }
        if (m.source === 'kappe-products') return;   // plater summeres i m², ikke meter
        var antallNum = parseFloat(String(m.antall || '').replace(',', '.'));
        if (isNaN(antallNum)) return;
        var pipeInfo = getRunningMeterInfo(m.name);
        if (pipeInfo && antallNum > 0) {
            tenths += meterTenths(calculateRunningMeters(pipeInfo, antallNum));
            rows++;
        } else if (getMaterialRowUnit(m) === 'meter') {
            tenths += meterTenths(antallNum);
            rows++;
        }
    });
    return { tenths: tenths, rows: rows, hasMeter: rows > 0, hasEske: hasEske };
}

// Etikett for total-raden. Etiketten står i BESKRIVELSE-kolonnen og skal derfor
// ikke inneholde enhetsordet — Enhet-kolonnen sier allerede «meter». Sto en kort
// periode som «Totalt løpemeter», som skrev «meter» to ganger på samme rad;
// nøyaktig samme feil som «Esker · 2 · eske», bare i etiketten.
// «(uten esker)» kun når gruppa faktisk har esker — ellers forklarer skjemaet bort
// noe som ikke finnes. Forbeholdet trengs fordi meter pr. eske ikke er registrert
// noe sted, så eske-radene kan ikke regnes om; uten det ville summen vært for lav
// uten at noen fikk vite det. Parentesen gjør det til et forbehold PÅ totalen, i
// stedet for «Totalt uten esker» som kunne leses som at et antall ble trukket fra.
function specGroupTotalLabel(hasEske) {
    return hasEske ? 'Totalt (uten esker):' : 'Totalt:';
}

function createMaterialSummaryRow(m, groupBaseName) {
    const div = document.createElement('div');
    div.className = 'mobile-material-row';
    div.setAttribute('data-mat-name', m.name || '');
    div.setAttribute('data-mat-antall', m.antall || '');
    div.setAttribute('data-mat-enhet', m.enhet || '');
    div.setAttribute('data-mat-source', m.source || '');
    div.setAttribute('data-mat-quantity-unit', m.quantityUnit || '');
    div.setAttribute('data-mat-bredde', m.bredde || '');
    if (m.specMode) div.setAttribute('data-mat-spec-mode', m.specMode);
    if (m.stiftGroup) div.setAttribute('data-mat-stift-group', '1');
    if (m.plate && (m.plate.length || m.plate.width)) {
        div.setAttribute('data-mat-plate-length', m.plate.length || '');
        div.setAttribute('data-mat-plate-width', m.plate.width || '');
    }
    if (m.lmPerSide) div.setAttribute('data-mat-lm-per-side', m.lmPerSide);
    if (m.antallObjekter) div.setAttribute('data-mat-antall-objekter', m.antallObjekter);
    if (m.sider) div.setAttribute('data-mat-sider', m.sider);
    if (m.kappeOrient) div.setAttribute('data-mat-kappe-orient', m.kappeOrient);
    if (m.kappeIsoGroup) div.setAttribute('data-mat-iso-group', m.kappeIsoGroup);
    if (m.kappeIsoGroupName) div.setAttribute('data-mat-iso-group-name', m.kappeIsoGroupName);
    var nameFormatted;
    if (groupBaseName) {
        // Grouped sub-row: show just the spec/variant part
        var subName = getGroupedDisplayName(m, groupBaseName);
        if (subName) {
            subName = subName.charAt(0).toUpperCase() + subName.slice(1);
            nameFormatted = formatKabelhylseSpec(subName.replace(/ø(?=\d)/g, 'Ø')).replace(/^(.+?)r(\d+)$/, '$1 ($2 lag)').replace(/^(.+?) (\d+) lag$/, '$1 ($2 lag)');
        } else {
            nameFormatted = '';
        }
    } else {
        var rawName = (m.name || '');
        rawName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
        nameFormatted = formatKabelhylseSpec(rawName.replace(/ø(?=\d)/g, 'Ø')).replace(/^(.+?)r(\d+)$/, '$1 ($2 lag)').replace(/^(.+?) (\d+) lag$/, '$1 ($2 lag)');
        nameFormatted += materialVariantSuffix(m);
        // Spec-suffix for isolasjon: bredde-modus → "×160mm" (uten spaces, konsistent med
        // FSC/FSW/Kabelhylse), plate-modus → "(plate)".
        if (m.bredde) {
            nameFormatted += '×' + String(m.bredde).replace(/mm$/i, '') + 'mm';
        } else if (m.specMode === 'plate') {
            nameFormatted += ' (plate)';
        }
        // INGEN eske-suffiks i navnet: Enhet-kolonnen viser «eske» for de radene,
        // og et suffiks her ville gjort den cella dødvekt. Sto tidligere som
        // « (eske)» kun for festemidler, mens den grupperte veien ikke hadde det —
        // de to veiene skrev da samme rad ulikt.
    }
    // Dimensjonsrader viser STK, ikke meter. Meter-omregningen finnes fortsatt, men
    // vises kun i gruppe-totalen (specGroupMeterTotal) \u2014 derfor er \u00ab(N stk)\u00bb-suffikset
    // i navnet ogs\u00e5 fjernet: stykktallet st\u00e5r n\u00e5 i antall-kolonnen. \u00ab(N lag)\u00bb bygges
    // uavhengig lenger opp og beholdes.
    // NB: servicebil-eksporten og bil-historikken viser fortsatt meter pr. linje \u2014
    // de dokumentene har ingen total-rad, s\u00e5 linjen er eneste sted tallet kan st\u00e5.
    nameFormatted = formatDisplayForBreak(nameFormatted);
    const nameText = nameFormatted ? escapeHtml(nameFormatted) : (groupBaseName ? '' : t('placeholder_material'));
    const detailParts = [];
    if (m.source === 'kappe-products') {
        // Kappe-isolasjon i ordreseddel-faktura: vis materialforbruk i m² (= lik eksporten).
        // m² = antall plater × plate-areal; plate-antallet beholdes på kappeskjemaet der montøren kapper.
        // Pre-aggregert rad (samme produkt+tykkelse slått sammen): bruk summen.
        var kappePlateCount = (m.__plateSum != null) ? m.__plateSum : calcKappePlateCount(m);
        if (kappePlateCount > 0) {
            var kappeM2 = (typeof calcKappeAreaM2 === 'function') ? calcKappeAreaM2(m, kappePlateCount) : 0;
            detailParts.push(((typeof formatKappeArea === 'function') ? formatKappeArea(kappeM2) : String(kappeM2)) + ' m²');
        } else if (m.antall) {
            // Fallback hvis bredde/plate-info mangler: fall tilbake til antall + enhet
            var qUnit = getMaterialRowUnit(m);
            var uLabel = qUnit === 'meter' ? ' meter' : ' ' + qUnit;
            detailParts.push(getMaterialRowAntall(m) + uLabel);
        }
    } else {
        if (m.antall) {
            var quantityUnit = getMaterialRowUnit(m);
            var unitLabel = quantityUnit === 'meter' ? ' meter' : ' ' + quantityUnit;
            // getMaterialRowAntall, ikke m.antall: for et rullprodukt er tallet
            // den omregnede LENGDEN, og stykktallet står i navnet.
            detailParts.push(getMaterialRowAntall(m) + unitLabel);
        }
    }
    const detail = detailParts.length > 0 ? detailParts.join(' ') : '';
    div.innerHTML = `
        <div class="mat-summary-row">
            <span class="mat-summary-name">${nameText}</span>
            ${detail ? `<span class="mat-summary-detail">${detail}</span>` : ''}
        </div>`;
    return div;
}

function renderMaterialSummary(matContainer, materials) {
    matContainer.innerHTML = '';
    // Filter out empty and spec-base materials first
    var filtered = materials.filter(function(m) {
        if (!m.name && !m.antall && !m.enhet) return false;
        // Spec-basen ("FSC") er kun en launcher og skal aldri vises som egen rad.
        // Unntak: dimensjonsløse poster lagret rett på basenavnet — løpende meter
        // og esker — som ER ekte data.
        if (cachedMaterialOptions && m.enhet !== 'meter' && m.enhet !== 'eske') {
            var specBase = cachedMaterialOptions.find(function(o) {
                return o.name.toLowerCase() === (m.name || '').toLowerCase() && (o.type === 'mansjett' || o.type === 'brannpakning' || o.type === 'kabelhylse');
            });
            if (specBase) return false;
        }
        return true;
    });
    // Group by base material name
    // sortItems: samme rekkefølge på skjermen som på papiret. Uten den viste
    // ordrekortet innleggingsrekkefølge mens eksporten var sortert — samme data,
    // to ulike rekkefølger.
    var groups = groupMaterialsByBase(filtered, { sortItems: true });
    groups.forEach(function(group) {
        if (!group.isSpecGroup && !group.isIsolationGroup && !group.isStiftGroup) {
            // Standard material or single spec — render flat
            group.items.forEach(function(m) { matContainer.appendChild(createMaterialSummaryRow(m)); });
        } else {
            // Spec group with multiple items — header + indented sub-rows
            var headerDiv = document.createElement('div');
            headerDiv.className = 'mat-summary-group-header';
            var groupTitle = group.displayName || group.baseName;
            headerDiv.textContent = groupTitle.charAt(0).toUpperCase() + groupTitle.slice(1);
            matContainer.appendChild(headerDiv);
            if (group.isIsolationGroup) {
                // Faktura-visning = lik eksporten: én sammenslått linje pr.
                // produkt+tykkelse (summert plater). De EKTE radene beholdes
                // skjult med full data (data-merged-rad telles ikke ved
                // lagring) så bredde/plate/antall ikke går tapt. Festemiddel
                // vises som vanlig (separate rader).
                var isoMap = {}, isoAgg = [], nonIso = [];
                group.items.forEach(function(gm) {
                    if (gm.source !== 'kappe-products') { nonIso.push(gm); return; }
                    var key = (gm.name || '').toLowerCase() + '|' + (gm.enhet || '').toLowerCase();
                    var pc = (typeof calcKappePlateCount === 'function') ? calcKappePlateCount(gm) : 0;
                    if (isoMap[key]) {
                        isoMap[key].__plateSum += pc;
                    } else {
                        // plate bæres med så m²-beregningen får riktig plate-areal (samme produkt+tykkelse → samme plate).
                        isoMap[key] = { name: gm.name, enhet: gm.enhet, source: gm.source, plate: gm.plate, __plateSum: pc };
                        isoAgg.push(isoMap[key]);
                    }
                });
                // Synlig sammenslått rad pr. produkt (matcher eksport).
                isoAgg.forEach(function(agg) {
                    var mRow = createMaterialSummaryRow(agg, group.baseName);
                    mRow.classList.add('mat-summary-grouped');
                    mRow.setAttribute('data-merged', '1');
                    matContainer.appendChild(mRow);
                });
                // Ekte data-rader (skjult) — kilden som lagres/eksporteres.
                group.items.forEach(function(m) {
                    if (m.source !== 'kappe-products') return;
                    var dRow = createMaterialSummaryRow(m, group.baseName);
                    dRow.classList.add('mat-summary-grouped', 'mat-row-data-only');
                    matContainer.appendChild(dRow);
                });
                // Festemiddel: vanlige (synlige) rader.
                nonIso.forEach(function(m) {
                    var fRow = createMaterialSummaryRow(m, group.baseName);
                    fRow.classList.add('mat-summary-grouped');
                    matContainer.appendChild(fRow);
                });
            } else {
                group.items.forEach(function(m) {
                    var subRow = createMaterialSummaryRow(m, group.baseName);
                    subRow.classList.add('mat-summary-grouped');
                    matContainer.appendChild(subRow);
                });
                // Meter-total, samme helper og etikett som eksporten — radene viser
                // stk, så dette er eneste sted meter finnes. Kortet må vise samme tall
                // som PDF-en, ellers ser montøren noe annet enn kunden.
                // data-mat-total: markerer raden som visning-bare, så
                // getMaterialsFromContainer ikke plukker den opp som et material.
                var groupMeter = specGroupMeterTotal(group.items);
                if (groupMeter.hasMeter) {
                    var totRow = document.createElement('div');
                    totRow.className = 'mat-summary-total';
                    totRow.setAttribute('data-mat-total', '1');
                    totRow.innerHTML = '<span class="mat-summary-total-label">'
                        + escapeHtml(specGroupTotalLabel(groupMeter.hasEske)) + '</span>'
                        + '<span class="mat-summary-total-value">'
                        + escapeHtml(formatMeterTenths(groupMeter.tenths)) + ' meter</span>';
                    matContainer.appendChild(totRow);
                }
            }
        }
    });
    _updateAddMatBtnState(matContainer);
}

// Når materialer er lagt til skal "+ Materialer"-knappen vise det tydelig
// (egen stil + endret tekst), så den ikke ser identisk ut tom vs. utfylt.
function _updateAddMatBtnState(matContainer) {
    if (!matContainer) return;
    var section = matContainer.closest('.mobile-order-materials-section');
    var btn = section ? section.querySelector('.mobile-add-mat-btn') : null;
    if (!btn) return;
    var hasMat = !!matContainer.querySelector('.mobile-material-row');
    btn.classList.toggle('has-materials', hasMat);
    btn.textContent = hasMat
        ? t('order_edit_material')
        : '+ ' + t('order_add_material');
}

function getMaterialsFromContainer(matContainer) {
    const materials = [];
    matContainer.querySelectorAll('.mobile-material-row').forEach(row => {
        // Visuell sammenslått isolasjon-rad er kun visning — ikke en ekte
        // material-kilde (de ekte radene ligger skjult med full data).
        if (row.getAttribute('data-merged') === '1') return;
        const name = row.getAttribute('data-mat-name') || '';
        const antall = row.getAttribute('data-mat-antall') || '';
        const enhet = row.getAttribute('data-mat-enhet') || '';
        const source = row.getAttribute('data-mat-source') || '';
        const quantityUnit = row.getAttribute('data-mat-quantity-unit') || '';
        const bredde = row.getAttribute('data-mat-bredde') || '';
        const specMode = row.getAttribute('data-mat-spec-mode') || '';
        const stiftGroup = row.getAttribute('data-mat-stift-group') === '1';
        const plateLength = row.getAttribute('data-mat-plate-length') || '';
        const plateWidth = row.getAttribute('data-mat-plate-width') || '';
        const lmPerSide = row.getAttribute('data-mat-lm-per-side') || '';
        const antallObjekter = row.getAttribute('data-mat-antall-objekter') || '';
        const sider = row.getAttribute('data-mat-sider') || '';
        const kappeOrient = row.getAttribute('data-mat-kappe-orient') || '';
        const kappeIsoGroup = row.getAttribute('data-mat-iso-group') || '';
        const kappeIsoGroupName = row.getAttribute('data-mat-iso-group-name') || '';
        if (name || antall || enhet) {
            var mat = { name, antall, enhet };
            if (source) mat.source = source;
            if (quantityUnit) mat.quantityUnit = quantityUnit;
            if (bredde) mat.bredde = bredde;
            if (specMode) mat.specMode = specMode;
            if (stiftGroup) mat.stiftGroup = true;
            if (plateLength || plateWidth) mat.plate = { length: plateLength, width: plateWidth };
            if (lmPerSide) mat.lmPerSide = lmPerSide;
            if (antallObjekter) mat.antallObjekter = antallObjekter;
            if (sider) mat.sider = sider;
            if (kappeOrient) mat.kappeOrient = kappeOrient;
            if (kappeIsoGroup) mat.kappeIsoGroup = kappeIsoGroup;
            if (kappeIsoGroupName) mat.kappeIsoGroupName = kappeIsoGroupName;
            materials.push(mat);
        }
    });
    return materials;
}

// Material picker overlay
let pickerOrderCard = null;
let pickerState = {}; // { "materialenavn": { checked: true, antall: "5", enhet: "stk" } }

function _pickerNameBelongsToGroup(name, groupName) {
    if (!name || !groupName) return false;
    return name === groupName || name.indexOf(groupName + '__') === 0 || name.indexOf(groupName + ' ') === 0;
}

function _scrollPickerTargetIntoView(targetName, options) {
    options = options || {};
    requestAnimationFrame(function() {
        var listEl = document.getElementById('picker-overlay-list');
        if (!listEl || !targetName) return;

        var header = null;
        var groupName = options.groupName || '';
        if (groupName) {
            var headers = listEl.querySelectorAll('.picker-mat-group-header[data-mat-name]');
            for (var h = 0; h < headers.length; h++) {
                if (headers[h].getAttribute('data-mat-name') === groupName) {
                    header = headers[h];
                    break;
                }
            }
        }

        var rows = listEl.querySelectorAll('[data-mat-name]');
        var target = null;
        for (var i = 0; i < rows.length; i++) {
            var rowName = rows[i].getAttribute('data-mat-name');
            if (options.preferLastInGroup && _pickerNameBelongsToGroup(rowName, groupName)) {
                target = rows[i];
            } else if (!target && rowName === targetName) {
                target = rows[i];
            }
        }
        if (!target) target = header;
        if (!target) return;

        var margin = 12;
        var listRect = listEl.getBoundingClientRect();
        var targetRect = target.getBoundingClientRect();
        var overflowBottom = targetRect.bottom - (listRect.bottom - margin);
        if (overflowBottom > 0) {
            listEl.scrollTop += overflowBottom;
            return;
        }

        var headerRect = header ? header.getBoundingClientRect() : targetRect;
        var overflowTop = (listRect.top + margin) - headerRect.top;
        if (overflowTop > 0) {
            listEl.scrollTop -= overflowTop;
        }

        if (options.focusAntall) {
            var antallInput = target.querySelector('.picker-mat-antall');
            if (antallInput && !antallInput.disabled) {
                try { antallInput.focus({ preventScroll: true }); }
                catch (err) { antallInput.focus(); }
            }
        }
    });
}

function _scrollPickerToRow(name) {
    _scrollPickerTargetIntoView(name);
}

function _scrollPickerOneRowAfterDup(name) {
    _scrollPickerTargetIntoView(name, { focusAntall: true });
}
let pickerRenderFn = null; // Reference to renderPickerList inside closure

var pickerConfirmCallback = null;

function parseMaterialPickerKey(key) {
    var raw = String(key || '');
    var meterMatch = raw.match(/^(.+)__meter(?:__(\d+))?$/);
    if (meterMatch) {
        return {
            baseName: meterMatch[1],
            realName: meterMatch[1],
            isMeterEntry: true,
            isEskeEntry: false,
            isDuplicate: !!meterMatch[2],
            duplicateIndex: meterMatch[2] ? parseInt(meterMatch[2], 10) : 1
        };
    }
    // Eske-poster: dimensjonsløs mengde på spec-basen, samme nøkkel-grammatikk
    // som __meter. Må testes FØR den generiske __N-dupliseringen.
    var eskeMatch = raw.match(/^(.+)__eske(?:__(\d+))?$/);
    if (eskeMatch) {
        return {
            baseName: eskeMatch[1],
            realName: eskeMatch[1],
            isMeterEntry: false,
            isEskeEntry: true,
            isDuplicate: !!eskeMatch[2],
            duplicateIndex: eskeMatch[2] ? parseInt(eskeMatch[2], 10) : 1
        };
    }
    var dupMatch = raw.match(/^(.+)__(\d+)$/);
    if (dupMatch) {
        return {
            baseName: dupMatch[1],
            realName: dupMatch[1],
            isMeterEntry: false,
            isEskeEntry: false,
            isDuplicate: true,
            duplicateIndex: parseInt(dupMatch[2], 10)
        };
    }
    return {
        baseName: raw,
        realName: raw,
        isMeterEntry: false,
        isEskeEntry: false,
        isDuplicate: false,
        duplicateIndex: 1
    };
}

// _didFetch: intern rekursjons-vakt. Hentingen forsøkes MAKS én gang.
// Uten den blir dette en uendelig løkke hver gang hentingen ikke gir materialer
// (Firestore-regler avviser, offline første gang, eller lista er genuint tom):
// retry → fortsatt tom → retry … Velgeren står på «Laster…» for alltid, knappene
// svarer ikke fordi overlayet rives ned og bygges opp på nytt hver runde, og
// konsollen fylles med én feil pr. runde.
function openMaterialPicker(btn, onConfirm, _didFetch) {
    // If material cache is empty and user is logged in, fetch from Firebase first
    if (!_didFetch && (!cachedMaterialOptions || cachedMaterialOptions.length === 0) && currentUser && db && typeof getDropdownOptions === 'function') {
        const modal = document.getElementById('picker-overlay');
        const list = document.getElementById('picker-overlay-list');
        list.innerHTML = '<div style="padding:16px;color:#999;text-align:center">' + t('loading') + '</div>';
        if (!window._pickerSavedScroll) window._pickerSavedScroll = _saveScrollPositions();
        modal.classList.add('active');
        document.body.classList.add('picker-active');
        var _reopen = function() {
            modal.classList.remove('active');
            document.body.classList.remove('picker-active');
            // Behold _pickerSavedScroll — re-åpning gjenbruker scroll-posisjonen.
            // _didFetch=true: åpne uansett resultat. Er lista fortsatt tom viser
            // renderPickerList «ingen materialer» — bedre enn å henge på «Laster…».
            openMaterialPicker(btn, onConfirm, true);
        };
        // .catch: uten den ville en avvist promise (f.eks. korrupt localStorage som
        // ikke lar seg parse) etterlatt velgeren på «Laster…» uten vei ut.
        getDropdownOptions().then(_reopen).catch(function(e) {
            console.error('getDropdownOptions error:', e);
            _reopen();
        });
        return;
    }
    pickerConfirmCallback = onConfirm || null;
    const card = btn ? (btn.closest('.mobile-order-card') || btn.closest('.service-entry-card')) : null;
    pickerOrderCard = card;
    const matContainer = card ? card.querySelector('.mobile-order-materials') : null;
    const existing = matContainer ? getMaterialsFromContainer(matContainer) : [];

    let allMaterials = getMaterialPickerOptions(cachedMaterialOptions || []);

    const modal = document.getElementById('picker-overlay');
    const list = document.getElementById('picker-overlay-list');

    function parsePickerStorageKey(key) {
        return parseMaterialPickerKey(key);
    }

    function nextPickerDuplicateKey(baseKey) {
        var n = 2;
        while (pickerState[baseKey + '__' + n]) n++;
        return baseKey + '__' + n;
    }

    // Initialize pickerState from existing materials
    pickerState = {};
    var dupCounters = {};
    existing.forEach(m => {
        if (m.name) {
            var isSpecBaseMat = allMaterials.some(function(o) {
                return o.name.toLowerCase() === m.name.toLowerCase() && (o.type === 'mansjett' || o.type === 'brannpakning' || o.type === 'kabelhylse');
            });
            // Skip spec-base materials (e.g. "FSC" when type is mansjett/brannpakning/kabelhylse),
            // but not direct meter-/eske-entries (dimensjonsløse poster på basenavnet)
            if (m.enhet !== 'meter' && m.enhet !== 'eske' && isSpecBaseMat) return;
            // __meter/__eske-suffiks så posten gjenkjennes som riktig radtype i pickeren.
            // Eske finnes i TO former: på basenavnet («FSC», dimensjonsløs) OG som
            // spec-derivert navn («FC6 Ø250mm», eske av en størrelse). Den siste treffer
            // ikke isSpecBaseMat, og uten suffikset ville den (a) kollidert med mål-raden
            // for samme størrelse, og (b) blitt prefylt som en MÅL-rad ved gjenåpning —
            // altså stille gjort om til enhet:stk. Derfor også findBaseMaterial her.
            var isSpecDerivedMat = !!findBaseMaterial(m.name);
            var storageKey = m.name;
            if (m.enhet === 'meter' && isSpecBaseMat) storageKey = m.name + '__meter';
            else if (m.enhet === 'eske' && (isSpecBaseMat || isSpecDerivedMat)) storageKey = m.name + '__eske';
            // If this name already exists in pickerState, use __N suffix for duplicates
            var materialState = { checked: true, antall: m.antall || '', enhet: m.enhet || '' };
            if (m.source) materialState.source = m.source;
            if (m.quantityUnit) materialState.quantityUnit = m.quantityUnit;
            if (m.bredde) materialState.bredde = m.bredde;
            if (m.specMode) materialState.specMode = m.specMode;
            if (m.stiftGroup) materialState.stiftGroup = true;
            if (m.plate && (m.plate.length || m.plate.width)) materialState.plate = m.plate;
            if (m.lmPerSide) materialState.lmPerSide = m.lmPerSide;
            if (m.antallObjekter) materialState.antallObjekter = m.antallObjekter;
            if (m.sider) materialState.sider = m.sider;
            if (m.kappeOrient) materialState.kappeOrient = m.kappeOrient;
            if (m.kappeIsoGroup) materialState.kappeIsoGroup = m.kappeIsoGroup;
            if (m.kappeIsoGroupName) materialState.kappeIsoGroupName = m.kappeIsoGroupName;
            if (pickerState[storageKey]) {
                if (!dupCounters[storageKey]) dupCounters[storageKey] = 1;
                dupCounters[storageKey]++;
                pickerState[storageKey + '__' + dupCounters[storageKey]] = materialState;
            } else {
                pickerState[storageKey] = materialState;
            }
        }
    });

    function formatDisplayName(name) {
        // Capitalize first letter, normalize ø→Ø for diameter, format kabelhylse, format rounds
        var normalized = name.charAt(0).toUpperCase() + name.slice(1);
        normalized = normalized.replace(/ø(?=\d)/g, 'Ø');
        normalized = formatKabelhylseSpec(normalized);
        normalized = normalized.replace(/^(.+?)r(\d+)$/, '$1 ($2 lag)').replace(/^(.+?) (\d+) lag$/, '$1 ($2 lag)');
        return formatDisplayForBreak(normalized);
    }

    function buildRow(name, isChecked, antall, enhet, matType, displayNameOverride, hasVariants, deletable, source, quantityUnit) {
        const baseDisplay = displayNameOverride ? formatDisplayName(displayNameOverride) : formatDisplayName(name);
        const enhetLower = (enhet || '').toLowerCase();
        const isIsolationLauncher = matType === 'kappe-isolation';
        const isStiftLauncher = matType === 'kappe-stift';
        const isLauncher = isIsolationLauncher || isStiftLauncher || matType === 'mansjett' || matType === 'brannpakning' || matType === 'kabelhylse';
        // Spec-launchere (mansjett/brannpakning/kabelhylse uten valgt størrelse) er
        // ikke-aktiverte rader som krever popup for å bli konkrete entries.
        const isSpecLauncher = isLauncher && !isChecked;
        const activeQuantityUnit = quantityUnit || getMaterialQuantityUnit(name, enhet, source);
        const isMeterQuantity = activeQuantityUnit === 'meter';
        // Samme regel som eksporten og ordrekortet, via den delte helperen.
        // hasVariants-vakten står igjen fordi spec-rader («FSC Ø250mm», eske) ikke
        // er varianter — de har målet i navnet og enheten i pillen fra før.
        const displayName = hasVariants
            ? baseDisplay + materialVariantSuffix({ name: name, enhet: enhet, source: source, quantityUnit: activeQuantityUnit })
            : baseDisplay;
        // Enhets-pill etter navnet for konsistens på alle rader. Spec-launchere
        // (ikke valgt enda) får ingen pill — de er placeholder for popup.
        let unitPillText = '';
        if (!isSpecLauncher && !isIsolationLauncher) {
            if (source === 'kappe-products') {
                unitPillText = isMeterQuantity ? 'meter' : 'plate';
            } else if (source === 'kappe-stift' || source === 'kappe-fastener') {
                unitPillText = enhetLower === 'eske' ? 'eske' : 'stk';
            } else {
                // activeQuantityUnit, IKKE hardkodet 'stk': denne grenen ga før
                // 'stk' på ALT som ikke var meter — også eske-rader. Velgeren viste
                // da 'stk' mens eksporten viste 'eske' for nøyaktig samme rad.
                // Varianter (Patron, Pølse, …) er stk-baserte og gir fortsatt 'stk'
                // herfra, siden getMaterialQuantityUnit returnerer det for dem.
                unitPillText = activeQuantityUnit;
            }
        }
        // Strip redundante suffixer fra navnet når samme info finnes i pillen.
        let cleanedDisplayName = displayName;
        if (unitPillText === 'plate') {
            cleanedDisplayName = cleanedDisplayName.replace(/\s*\(plate\)\s*$/i, '');
        } else if (unitPillText === 'meter') {
            cleanedDisplayName = cleanedDisplayName.replace(/\s+meter\s*$/i, '');
        } else if (unitPillText === 'eske') {
            cleanedDisplayName = cleanedDisplayName.replace(/\s*\(eske\)\s*$/i, '');
        }
        const meterPillHtml = unitPillText
            ? '<span class="picker-mat-unit-pill">' + escapeHtml(unitPillText) + '</span>'
            : '';
        // Dupliser-knapp er disabled på alle rader uten data (isChecked=false): launcher-rader
        // som ikke er aktivert, og standard-materialer der Antall fortsatt er tomt. Det er
        // ingen meningsfull "kilde" å duplisere før raden faktisk har innhold.
        // "Isolering"-launcheren: vis Antall/dupliser/slett som vanlige rader
        // (konsistent), men ALLTID disabled — mengder/handlinger skjer i popupen.
        const dupDisabled = !isChecked || isIsolationLauncher;
        const dupBtn = '<button type="button" class="picker-mat-dup-btn" title="Dupliser"' + (dupDisabled ? ' disabled' : '') + '>' + duplicateIcon.replace('width="24"', 'width="18"').replace('height="24"', 'height="18"') + '</button>';
        // Slett-knappen er disabled på default-produkter (kan ikke fjernes) og på inaktive rader
        // (ingen data å slette). Brukerskapte duplikater/spec-rader beholder slett-knappen aktiv.
        const delDisabled = !deletable || !isChecked || isIsolationLauncher;
        const delBtn = '<button type="button" class="picker-mat-delete-btn" title="Fjern"' + (delDisabled ? ' disabled' : '') + '>' + deleteIcon.replace('width="24"', 'width="18"').replace('height="24"', 'height="18"') + '</button>';
        // Kappe-rader (isolasjon/festemiddel): klikkbar enhetsbryter til høyre.
        //   Isolasjon (source='kappe-products'): veksler 'meter' ↔ 'stk'
        //   Festemiddel (source='kappe-stift'/'kappe-fastener'): veksler 'stk' ↔ 'eske'
        // Unit-toggle på raden fjernet — enhet velges via popup-modus (Bredde/Plate for isolasjon,
        // Stk/Eske for festemiddel) og er låst etter at raden er opprettet.
        const unitBtn = '';
        // Farget prikk markerer spec-materialer (klikk navn → valg-popup).
        // Standard med varianter får et tall-badge (antall varianter) i stedet
        // — samme mønster som Innstillinger → Materialer, så prikk-fargekoden
        // ikke forveksles med spec/popup-materialer.
        const typeDot = matType === 'mansjett' ? '<span class="picker-mat-dot picker-mat-dot-mansjett"></span>'
            : matType === 'brannpakning' ? '<span class="picker-mat-dot picker-mat-dot-brannpakning"></span>'
            : matType === 'kabelhylse' ? '<span class="picker-mat-dot picker-mat-dot-kabelhylse"></span>'
            : matType === 'kappe-isolation' ? '<span class="picker-mat-dot picker-mat-dot-isolation"></span>'
            : matType === 'kappe-stift' ? '<span class="picker-mat-dot picker-mat-dot-stift"></span>'
            : '';
        let variantBadge = '';
        if (hasVariants && !typeDot) {
            var _bm = allMaterials.find(function(m) { return m.name === (parseMaterialPickerKey(name).baseName || name); });
            var _vc = _bm && _bm.allowedUnits ? _bm.allowedUnits.length : 0;
            if (_vc > 0) {
                variantBadge = '<span class="picker-mat-variant-count" title="' + _vc + ' ' + (_vc === 1 ? 'enhet' : 'enheter') + '">' + _vc + '</span>';
            }
        }
        // Meter-badgen er fjernet etter brukerønske — Antall-placeholder ("Meter") og
        // navn-format ("løpende"/"Ø50mm") kommuniserer enheten godt nok uten badge.
        const meterBadge = '';
        // Placeholder: alltid "Antall" for vanlige rader. Launcher-rader (iso/stift)
        // viser "Velg" siden bruker må åpne sub-picker først. Enheten (eske/meter/stk)
        // er allerede synlig i radnavnet eller via toggle, så ikke i placeholder.
        // Isolering-launcher viser samme felt som FSC/FSW (Antall + dupliser
        // + slett) for konsistens, men ALLTID disabled (mengder fylles inni
        // popupen som åpnes ved klikk på raden).
        const antallPlaceholder = isStiftLauncher ? t('btn_select') : t('placeholder_quantity');
        const disabledAttr = (isSpecLauncher || isIsolationLauncher) ? ' disabled' : '';
        return `<div class="picker-mat-row${isChecked ? ' picker-mat-selected' : ''}" data-mat-name="${escapeHtml(name)}" data-mat-type="${matType || 'standard'}" data-has-variants="${hasVariants ? '1' : '0'}" data-mat-source="${escapeHtml(source || '')}">
            <div class="picker-mat-check"><span class="picker-mat-name">${escapeHtml(cleanedDisplayName)}${meterPillHtml}</span>${typeDot}${variantBadge}${meterBadge}</div>
            <input type="text" class="picker-mat-antall" placeholder="${antallPlaceholder}" inputmode="numeric" value="${escapeHtml(antall)}"${disabledAttr}>
            ${unitBtn}${dupBtn}${delBtn}
        </div>`;
    }

    // Helper: find base material object for a name (checks if it's a spec-derived name)
    function findBaseMaterial(name) {
        return allMaterials.find(m => (m.type === 'mansjett' || m.type === 'brannpakning' || m.type === 'kabelhylse') && name.toLowerCase().startsWith(m.name.toLowerCase() + ' '));
    }

    // Avgjør om en rad i picker-en kan slettes. Default-produkter fra Innstillinger
    // skal aldri kunne slettes (det finnes ingen vei tilbake), kun brukerskapte rader
    // (duplikater, spec-derived, meter-entries, custom).
    function _isDeletablePickerEntry(name) {
        if (!name) return false;
        if (pickerState[name] && (pickerState[name].source === 'kappe-stift' || pickerState[name].source === 'kappe-fastener')) return true;
        if (/__meter$/i.test(name)) return true;
        if (/__eske$/i.test(name)) return true;
        if (/__\d+$/.test(name)) return true;
        if (findBaseMaterial(name)) return true;
        var inDefaults = allMaterials.some(function(m) {
            return m.name.toLowerCase() === name.toLowerCase();
        });
        if (!inDefaults) return true;
        return false;
    }

    function addIsolationPickerEntry(materialName, enhet, bredde, specMode, plate, usage) {
        var productName = _getKappeProductName(materialName) || materialName;
        var addedKey = productName;
        if (pickerState[addedKey]) {
            var n = 2;
            while (pickerState[productName + '__' + n]) n++;
            addedKey = productName + '__' + n;
        }
        // Modus dikterer enheten: 'bredde' → meter, 'plate' → stk.
        var unit = specMode === 'plate' ? 'stk' : 'meter';
        pickerState[addedKey] = {
            checked: true,
            antall: '',
            enhet: _formatKappeMaterialSize(enhet || ''),
            source: 'kappe-products',
            quantityUnit: unit
        };
        if (specMode === 'plate') {
            pickerState[addedKey].specMode = 'plate';
        } else if (bredde) {
            pickerState[addedKey].bredde = String(bredde).replace(/mm$/i, '');
            pickerState[addedKey].specMode = 'bredde';
        } else {
            pickerState[addedKey].specMode = 'bredde';
        }
        // Plate-dim er relevant for begge moduser (brukes til kalkulering av antall plater).
        if (plate && (plate.length || plate.width)) {
            pickerState[addedKey].plate = { length: plate.length || '', width: plate.width || '' };
        }
        // LM/Antall/Sider (bredde-modus): lagre beregnet total som antall + separate
        // felt for popup-prefyll ved re-redigering.
        if (usage) {
            if (usage.computedTotalLm) pickerState[addedKey].antall = usage.computedTotalLm;
            if (usage.lmPerSide) pickerState[addedKey].lmPerSide = usage.lmPerSide;
            if (usage.antallObjekter) pickerState[addedKey].antallObjekter = usage.antallObjekter;
            if (usage.sider) pickerState[addedKey].sider = usage.sider;
            if (usage.kappeOrient) pickerState[addedKey].kappeOrient = usage.kappeOrient;
            if (usage.kappeIsoGroup) pickerState[addedKey].kappeIsoGroup = usage.kappeIsoGroup;
            if (usage.kappeIsoGroupName) pickerState[addedKey].kappeIsoGroupName = usage.kappeIsoGroupName;
        }
        return addedKey;
    }

    function addStiftPickerEntry(enhet, productName, quantityUnit, specMode) {
        var baseName = productName || MATERIAL_STIFT_LAUNCHER;
        var addedKey = baseName;
        if (pickerState[addedKey]) {
            var n = 2;
            while (pickerState[baseName + '__' + n]) n++;
            addedKey = baseName + '__' + n;
        }
        var unit = quantityUnit || (specMode === 'eske' ? 'eske' : 'stk') || getKappeProductDefaultUnit(baseName) || 'stk';
        pickerState[addedKey] = {
            checked: true,
            antall: '',
            enhet: _formatKappeMaterialSize(enhet || ''),
            source: baseName === MATERIAL_STIFT_LAUNCHER ? 'kappe-stift' : 'kappe-fastener',
            quantityUnit: unit
        };
        if (specMode === 'stk' || specMode === 'eske') pickerState[addedKey].specMode = specMode;
        return addedKey;
    }

    function addKappeMaterialSelection(selection, preservedAntall) {
        if (!selection) return '';
        var source = selection.source || '';
        if (!source && selection.product && selection.product.source) source = selection.product.source;
        var isFastener = source === 'kappe-stift' || source === 'kappe-fastener' || (selection.product && selection.product.type === 'festemiddel');
        var addedKey = isFastener
            ? addStiftPickerEntry(selection.enhet, selection.name, selection.quantityUnit, selection.specMode)
            : addIsolationPickerEntry(selection.name, selection.enhet, selection.bredde, selection.specMode, selection.plate, {
                lmPerSide: selection.lmPerSide || '',
                antallObjekter: selection.antallObjekter || '',
                sider: selection.sider || '',
                computedTotalLm: selection.computedTotalLm || '',
                kappeOrient: selection.kappeOrient || '',
                kappeIsoGroup: selection.kappeIsoGroup || '',
                kappeIsoGroupName: selection.kappeIsoGroupName || ''
            });
        // Festemiddel: antall fylles nå i popupen (selection.antall) — analogt med
        // computedTotalLm for isolasjon. Vinner over bevart rad-verdi.
        if (isFastener && selection.antall != null && selection.antall !== '' && pickerState[addedKey]) {
            pickerState[addedKey].antall = String(selection.antall);
        }
        if (preservedAntall !== undefined && pickerState[addedKey]) {
            // Ny computedTotalLm/antall fra popup vinner over bevart rad-verdi
            // (bruker endret verdier ved re-redigering).
            if (!selection.computedTotalLm && (selection.antall == null || selection.antall === '')) {
                pickerState[addedKey].antall = preservedAntall || '';
            }
            pickerState[addedKey].checked = true;
        }
        return addedKey;
    }

    // Samle alle iso/festemiddel-valg fra picker-state → entries for å gjen-
    // åpne iso-popupen forhåndsfylt. Returnerer { entries, keys } (keys =
    // picker-state-nøkler som skal slettes ved "erstatt").
    function _gatherKappeMaterialEntries() {
        var entries = [], keys = [];
        Object.keys(pickerState).forEach(function(name) {
            var st = pickerState[name];
            if (!st) return;
            if (isKappeStiftMaterial(name, st.source || '', st.enhet)) {
                keys.push(name);
                entries.push({
                    source: st.source || 'kappe-stift',
                    name: _stripPickerSuffix(name) || name,
                    enhet: st.enhet || '',
                    specMode: st.specMode || st.quantityUnit || 'stk',
                    antall: st.antall || '',
                    // Opphav: true = lagt til via egen Festemidler-launcher (egen
                    // gruppe); false/undefined = lagt til via Isolering-popupen
                    // (vises i Isolasjon-gruppen sammen med isolasjonen).
                    stiftGroup: st.stiftGroup === true
                });
                return;
            }
            if (name !== MATERIAL_ISOLATION_LAUNCHER &&
                (st.source === 'kappe-products' || (!hasConfiguredMaterialName(name) && isKappeIsolationMaterial(name, st.source)))) {
                keys.push(name);
                entries.push({
                    source: 'kappe-products',
                    name: _getKappeProductName(name) || _stripPickerSuffix(name) || name,
                    enhet: st.enhet || '',
                    plate: st.plate || null,
                    specMode: st.specMode === 'plate' ? 'plate' : 'bredde',
                    antall: st.antall || '',
                    bredde: st.bredde || '',
                    lmPerSide: st.lmPerSide || '',
                    antallObjekter: st.antallObjekter || '',
                    sider: st.sider || '',
                    kappeOrient: st.kappeOrient || '',
                    kappeIsoGroup: st.kappeIsoGroup || '',
                    kappeIsoGroupName: st.kappeIsoGroupName || ''
                });
            }
        });
        return { entries: entries, keys: keys };
    }
    function _kappeMaterialEntryCount() {
        return _gatherKappeMaterialEntries().entries.length;
    }
    // En post tilhører den egne Festemidler-gruppen KUN hvis den er et festemiddel
    // OG ble lagt til via Festemidler-launcheren (stiftGroup). Festemidler lagt til
    // via Isolering-popupen hører til Isolasjon-gruppen (sammen med isolasjonen).
    function _entryInStiftGroup(e) {
        return isKappeStiftMaterial(e.name, e.source, e.enhet) && e.stiftGroup === true;
    }
    // Splittede tellere: isolering-launcher teller alt unntatt egne festemidler,
    // Festemidler-launcher teller kun egne festemiddel-poster.
    function _kappeIsoEntryCount() {
        return _gatherKappeMaterialEntries().entries.filter(function(e) {
            return !_entryInStiftGroup(e);
        }).length;
    }
    function _kappeStiftEntryCount() {
        return _gatherKappeMaterialEntries().entries.filter(_entryInStiftGroup).length;
    }

    // Åpne iso-popupen forhåndsfylt med ALLE tidligere valg. "Velg" erstatter
    // hele iso/festemiddel-settet (sletter gamle nøkler først).
    function _openIsoMaterialPopup() {
        var g = _gatherKappeMaterialEntries();
        // Iso-popupen forvalter KUN Isolasjon-gruppen: isolasjonsprodukter +
        // festemidler lagt til HER. Egne Festemidler-launcher-poster (stiftGroup)
        // røres ikke (verken forhåndsfyll eller "erstatt"-sletting).
        var isoEntries = [], isoKeys = [];
        g.entries.forEach(function(e, i) {
            if (_entryInStiftGroup(e)) return;
            isoEntries.push(e);
            isoKeys.push(g.keys[i]);
        });
        var replaced = false;
        openIsoCardPopup(function(selection) {
            if (!replaced) {
                isoKeys.forEach(function(k) { delete pickerState[k]; });
                replaced = true;
            }
            addKappeMaterialSelection(selection);
            renderPickerList();
        }, isoEntries.length ? { entries: isoEntries } : undefined);
    }

    // Festemidler-launcher: egen festemiddel-velger (uavhengig av isolasjon).
    // Åpner produkt/dimensjon-velgeren festemiddel-only (multiDimension) og
    // skriver resultatet direkte til pickerState. "Velg" erstatter hele
    // festemiddel-settet (sletter gamle stift-nøkler først), og bevarer antall/
    // enhet pr. navn|dimensjon fra forrige valg.
    function _openStiftMaterialPopup() {
        if (typeof openFastenerPopup !== 'function') return;
        var g = _gatherKappeMaterialEntries();
        var stiftKeys = [], initial = [];
        g.entries.forEach(function(e, i) {
            // Kun egne Festemidler-launcher-poster (stiftGroup) — festemidler i
            // Isolasjon-gruppen forvaltes av iso-popupen.
            if (!_entryInStiftGroup(e)) return;
            stiftKeys.push(g.keys[i]);
            // Dimensjon lagres formatert ("22mm"); strip "mm" → rå (matcher katalogen).
            var _rawDim = String(e.enhet || '').replace(/mm$/i, '').trim();
            var _unit = (e.specMode === 'eske' || e.quantityUnit === 'eske') ? 'eske' : 'stk';
            initial.push({ name: e.name, dim: _rawDim, source: e.source || 'kappe-stift', unit: _unit, antall: e.antall || '' });
        });
        // Kort-stil festemiddel-popup (som Isolering). "Velg" erstatter hele
        // Festemidler-settet i pickerState (slett gamle stiftGroup-nøkler først).
        openFastenerPopup({
            initial: initial,
            onConfirm: function(selections) {
                stiftKeys.forEach(function(k) { delete pickerState[k]; });
                (selections || []).forEach(function(s) {
                    var addedKey = addStiftPickerEntry(s.dim, s.name, s.unit, s.unit);
                    if (addedKey && pickerState[addedKey]) {
                        pickerState[addedKey].antall = s.antall || '';
                        pickerState[addedKey].stiftGroup = true;
                    }
                });
                renderPickerList();
            }
        });
    }

    // Spec (mansjett/brannpakning/kabelhylse): åpne multi-add-popupen forhåndsfylt
    // med basens eksisterende poster. "Velg" erstatter hele settet (slett gamle,
    // legg til nye med antall fra popupen) — samme replace-mønster som isolering.
    function _openSpecMultiForBase(baseName, matType) {
        var keys = [];
        var prefill = [];
        Object.keys(pickerState).forEach(function(key) {
            var st = pickerState[key];
            if (!st) return;
            var parsed = parsePickerStorageKey(key);
            if (parsed.isMeterEntry && parsed.baseName === baseName) {
                keys.push(key);
                prefill.push({ isMeter: true, antall: st.antall || '' });
                return;
            }
            if (parsed.isEskeEntry) {
                // To former: «FSC__eske» (uten mål) og «FSC Ø250mm__eske» /
                // «FSC 100x200mm__eske» (med rundt hhv. firkantet mål). Målet er
                // valgfritt for ALLE spec-produkter, så formene kan finnes side om
                // side på samme base. For de sistnevnte er parsed.baseName
                // spec-navnet, så vi må også matche på prefiks.
                if (parsed.baseName === baseName) {
                    keys.push(key);
                    prefill.push({ isEske: true, antall: st.antall || '' });
                    return;
                }
                if (parsed.baseName.toLowerCase().indexOf(baseName.toLowerCase() + ' ') === 0) {
                    var eDims = _parseSpecFromName(parsed.baseName, baseName);
                    keys.push(key);
                    // height MÅ være med: uten den mistet en firkant-eske høyden ved
                    // gjenåpning og ble lagret tilbake som rund («Ø100mm»).
                    prefill.push({
                        isEske: true,
                        width: eDims ? eDims.width : '',
                        height: eDims ? eDims.height : '',
                        antall: st.antall || ''
                    });
                    return;
                }
                return;
            }
            var deduped = key.replace(/__(\d+)$/, '');
            if (deduped.toLowerCase().indexOf(baseName.toLowerCase() + ' ') === 0) {
                var dims = _parseSpecFromName(deduped, baseName);
                if (dims && !dims.isMeter) {
                    keys.push(key);
                    prefill.push({ width: dims.width, height: dims.height, depth: dims.depth, rounds: dims.rounds, antall: st.antall || '' });
                }
            }
        });
        openSpecMultiPopup(baseName, matType, function(selections) {
            keys.forEach(function(k) { delete pickerState[k]; });
            var lastKey = '';
            selections.forEach(function(s) {
                var key;
                if (s.isMeter) {
                    key = baseName + '__meter';
                    if (pickerState[key]) key = nextPickerDuplicateKey(key);
                    pickerState[key] = { checked: true, antall: s.antall || '', enhet: 'meter' };
                } else if (s.isEske) {
                    // Med mål: «FC6 Ø250mm__eske». __eske-suffikset er NØDVENDIG så
                    // 3 stk Ø250 og 2 esker Ø250 kan finnes samtidig uten kollisjon.
                    key = (s.spec ? baseName + ' ' + s.spec : baseName) + '__eske';
                    if (pickerState[key]) key = nextPickerDuplicateKey(key);
                    pickerState[key] = { checked: true, antall: s.antall || '', enhet: 'eske' };
                } else {
                    var full = baseName + ' ' + s.spec;
                    key = pickerState[full] ? nextPickerDuplicateKey(full) : full;
                    pickerState[key] = { checked: true, antall: s.antall || '', enhet: 'stk' };
                }
                lastKey = key;
            });
            renderPickerList();
            if (lastKey) _scrollPickerToRow(lastKey);
        }, prefill);
    }

    function renderPickerList() {
        pickerRenderFn = renderPickerList;
        // Hent ferske materialer hver render — så et nylig lagt til materiale
        // (addPickerMaterial oppdaterer cachedMaterialOptions) vises umiddelbart
        // i stedet for å rendre fra det utdaterte åpne-tidspunkt-øyeblikksbildet.
        allMaterials = getMaterialPickerOptions(cachedMaterialOptions || []);
        // Build list: configured materials + checked spec-derived entries + checked custom entries
        const entries = [];

        // Add all configured materials
        allMaterials.forEach(matObj => {
            var matType = matObj.type || 'standard';
            if (matType === 'kappe-stift') {
                // Egen Festemidler-launcher. Markeres aktiv + viser antall valgte
                // festemiddel-poster. Ingen løse rader (grupperes ved data).
                var _sCount = _kappeStiftEntryCount();
                entries.push({
                    name: matObj.name,
                    displayName: (matObj.displayName || getKappeFastenerLabel())
                        + (_sCount > 0 ? ' (' + _sCount + ')' : ''),
                    isChecked: _sCount > 0,
                    antall: '',
                    enhet: '',
                    matType: matType,
                    isSpecDerived: false,
                    source: matObj.source || ''
                });
            } else if (matType === 'kappe-isolation') {
                // Isolering-launcher. Markeres aktiv + viser antall valgte
                // isolasjon-poster (festemidler telles separat). Ingen løse rader.
                var _kCount = _kappeIsoEntryCount();
                entries.push({
                    name: matObj.name,
                    displayName: (matObj.displayName || getMaterialIsolationLabel())
                        + (_kCount > 0 ? ' (' + _kCount + ')' : ''),
                    isChecked: _kCount > 0,
                    antall: '',
                    enhet: '',
                    matType: matType,
                    isSpecDerived: false,
                    source: matObj.source || ''
                });
            } else if (matType === 'mansjett' || matType === 'brannpakning' || matType === 'kabelhylse') {
                // Spec material: show as launcher only if no derived entries exist (checked or unchecked)
                const baseLower = matObj.name.toLowerCase();
                const hasDerived = Object.keys(pickerState).some(k => {
                    const kLower = k.toLowerCase();
                    return kLower.startsWith(baseLower + ' ')
                        || kLower === baseLower + '__meter' || kLower.startsWith(baseLower + '__meter__')
                        || kLower === baseLower + '__eske' || kLower.startsWith(baseLower + '__eske__');
                });
                if (!hasDerived) {
                    entries.push({ name: matObj.name, isChecked: false, antall: '', enhet: matObj.defaultUnit || '', matType: matType, isSpecDerived: false });
                }
            } else {
                // Standard material — use default variant as enhet if available
                const state = pickerState[matObj.name] || pickerState[Object.keys(pickerState).find(k => k.toLowerCase() === matObj.name.toLowerCase())];
                // Highlight kun når Antall har verdi (ikke ved klikk på navn).
                const stateAntall = state ? (state.antall || '') : '';
                const isChecked = !!(stateAntall && stateAntall.toString().trim());
                var hasVariants = matObj.allowedUnits && matObj.allowedUnits.length > 0;
                var defaultVariant = hasVariants
                    ? (matObj.defaultUnit || (typeof matObj.allowedUnits[0] === 'string' ? matObj.allowedUnits[0] : (matObj.allowedUnits[0].plural || matObj.allowedUnits[0])))
                    : '';
                const enhet = state ? (state.enhet || defaultVariant || 'stk') : (defaultVariant || 'stk');
                entries.push({ name: matObj.name, isChecked, antall: stateAntall, enhet: enhet, matType: 'standard', isSpecDerived: false, hasVariants: hasVariants });
            }
        });

        // Add pickerState entries that are spec-derived, duplicates, or custom
        Object.keys(pickerState).forEach(name => {
            const state = pickerState[name];
            const baseMat = findBaseMaterial(name);
            const stateSource = state.source || '';
            // Iso/festemiddel-valg vises IKKE som løse rader lenger — de
            // representeres av den ene "Isolering"-launcheren (åpne den for
            // å se/redigere/fjerne). State beholdes (eksport/lagring).
            if (isKappeStiftMaterial(name, stateSource, state.enhet)) {
                return;
            }
            if (name !== MATERIAL_ISOLATION_LAUNCHER && (stateSource === 'kappe-products' || (!hasConfiguredMaterialName(name) && isKappeIsolationMaterial(name, stateSource)))) {
                return;
            }
            // Check for meter entries (e.g. "FSW__meter")
            const parsedKey = parsePickerStorageKey(name);
            if (parsedKey.isMeterEntry) {
                entries.push({ name, displayName: parsedKey.baseName, isChecked: state.checked, antall: state.antall || '', enhet: 'meter', matType: 'standard', isSpecDerived: true });
                return;
            }
            // Eske-entries (f.eks. "FSC__eske") — dimensjonsløs post på spec-basen
            if (parsedKey.isEskeEntry) {
                // quantityUnit settes eksplisitt: getMaterialQuantityUnit får her
                // NØKKELEN («FSC__eske»), som ikke matcher spec-basen, så uten dette
                // ville enhets-pillen sagt «stk» på den dimensjonsløse eske-raden.
                entries.push({ name, displayName: parsedKey.baseName, isChecked: state.checked, antall: state.antall || '', enhet: 'eske', quantityUnit: 'eske', matType: 'standard', isSpecDerived: true });
                return;
            }
            // Check for duplicate entries (e.g. "FSA__2" eller "FSW Ø100 2 lag__2")
            const dupMatch = name.match(/^(.+)__(\d+)$/);
            if (dupMatch) {
                const baseName = dupMatch[1];
                const baseMatObj = allMaterials.find(m => m.name === baseName);
                // Sjekk om dup-basen selv er en spec-derived entry (f.eks. "FSW Ø100 2 lag")
                const dupSpecBaseMat = baseMatObj ? null : findBaseMaterial(baseName);
                // For duplicates av vanlige produkter: highlight når state.checked
                // er true (f.eks. nylig opprettet via Dupliser) ELLER når Antall
                // har verdi. For duplicates av spec-typer eller spec-derived: alltid highlighted.
                const baseIsSpec = (baseMatObj && (baseMatObj.type === 'mansjett' || baseMatObj.type === 'brannpakning' || baseMatObj.type === 'kabelhylse'))
                    || !!dupSpecBaseMat;
                const dupAntall = state.antall || '';
                const dupChecked = baseIsSpec ? state.checked : (state.checked || !!(dupAntall && dupAntall.toString().trim()));
                // hasVariants må arves fra base-materialet så duplikat-raden får
                // riktig visning (variant i navn + grønn prikk).
                const dupHasVariants = !!(baseMatObj && baseMatObj.allowedUnits && baseMatObj.allowedUnits.length > 0);
                entries.push({ name, displayName: baseName, isChecked: dupChecked, antall: dupAntall, enhet: state.enhet || '', matType: 'standard', isSpecDerived: true, hasVariants: dupHasVariants });
            } else if (baseMat) {
                // Spec-derived entry (e.g. "Kabelhylse ø50x250mm")
                const enhet = state.enhet || 'stk';
                if (!state.enhet) state.enhet = 'stk';
                entries.push({ name, isChecked: state.checked, antall: state.antall || '', enhet: enhet, matType: 'standard', isSpecDerived: true });
            } else if (state.checked && !allMaterials.some(m => m.name.toLowerCase() === name.toLowerCase())) {
                // Custom entry not in settings — only show when checked
                entries.push({ name, isChecked: true, antall: state.antall || '', enhet: state.enhet || '', matType: 'standard', isSpecDerived: false });
            }
        });

        // Behold entry-rekkefølge innen hver gruppe (nyeste duplikater vises nederst).
        // Gruppe-rekkefølgen sorteres separat lenger ned (alfabetisk på baseName).

        // Group entries by base material name
        var pickerGroups = [];
        var pickerGroupMap = {};
        entries.forEach(function(e) {
            var baseName;
            var parsedEntryKey = parsePickerStorageKey(e.name);
            if (e.groupBaseName) {
                baseName = e.groupBaseName;
            } else if (parsedEntryKey.isMeterEntry || parsedEntryKey.isEskeEntry) {
                // Eske-nøkler kan bære et mål («FC6 Ø250mm__eske»); da er
                // parsedEntryKey.baseName spec-navnet, og gruppa må likevel bli
                // PRODUKTET. Uten dette havner Ø250mm i sin egen gruppe.
                var eskeSpecBase = findBaseMaterial(parsedEntryKey.baseName);
                baseName = eskeSpecBase ? eskeSpecBase.name : parsedEntryKey.baseName;
            } else if (parsedEntryKey.isDuplicate) {
                var dupBaseName = parsedEntryKey.baseName;
                var dupSpecBase = findBaseMaterial(dupBaseName);
                baseName = dupSpecBase ? dupSpecBase.name : dupBaseName;
            } else {
                var specBase = findBaseMaterial(e.name);
                baseName = specBase ? specBase.name : e.name;
            }
            if (!pickerGroupMap[baseName]) {
                var baseMatObj = allMaterials.find(function(m) { return m.name === baseName; });
                var groupType = baseMatObj ? (baseMatObj.type || 'standard') : 'standard';
                var isSpec = groupType === 'mansjett' || groupType === 'brannpakning' || groupType === 'kabelhylse';
                var isIsolation = groupType === 'kappe-isolation' || baseName === MATERIAL_ISOLATION_LAUNCHER || baseName === MATERIAL_KAPPE_LAUNCHER;
                var isStift = groupType === 'kappe-stift' || baseName === MATERIAL_STIFT_LAUNCHER || e.source === 'kappe-stift' || e.source === 'kappe-fastener';
                pickerGroupMap[baseName] = {
                    baseName: baseName,
                    displayName: e.groupDisplayName || (baseName === MATERIAL_KAPPE_LAUNCHER ? getMaterialKappeLabel() : ((baseMatObj && baseMatObj.displayName) || (isIsolation ? getMaterialIsolationLabel() : (isStift ? getMaterialStiftLabel() : baseName)))),
                    items: [],
                    groupType: groupType,
                    isSpecGroup: isSpec,
                    isIsolationGroup: isIsolation,
                    isStiftGroup: isStift
                };
                pickerGroups.push(pickerGroupMap[baseName]);
            }
            pickerGroupMap[baseName].items.push(e);
        });

        pickerGroups.sort(function(a, b) {
            var aIsGroup = (a.isSpecGroup || a.isIsolationGroup || a.isStiftGroup) && a.items.length >= 1 ? 1 : 0;
            var bIsGroup = (b.isSpecGroup || b.isIsolationGroup || b.isStiftGroup) && b.items.length >= 1 ? 1 : 0;
            if (aIsGroup !== bIsGroup) return aIsGroup - bIsGroup;
            return (a.displayName || a.baseName).localeCompare(b.displayName || b.baseName, 'nb');
        });

        let html = '';
        pickerGroups.forEach(function(group) {
            // Isolering: bold header + KUN-VISNING underrader for hvert valg (produkt/
            // festemiddel + dimensjon), som specs/ordrekort. Tap på header eller underrad
            // åpner Isolering-popupen (mengde settes der). Uten valg faller den tilbake
            // til en flat launcher-rad (som en tom spec).
            if (group.isIsolationGroup || group.isStiftGroup) {
                // Isolasjon-gruppen viser KUN isolasjonsprodukter; Festemidler-gruppen
                // viser KUN festemiddel-poster. Begge kilder (launcher + isolering-popup)
                // grupperes her hver for seg basert på type — derfor filtreres samlingen
                // av valg på isKappeStiftMaterial mot gruppens art.
                var _isStiftGroup = !!group.isStiftGroup;
                var _allKappe = (typeof _gatherKappeMaterialEntries === 'function') ? _gatherKappeMaterialEntries() : { entries: [], keys: [] };
                var _gEntries = [], _gKeys = [];
                _allKappe.entries.forEach(function(e, _i) {
                    if (_entryInStiftGroup(e) === _isStiftGroup) {
                        _gEntries.push(e);
                        _gKeys.push(_allKappe.keys[_i]);
                    }
                });
                if (_gEntries.length) {
                    var _grpLabel = _isStiftGroup ? getKappeFastenerLabel() : getMaterialIsolationLabel();
                    var _grpDot = _isStiftGroup ? 'picker-mat-dot-stift' : 'picker-mat-dot-isolation';
                    var _grpType = _isStiftGroup ? 'kappe-stift' : 'kappe-isolation';
                    var _grpKind = _isStiftGroup ? 'stift' : 'iso';
                    html += '<div class="picker-mat-group-header" data-mat-name="' + escapeHtml(group.baseName) + '" data-mat-type="' + _grpType + '">'
                        + '<span class="picker-mat-name">' + escapeHtml(_grpLabel) + '</span>'
                        + '<span class="picker-mat-dot ' + _grpDot + '"></span></div>';
                    var _isoDupIcon = duplicateIcon.replace('width="24"', 'width="18"').replace('height="24"', 'height="18"');
                    var _isoDelIcon = deleteIcon.replace('width="24"', 'width="18"').replace('height="24"', 'height="18"');
                    _gEntries.forEach(function(e, _i) {
                        var _key = _gKeys[_i];
                        var _isStift = isKappeStiftMaterial(e.name, e.source, e.enhet);
                        var _lbl, _pill = '', _val = '', _pillHtml = '';
                        if (_isStift) {
                            // Festemiddel: navn + enhet-merke (stk/eske, kun visning — velges
                            // i popupen); REDIGERBART antall som spec-rader.
                            _lbl = formatKappeStiftName(e.enhet, e.name, e.specMode);
                            var _curUnit = (e.specMode === 'eske' || e.quantityUnit === 'eske') ? 'eske' : 'stk';
                            _pillHtml = '<span class="picker-mat-unit-pill">' + escapeHtml(t('kappe_unit_' + _curUnit)) + '</span>';
                        } else {
                            // Isolasjon (eneste unntak): navn + kapp-bredde/plate-merke; m² KUN VISNING
                            // (= antall plater × plate-areal, inkl. svinn) — redigeres i popupen.
                            _lbl = formatKappeIsolationName(e.name, e.enhet);
                            _pill = (e.specMode === 'plate') ? 'plate' : (e.bredde ? (String(e.bredde).replace(/mm$/i, '') + 'mm') : '');
                            var _pc = (typeof calcKappePlateCount === 'function') ? calcKappePlateCount(e) : 0;
                            var _m2 = (_pc > 0 && typeof calcKappeAreaM2 === 'function') ? calcKappeAreaM2(e, _pc) : 0;
                            _val = _m2 > 0 ? ((typeof formatKappeArea === 'function' ? formatKappeArea(_m2) : _m2) + ' m²') : '';
                            _pillHtml = _pill ? '<span class="picker-mat-unit-pill">' + escapeHtml(_pill) + '</span>' : '';
                        }
                        var _valCell = _isStift
                            ? '<input type="text" class="picker-mat-antall picker-iso-antall" inputmode="numeric" pattern="[0-9]*" value="' + escapeHtml(e.antall ? String(e.antall) : '') + '" placeholder="Antall">'
                            : '<span class="picker-iso-value">' + escapeHtml(_val) + '</span>';
                        html += '<div class="picker-mat-row picker-mat-grouped picker-mat-selected picker-iso-subrow" data-iso-key="' + escapeHtml(_key || '') + '" data-kappe-kind="' + _grpKind + '">'
                            + '<div class="picker-mat-check"><span class="picker-mat-name">' + escapeHtml(_lbl) + '</span>' + _pillHtml + '</div>'
                            + _valCell
                            + '<button type="button" class="picker-mat-dup-btn picker-iso-dup" title="Dupliser">' + _isoDupIcon + '</button>'
                            + '<button type="button" class="picker-mat-delete-btn picker-iso-del" title="Fjern">' + _isoDelIcon + '</button>'
                            + '</div>';
                    });
                    return;
                }
                // ingen valg → fall gjennom til launcher-rad nedenfor
            }
            var isLauncherOnly = (group.isSpecGroup || group.isIsolationGroup || group.isStiftGroup) && group.items.length === 1 && group.items[0].name === group.baseName;
            if ((!group.isSpecGroup && !group.isIsolationGroup && !group.isStiftGroup) || isLauncherOnly) {
                group.items.forEach(function(e) {
                    html += buildRow(e.name, e.isChecked, e.antall, e.enhet, e.matType, e.displayName, e.hasVariants, _isDeletablePickerEntry(e.name), e.source, e.quantityUnit);
                });
            } else {
                var gType = group.isIsolationGroup
                    ? 'kappe-isolation'
                    : (group.isStiftGroup ? 'kappe-stift' : group.groupType);
                var isSpec = gType === 'mansjett' || gType === 'brannpakning' || gType === 'kabelhylse';
                var typeDot = gType === 'mansjett' ? '<span class="picker-mat-dot picker-mat-dot-mansjett"></span>'
                    : gType === 'brannpakning' ? '<span class="picker-mat-dot picker-mat-dot-brannpakning"></span>'
                    : gType === 'kabelhylse' ? '<span class="picker-mat-dot picker-mat-dot-kabelhylse"></span>'
                    : gType === 'kappe-isolation' ? '<span class="picker-mat-dot picker-mat-dot-isolation"></span>'
                    : gType === 'kappe-stift' ? '<span class="picker-mat-dot picker-mat-dot-stift"></span>'
                    : '';
                html += '<div class="picker-mat-group-header" data-mat-name="' + escapeHtml(group.baseName) + '" data-mat-type="' + (gType || 'standard') + '">'
                    + '<span class="picker-mat-name">' + escapeHtml(group.displayName || group.baseName) + '</span>' + typeDot + '</div>';
                group.items.forEach(function(e) {
                    if ((group.isIsolationGroup || group.isStiftGroup) && e.name === group.baseName && (e.source === 'kappe-isolation-launcher' || e.source === 'kappe-stift-launcher' || e.source === 'kappe-materials-launcher')) return;
                    var subDisplay = e.displayName || e.name;
                    var nameNoSuffix = e.name.replace(/__(\d+)$/, '');
                    if (isKappeStiftMaterial(e.name, e.source, e.enhet)) {
                        subDisplay = e.displayName || formatKappeStiftName(e.enhet, e.name, e.quantityUnit);
                    } else if (group.isIsolationGroup) {
                        subDisplay = e.displayName || formatKappeIsolationName(e.name, e.enhet);
                    } else if (group.isStiftGroup) {
                        subDisplay = e.displayName || formatKappeStiftName(e.enhet, e.name, e.quantityUnit);
                    } else if (parsePickerStorageKey(e.name).isMeterEntry) {
                        // «Løpende» — samme ord som dokument-visningene. Gjentar
                        // verken gruppe-overskriften eller enhets-pillen («meter»).
                        subDisplay = 'Løpende';
                    } else if (parsePickerStorageKey(e.name).isEskeEntry) {
                        // Med mål: kun målet — pillen sier «eske» og skiller raden
                        // fra stk-raden med samme mål. Uten mål: produktnavnet.
                        // Uten mål: «Standard», samme ord som dokument-visningene.
                        var eKeyBase = parsePickerStorageKey(e.name).baseName;
                        subDisplay = (eKeyBase.toLowerCase().indexOf(group.baseName.toLowerCase() + ' ') === 0)
                            ? eKeyBase.substring(group.baseName.length + 1)
                            : 'Standard';
                    // isSpec-grenen MÅ ligge etter eske-grenen over: nameNoSuffix
                    // stripper bare «__N», så «FC6 Ø250mm__eske» ville ellers blitt
                    // vist som «Ø250mm__eske».
                    } else if (isSpec && nameNoSuffix.toLowerCase().startsWith(group.baseName.toLowerCase() + ' ')) {
                        subDisplay = nameNoSuffix.substring(group.baseName.length + 1);
                    } else if (e.name.match(/^(.+)__(\d+)$/)) {
                        var dupEnhet = normalizeVariant(group.baseName, e.enhet || '').toLowerCase();
                        subDisplay = (dupEnhet && dupEnhet !== 'stk' && dupEnhet !== 'meter')
                            ? dupEnhet.charAt(0).toUpperCase() + dupEnhet.slice(1)
                            : group.baseName;
                    } else if (e.name === group.baseName) {
                        var origEnhet = normalizeVariant(group.baseName, e.enhet || '').toLowerCase();
                        if (origEnhet && origEnhet !== 'stk' && origEnhet !== 'meter') {
                            subDisplay = origEnhet.charAt(0).toUpperCase() + origEnhet.slice(1);
                        }
                    }
                    var rowHtml = buildRow(e.name, e.isChecked, e.antall, e.enhet, e.matType, subDisplay, e.hasVariants, _isDeletablePickerEntry(e.name), e.source, e.quantityUnit);
                    rowHtml = rowHtml.replace('class="picker-mat-row', 'class="picker-mat-row picker-mat-grouped');
                    html += rowHtml;
                });
            }
        });

        if (!html) {
            html = '<div style="padding:16px;color:#999;text-align:center;">' + t('settings_no_materials') + '</div>';
        }

        // Admin kan legge til nye materialer direkte fra pickeren (samme funksjon
        // som i Innstillinger). Skjemaet ligger nederst i lista og bygges på nytt
        // ved hver render (state-drevet) — input fylles bare når brukeren er i det.
        if (isAdmin && typeof _pickerAddMaterialFormHtml === 'function') {
            html += _pickerAddMaterialFormHtml();
        }

        list.innerHTML = html;
        attachRowListeners();
    }

    function attachRowListeners() {
        // Isolering-underrader: tap på raden åpner Isolering-popupen (rediger mengde).
        // Dupliser kloner posten; slett fjerner den ene posten — som spec-rader.
        list.querySelectorAll('.picker-iso-subrow').forEach(function(row) {
            var isoKey = row.getAttribute('data-iso-key');
            var kappeKind = row.getAttribute('data-kappe-kind');
            var openKappeFn = kappeKind === 'stift' ? _openStiftMaterialPopup : _openIsoMaterialPopup;
            row.addEventListener('click', function() { openKappeFn(); });
            // Festemiddel-rader har redigerbart antall (kun visning på isolasjon). Tap på
            // input redigerer (stopp propagasjon så raden ikke åpner popupen).
            var antEl = row.querySelector('.picker-iso-antall');
            if (antEl) {
                antEl.addEventListener('click', function(e) { e.stopPropagation(); });
                antEl.addEventListener('input', function() {
                    if (isoKey && pickerState[isoKey]) pickerState[isoKey].antall = this.value;
                });
            }
            var isoDup = row.querySelector('.picker-iso-dup');
            if (isoDup) isoDup.addEventListener('click', function(e) {
                e.preventDefault(); e.stopPropagation();
                if (!isoKey || !pickerState[isoKey]) return;
                var baseName = isoKey.replace(/__(\d+)$/, '');
                var newKey = baseName, n = 2;
                while (pickerState[newKey]) { newKey = baseName + '__' + n; n++; }
                pickerState[newKey] = JSON.parse(JSON.stringify(pickerState[isoKey]));
                renderPickerList();
            });
            var isoDel = row.querySelector('.picker-iso-del');
            if (isoDel) isoDel.addEventListener('click', function(e) {
                e.preventDefault(); e.stopPropagation();
                if (isoKey) { delete pickerState[isoKey]; renderPickerList(); }
            });
        });
        // Group header click handlers
        list.querySelectorAll('.picker-mat-group-header').forEach(function(header) {
            header.addEventListener('click', function() {
                var headerName = header.getAttribute('data-mat-name');
                var headerType = header.getAttribute('data-mat-type') || 'standard';
                if (headerType === 'kappe-isolation') {
                    _openIsoMaterialPopup();
                } else if (headerType === 'kappe-stift') {
                    _openStiftMaterialPopup();
                } else if (headerType === 'mansjett' || headerType === 'brannpakning' || headerType === 'kabelhylse') {
                    // Spec material header: åpne multi-add-popup (dimensjoner + antall).
                    _openSpecMultiForBase(headerName, headerType);
                } else {
                    // Standard material with variants: toggle with default variant
                    var stdMatObj = allMaterials.find(function(m) { return m.name === headerName; });
                    var stdVariants = stdMatObj && stdMatObj.allowedUnits && stdMatObj.allowedUnits.length > 0 ? stdMatObj.allowedUnits : null;
                    var defaultEnhet = stdVariants ? (typeof stdVariants[0] === 'string' ? stdVariants[0] : (stdVariants[0].plural || stdVariants[0])) : 'stk';
                    var isChecked = pickerState[headerName] && pickerState[headerName].checked;
                    if (isChecked) {
                        pickerState[headerName].checked = false;
                    } else {
                        pickerState[headerName] = pickerState[headerName] || { checked: false, antall: '', enhet: defaultEnhet };
                        pickerState[headerName].checked = true;
                        if (!pickerState[headerName].enhet) pickerState[headerName].enhet = defaultEnhet;
                    }
                    renderPickerList();
                    _scrollPickerToRow(headerName);
                }
            });
        });

        list.querySelectorAll('.picker-mat-row').forEach(row => {
            // Isolering-underrader er kun visning og har egen klikk-handler (åpner popup).
            // De mangler data-mat-name/-type og Antall-input, så den generiske rad-logikken
            // skal IKKE røre dem (ellers null-navn/dobbel-handler).
            if (row.classList.contains('picker-iso-subrow')) return;
            const nameDiv = row.querySelector('.picker-mat-check');
            const antallInput = row.querySelector('.picker-mat-antall');
            const name = row.getAttribute('data-mat-name');
            const matType = row.getAttribute('data-mat-type') || 'standard';

            nameDiv.addEventListener('click', function() {
                if (matType === 'kappe-isolation') {
                    _openIsoMaterialPopup();
                    return;
                }
                if (matType === 'kappe-stift') {
                    // Egen Festemidler-launcher: åpne festemiddel-only velger (multiDimension).
                    _openStiftMaterialPopup();
                    return;
                }
                if (matType === 'mansjett' || matType === 'brannpakning' || matType === 'kabelhylse') {
                    // Spec-launcher: åpne multi-add-popup (dimensjoner + antall i samme operasjon).
                    _openSpecMultiForBase(name, matType);
                    return;
                }
                var isolationState = pickerState[name];
                var isIsolationEntry = isolationState && (isolationState.source === 'kappe-products' || (!hasConfiguredMaterialName(name) && isKappeIsolationMaterial(name, isolationState.source)));
                if (isIsolationEntry) {
                    var oldName = name;
                    var oldState = Object.assign({}, isolationState);
                    openIsoCardPopup(function(selection) {
                        delete pickerState[oldName];
                        var newKey = addKappeMaterialSelection(selection, oldState.antall || '');
                        renderPickerList();
                        _scrollPickerTargetIntoView(newKey, { focusAntall: true });
                    }, {
                        name: oldName,
                        enhet: oldState.enhet || '',
                        source: 'kappe-products',
                        bredde: oldState.bredde || '',
                        specMode: oldState.specMode || '',
                        plate: oldState.plate || null,
                        antall: oldState.antall || '',
                        lmPerSide: oldState.lmPerSide || '',
                        antallObjekter: oldState.antallObjekter || '',
                        sider: oldState.sider || ''
                    });
                    return;
                }
                var stiftState = pickerState[name];
                var isStiftEntry = stiftState && isKappeStiftMaterial(name, stiftState.source, stiftState.enhet);
                if (isStiftEntry) {
                    var oldStiftName = name;
                    var oldStiftState = Object.assign({}, stiftState);
                    openMaterialKappePicker(function(selection) {
                        delete pickerState[oldStiftName];
                        var newStiftKey = addKappeMaterialSelection(selection, oldStiftState.antall || '');
                        renderPickerList();
                        _scrollPickerTargetIntoView(newStiftKey, { focusAntall: true });
                    }, {
                        name: parsePickerStorageKey(oldStiftName).baseName || MATERIAL_STIFT_LAUNCHER,
                        enhet: oldStiftState.enhet || '',
                        source: oldStiftState.source || 'kappe-stift',
                        specMode: oldStiftState.specMode || (oldStiftState.quantityUnit === 'eske' ? 'eske' : 'stk')
                    });
                    return;
                }
                // Spec-derived sub-rad (f.eks. "Kabelhylse Ø50x250mm" eller "FSW__meter"):
                // klikk på navn åpner spec-popup forhåndsutfylt med eksisterende verdier
                // slik at bruker kan justere dimensjoner.
                var parsedNameKey = parsePickerStorageKey(name);
                var derivedBase = null;
                if (parsedNameKey.isMeterEntry) {
                    derivedBase = allMaterials.find(function(m) { return m.name === parsedNameKey.baseName && (m.type === 'mansjett' || m.type === 'brannpakning'); });
                } else if (parsedNameKey.isEskeEntry) {
                    // Eske gjelder ALLE tre spec-typene — også kabelhylse, i motsetning
                    // til løpende meter som kun finnes for mansjett/brannpakning.
                    // findBaseMaterial FØRST fordi nøkkel-basen kan være et spec-navn
                    // («FC6 Ø250mm__eske» → «FC6 Ø250mm»); uten den ville tapp på en
                    // eske-rad med mål ikke åpnet popupen i det hele tatt.
                    derivedBase = findBaseMaterial(parsedNameKey.baseName)
                        || allMaterials.find(function(m) { return m.name === parsedNameKey.baseName && (m.type === 'mansjett' || m.type === 'brannpakning' || m.type === 'kabelhylse'); });
                } else {
                    derivedBase = findBaseMaterial(name);
                }
                if (derivedBase) {
                    // Tap på spec-underrad åpner multi-add-popupen forhåndsfylt med ALLE
                    // basens poster (rediger/legg til; "Velg" erstatter hele settet).
                    _openSpecMultiForBase(derivedBase.name, derivedBase.type);
                    return;
                }
                // Standard-materialer med varianter: klikk på navn åpner variant-popup
                // (erstatter den gamle enhet-knappen). Velg variant → variant blir del
                // av visningsnavnet ("FSA" → "FSA Patron"), antall-feltet aktiveres.
                var rowHasVariants = row.getAttribute('data-has-variants') === '1';
                if (rowHasVariants) {
                    _ensureState();
                    var lookupName = name.replace(/__\d+$/, '');
                    var matObjV = allMaterials.find(m => m.name === lookupName) || findBaseMaterial(name);
                    var variantsV = matObjV && matObjV.allowedUnits && matObjV.allowedUnits.length > 0 ? matObjV.allowedUnits : null;
                    if (variantsV) {
                        var optionsV = [];
                        variantsV.forEach(function(v) {
                            var label = typeof v === 'string' ? v : (v.plural || v.singular || v);
                            optionsV.push({ label: label, type: 'variant' });
                        });
                        openVariantPopup(matObjV.name, optionsV, function(selected) {
                            pickerState[name].enhet = selected;
                            renderPickerList();
                            _scrollPickerToRow(name);
                        });
                    }
                    return;
                }
                // Vanlige produkter (rene stk-materialer): klikk på navn har ingen
                // effekt. Bruker må klikke direkte i Antall-feltet for å skrive en
                // verdi. Highlighting styres utelukkende av Antall-verdien.
            });

            // Highlighting-regler:
            // - Spec-launcher: aldri highlighted (representerer kun en knapp for å åpne popup)
            // - Spec-derived (entry opprettet via spec-popup): alltid highlighted
            // - Vanlig produkt: highlighted iff Antall har verdi
            var isSpecType = matType === 'mansjett' || matType === 'brannpakning' || matType === 'kabelhylse';
            var _parsedRowKey = parsePickerStorageKey(name);
            var isSpecDerived = _parsedRowKey.isMeterEntry || _parsedRowKey.isEskeEntry || !!findBaseMaterial(name);

            function _ensureState() {
                if (pickerState[name]) return;
                var lookupName = name.replace(/__\d+$/, '');
                var stdMatObj = allMaterials.find(function(m) { return m.name === lookupName; });
                var stdVariants = stdMatObj && stdMatObj.allowedUnits && stdMatObj.allowedUnits.length > 0 ? stdMatObj.allowedUnits : null;
                var defaultEnhet = stdVariants ? (typeof stdVariants[0] === 'string' ? stdVariants[0] : (stdVariants[0].plural || stdVariants[0])) : 'stk';
                pickerState[name] = { checked: false, antall: '', enhet: defaultEnhet };
            }

            // Samle-launcher ("Isolering") har ingen antall-input — hopp over.
            if (antallInput) antallInput.addEventListener('input', function() {
                if (isSpecType) return;  // spec-launcher: input disabled (krever popup)
                _ensureState();
                var val = this.value;
                var hasValue = !!(val && val.toString().trim());
                pickerState[name].antall = val;
                if (isSpecDerived) {
                    // Spec-derived: alltid valgt (entry eksisterer fordi spec ble fylt)
                    pickerState[name].checked = true;
                } else {
                    // Vanlig produkt: valgt iff Antall har verdi
                    pickerState[name].checked = hasValue;
                    row.classList.toggle('picker-mat-selected', hasValue);
                    // Dynamisk synk: dup/slett disables når raden mister data, enables igjen
                    // når bruker skriver inn ny verdi. Unngår re-render av hele picker-listen.
                    var rowDup = row.querySelector('.picker-mat-dup-btn');
                    if (rowDup) rowDup.disabled = !hasValue;
                    var rowDel = row.querySelector('.picker-mat-delete-btn');
                    if (rowDel) {
                        var isDeletable = _isDeletablePickerEntry(name);
                        rowDel.disabled = !isDeletable || !hasValue;
                    }
                }
            });

            // Duplicate button
            var dupBtn = row.querySelector('.picker-mat-dup-btn');
            if (dupBtn) {
                dupBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (dupBtn.disabled) return;
                    var parsedDupKey = parsePickerStorageKey(name);
                    var baseName = parsedDupKey.baseName;
                    // Kappe-rader (isolasjon/festemiddel): åpne Kappematerialer-popup med prefill
                    // så bruker kan velge nytt produkt + dimensjon, konsistent med spec-popup-flyt.
                    var kappeSrcState = pickerState[name];
                    var kappeSrc = kappeSrcState && kappeSrcState.source;
                    if (kappeSrc === 'kappe-products' || kappeSrc === 'kappe-stift' || kappeSrc === 'kappe-fastener') {
                        openIsoCardPopup(function(selection) {
                            var newKey = addKappeMaterialSelection(selection);
                            renderPickerList();
                            _scrollPickerOneRowAfterDup(newKey);
                        }, {
                            name: baseName,
                            enhet: kappeSrcState.enhet || '',
                            source: kappeSrc,
                            // Dup: bredde tilbakestilles — bruker skal skrive ny verdi for ny strimmel.
                            // (Plate-størrelse beholdes siden den tilhører produktet, ikke strimmelen.)
                            bredde: '',
                            specMode: kappeSrcState.specMode || '',
                            plate: kappeSrcState.plate || null
                        });
                        return;
                    }
                    // Eske-rader dupliseres direkte til en ny tom eske-rad. Bevisst ULIKT
                    // meter-rader, som ruter videre til openSpecPopup — den popupen har
                    // en Stk/Meter-toggle, men ingen eske-modus. Å legge til en tredje
                    // modus der ville vært en større endring uten gevinst: en eske-rad
                    // har ingen dimensjon å velge, så det finnes ingenting å spørre om.
                    if (parsedDupKey.isEskeEntry) {
                        var eskeNewKey = nextPickerDuplicateKey(baseName + '__eske');
                        pickerState[eskeNewKey] = { checked: true, antall: '', enhet: 'eske' };
                        renderPickerList();
                        _scrollPickerOneRowAfterDup(eskeNewKey);
                        return;
                    }
                    // Spec-base lookup: håndterer både spec-rader (FSC Ø50mm) og meter-rader
                    // (FSC løpende). Popup åpnes konsistent i begge tilfeller; brukeren velger
                    // selv om duplikatet skal bli en ny spec eller en meter-direkte rad.
                    var specBaseMat = findBaseMaterial(baseName) || findBaseMaterial(name);
                    if (!specBaseMat) {
                        var selfMat = allMaterials.find(m => m.name === baseName);
                        if (selfMat && (selfMat.type === 'mansjett' || selfMat.type === 'brannpakning' || selfMat.type === 'kabelhylse')) {
                            specBaseMat = selfMat;
                        }
                    }
                    // Fallback for ikke-spec meter-rader (sjelden, men bevares for trygghet).
                    if (!specBaseMat && parsedDupKey.isMeterEntry) {
                        var meterBaseKey = parsedDupKey.baseName + '__meter';
                        var meterNewKey = nextPickerDuplicateKey(meterBaseKey);
                        pickerState[meterNewKey] = { checked: true, antall: '', enhet: 'meter' };
                        renderPickerList();
                        _scrollPickerOneRowAfterDup(meterNewKey);
                        return;
                    }
                    if (specBaseMat) {
                        // Spec material: open spec popup to add another variant.
                        // Hvis kilde-raden er meter-rad → åpne popup i meter-modus så bruker
                        // ikke trenger å klikke toggle manuelt for samme type duplikat.
                        var specName = specBaseMat.name;
                        var specType = specBaseMat.type;
                        var dupPrefill = parsedDupKey.isMeterEntry ? { isMeter: true } : null;
                        openSpecPopup(specName, function(spec, meterValue) {
                            var addedKey;
                            if (meterValue !== undefined) {
                                addedKey = specName + '__meter';
                                if (pickerState[addedKey]) addedKey = nextPickerDuplicateKey(addedKey);
                                pickerState[addedKey] = { checked: true, antall: meterValue, enhet: 'meter' };
                            } else {
                                var fullName = specName + ' ' + spec;
                                // Tillat duplikater: hvis spec-entry allerede finnes, bruk __N suffix
                                addedKey = fullName;
                                if (pickerState[addedKey]) {
                                    var n = 2;
                                    while (pickerState[fullName + '__' + n]) n++;
                                    addedKey = fullName + '__' + n;
                                }
                                pickerState[addedKey] = { checked: true, antall: '', enhet: 'stk' };
                            }
                            renderPickerList();
                            _scrollPickerOneRowAfterDup(addedKey);
                        }, specType, dupPrefill);
                    } else {
                        // Standard material: create __N duplicate, arve enhet fra kilde-raden
                        var sourceState = pickerState[name];
                        // Hvis kilde-raden ikke er i state ennå (f.eks. bruker har ikke skrevet noe),
                        // fallback til materialets defaultUnit/første variant
                        var sourceEnhet = sourceState && sourceState.enhet ? sourceState.enhet : '';
                        var sourceSource = sourceState && sourceState.source
                            ? sourceState.source
                            : ((!hasConfiguredMaterialName(baseName) && isKappeIsolationMaterial(baseName, '')) ? 'kappe-products'
                                : ((!hasConfiguredMaterialName(baseName) && isKappeStiftMaterial(baseName, '', sourceEnhet)) ? 'kappe-stift' : ''));
                        var dupMatObj = allMaterials.find(m => m.name === baseName);
                        var dupHasVariants = dupMatObj && dupMatObj.allowedUnits && dupMatObj.allowedUnits.length > 0;
                        var defEnhet = sourceEnhet || (dupHasVariants
                            ? (dupMatObj.defaultUnit || (typeof dupMatObj.allowedUnits[0] === 'string' ? dupMatObj.allowedUnits[0] : (dupMatObj.allowedUnits[0].plural || dupMatObj.allowedUnits[0])))
                            : 'stk');
                        var newKey = nextPickerDuplicateKey(baseName);
                        // checked: true så den nye duplikat-raden vises som
                        // aktiv (orange highlighting) umiddelbart — bruker
                        // forventer at duplikatet er "klar" som kilden var.
                        pickerState[newKey] = { checked: true, antall: '', enhet: defEnhet };
                        if (sourceSource) pickerState[newKey].source = sourceSource;
                        renderPickerList();
                        _scrollPickerOneRowAfterDup(newKey);
                    }
                });
            }

            // Delete button — fjerner brukerskapt rad fra pickerState (med bekreftelse)
            var delBtnEl = row.querySelector('.picker-mat-delete-btn');
            if (delBtnEl) {
                delBtnEl.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (delBtnEl.disabled) return;
                    showConfirmModal(t('picker_delete_confirm'), function() {
                        // Behold scroll-posisjon slik at header (f.eks. FSC) ikke virker å flytte seg
                        var listEl = document.getElementById('picker-overlay-list');
                        var savedScroll = listEl ? listEl.scrollTop : 0;
                        delete pickerState[name];
                        renderPickerList();
                        if (listEl) listEl.scrollTop = savedScroll;
                    });
                });
            }
        });
    }

    renderPickerList();

    if (!window._pickerSavedScroll) window._pickerSavedScroll = _saveScrollPositions();
    modal.classList.add('active');
    document.body.classList.add('picker-active');

    // Reset picker-list scroll til topp så bruker alltid begynner på toppen
    // ved gjenåpning. Må kjøres ETTER modal er .active (ellers er elementet
    // display:none og scrollTop-setting har ikke effekt). rAF venter til layout
    // er ferdig så scrollHeight er etablert.
    requestAnimationFrame(function() {
        var pickerListEl = document.getElementById('picker-overlay-list');
        if (pickerListEl) pickerListEl.scrollTop = 0;
    });
}

function closePickerOverlay() {
    document.getElementById('picker-overlay').classList.remove('active');
    document.body.classList.remove('picker-active');
    _restoreScrollPositions(window._pickerSavedScroll);
    window._pickerSavedScroll = null;
    pickerOrderCard = null;

}

function openMaterialKappePicker(callback, prefill) {
    if (typeof openProductDimensionPicker !== 'function') {
        showNotificationModal(t('kappe_settings_no_products'));
        return;
    }
    var products = getKappeProducts().map(function(product) {
        return Object.assign({}, product, { source: 'kappe-products' });
    });
    var fastenerProducts = getKappeFastenerProducts().map(function(product) {
        return Object.assign({}, product, { source: product.name === MATERIAL_STIFT_LAUNCHER ? 'kappe-stift' : 'kappe-fastener' });
    });
    products = products.concat(fastenerProducts);
    var stiftSizes = _getUniqueKappeMaterialSizes(getKappeFastenerDimensions());
    if (!products.length) {
        showNotificationModal(t('kappe_settings_no_products'));
        return;
    }
    var defaultDimensions = getKappeDimensions();
    var initialBrand = '';
    if (prefill && prefill.source === 'kappe-stift') {
        initialBrand = MATERIAL_STIFT_LAUNCHER;
    } else if (prefill && prefill.name) {
        initialBrand = _getKappeProductName(prefill.name) || prefill.name;
    }
    openProductDimensionPicker({
        title: getMaterialKappeLabel(),
        products: products,
        dimensions: defaultDimensions.concat(stiftSizes),
        getDimensionsForProduct: function(product) {
            // Festemiddel-produkter (Stift, Brannskruer, ...) bruker fastener-dim-listen.
            return product && product.type === 'festemiddel' ? stiftSizes : defaultDimensions;
        },
        showPlate: false,
        showBredde: true,
        requireDimension: true,
        defaultFirstDimension: true,
        initialBrand: initialBrand,
        initialDim: prefill && prefill.enhet ? prefill.enhet : '',
        initialBredde: prefill && prefill.bredde ? prefill.bredde : '',
        initialPlate: prefill && prefill.plate ? prefill.plate : null,
        initialMode: prefill && prefill.specMode ? prefill.specMode : '',
        initialFastener: !!(prefill && prefill.source === 'kappe-stift'),
        initialUsage: prefill ? {
            lmPerSide: prefill.lmPerSide,
            antallObjekter: prefill.antallObjekter,
            sider: prefill.sider
        } : null,
        onConfirm: function(selection) {
            if (callback) {
                var source = selection.source || (selection.product && selection.product.source) || 'kappe-products';
                callback({
                    name: selection.name,
                    enhet: _formatKappeMaterialSize(selection.enhet || selection.dim || ''),
                    source: source,
                    bredde: selection.bredde || '',
                    plate: selection.plate || null,
                    specMode: selection.specMode || '',
                    product: selection.product || null,
                    // Festemiddel: popup leverer 'stk'/'eske' direkte. Isolasjon: bruk produktets default.
                    quantityUnit: selection.quantityUnit || getKappeProductDefaultUnit(selection.name),
                    lmPerSide: selection.lmPerSide || '',
                    antallObjekter: selection.antallObjekter || '',
                    sider: selection.sider || '',
                    computedTotalLm: selection.computedTotalLm || ''
                });
            }
        }
    });
}

function openMaterialIsolationPicker(callback, prefill) {
    openMaterialKappePicker(callback, prefill);
}

function closeMaterialIsolationPicker() {
    if (typeof closeKappeProductPicker === 'function') closeKappeProductPicker();
}

// Spec popup for materials that need a specification
let specPopupCallback = null;
let specPopupMatType = 'kabelhylse'; // 'mansjett' | 'brannpakning' | 'kabelhylse'
let specMeterMode = false;

// Parse en spec-streng tilbake til numeriske felt for pre-fyll i popup.
// name = full entry-navn (f.eks. "Kabelhylse Ø50x250mm" eller "FSW__meter")
// baseName = base-materialets navn (f.eks. "Kabelhylse", "FSW")
// Returnerer { width, height, depth, rounds } eller { isMeter: true } eller null.
function _parseSpecFromName(name, baseName) {
    if (/__meter(?:__\d+)?$/i.test(name)) return { isMeter: true };
    var specStr = name.substring(baseName.length + 1); // strip "BaseName "
    // Format: "<dims>mm" optionally followed by " <N> lag" (brannpakning lag-suffix)
    var lagMatch = specStr.match(/^(.+?)mm(?:\s+(\d+)\s+lag)?$/);
    if (!lagMatch) return null;
    var dims = lagMatch[1];
    var rounds = lagMatch[2] ? parseInt(lagMatch[2], 10) : 1;
    var result = { rounds: rounds };
    var m;
    if ((m = dims.match(/^(\d+)x(\d+)x(\d+)$/))) {
        result.width = parseInt(m[1], 10);
        result.height = parseInt(m[2], 10);
        result.depth = parseInt(m[3], 10);
    } else if ((m = dims.match(/^Ø(\d+)x(\d+)$/))) {
        result.width = parseInt(m[1], 10);
        result.depth = parseInt(m[2], 10);
    } else if ((m = dims.match(/^(\d+)x(\d+)$/))) {
        result.width = parseInt(m[1], 10);
        result.height = parseInt(m[2], 10);
    } else if ((m = dims.match(/^Ø(\d+)$/))) {
        result.width = parseInt(m[1], 10);
    } else {
        return null;
    }
    return result;
}

// Bygger spec-streng fra dimensjons-tall (delt av enkelt- og multi-popup).
// Returnerer streng (f.eks. "Ø111x2222mm", "111x222mm", "Ø111mm 2 lag"), eller
// null hvis type-spesifikt påkrevd felt mangler (dybde for kabelhylse, runder for
// brannpakning). num1 antas allerede validert > 0.
function _buildSpecString(matType, num1, num2, num3) {
    var isSquare = num2 > 0;
    if (matType === 'mansjett') {
        return isSquare ? (num1 + 'x' + num2 + 'mm') : ('Ø' + num1 + 'mm');
    }
    if (matType === 'brannpakning') {
        if (!num3 || num3 <= 0) return null;
        var s = isSquare ? (num1 + 'x' + num2) : ('Ø' + num1);
        s += 'mm';
        if (num3 > 1) s += ' ' + num3 + ' lag';
        return s;
    }
    // kabelhylse
    if (!num3 || num3 <= 0) return null;
    return isSquare ? (num1 + 'x' + num2 + 'x' + num3 + 'mm') : ('Ø' + num1 + 'x' + num3 + 'mm');
}

function openSpecPopup(baseName, callback, matType, prefill) {
    specPopupMatType = matType || 'kabelhylse';
    const input = document.getElementById('spec-popup-input');
    const input2 = document.getElementById('spec-popup-input2');
    const input3 = document.getElementById('spec-popup-input3');
    input.value = (prefill && prefill.width != null) ? String(prefill.width) : '';
    input2.value = (prefill && prefill.height != null) ? String(prefill.height) : '';
    input3.value = '';
    var meterInput = document.getElementById('spec-popup-meter-input');
    var meterField = document.getElementById('spec-popup-meter-field');
    if (meterInput) meterInput.value = (prefill && prefill.meter != null && prefill.meter !== '') ? String(prefill.meter) : '';
    if (meterField) meterField.style.display = 'none';
    if (prefill && !prefill.isMeter) {
        if (specPopupMatType === 'brannpakning' && prefill.rounds != null) input3.value = String(prefill.rounds);
        else if (specPopupMatType !== 'mansjett' && prefill.depth != null) input3.value = String(prefill.depth);
    }

    document.getElementById('spec-popup-title').textContent = baseName;

    const label1 = document.getElementById('spec-popup-label1');
    const label2 = document.getElementById('spec-popup-label2');
    const label3 = document.getElementById('spec-popup-label3');
    const field1 = document.getElementById('spec-popup-input').parentElement;
    const field2 = document.getElementById('spec-popup-field2');
    const field3 = document.getElementById('spec-popup-field3');

    input.placeholder = '';
    label1.innerHTML = t('dim_popup_width_placeholder') + ' <span class="spec-required-star">*</span>';
    field1.style.display = '';
    input2.placeholder = '';
    label2.textContent = t('dim_popup_height_placeholder');
    field2.style.display = '';

    if (specPopupMatType === 'mansjett') {
        field3.style.display = 'none';
    } else if (specPopupMatType === 'brannpakning') {
        field3.style.display = '';
        input3.placeholder = '';
        label3.innerHTML = t('dim_popup_rounds_placeholder') + ' <span class="spec-required-star">*</span>';
    } else {
        field3.style.display = '';
        input3.placeholder = '';
        label3.innerHTML = t('dim_popup_depth_placeholder') + ' <span class="spec-required-star">*</span>';
    }

    input.inputMode = 'numeric';
    input.pattern = '[0-9]*';
    input2.inputMode = 'numeric';
    input2.pattern = '[0-9]*';
    input3.inputMode = 'numeric';
    input3.pattern = '[0-9]*';

    // Stk/Meter-toggle øverst (kun mansjett/brannpakning). Stk = vanlig dim-input.
    // Meter = dim-inputs disables, antall fylles i picker etter OK.
    specMeterMode = false;
    var modeToggle = document.getElementById('spec-popup-mode-toggle');
    if (modeToggle) {
        // !isFixedSizeMaterial: fast-størrelse-produkter opererer ikke i meter —
        // samme gate som «+ LM» i openSpecMultiPopup.
        if ((specPopupMatType === 'mansjett' || specPopupMatType === 'brannpakning')
            && !isFixedSizeMaterial(baseName)) {
            modeToggle.style.display = '';
            modeToggle.querySelectorAll('.kappe-picker-mode-btn').forEach(function(btn) {
                btn.classList.toggle('active', btn.getAttribute('data-mode') === 'stk');
            });
        } else {
            modeToggle.style.display = 'none';
        }
    }
    // Sørg for at inputene starter aktive (kan ha vært disabled fra forrige åpning)
    input.disabled = false;
    input2.disabled = false;
    input3.disabled = false;

    specPopupCallback = callback;
    var keyHandler = function(e) {
        if (e.key === 'Enter') { e.preventDefault(); confirmSpecPopup(); }
        if (e.key === 'Escape') { e.preventDefault(); closeSpecPopup(); }
    };
    input.onkeydown = keyHandler;
    input2.onkeydown = keyHandler;
    input3.onkeydown = keyHandler;
    if (meterInput) meterInput.onkeydown = keyHandler;
    document.getElementById('spec-popup').classList.add('active');
    if (prefill && prefill.isMeter) {
        // Prefill av meter-rad: åpne i meter-modus.
        toggleSpecMeterMode();
    } else {
        // Fokuser synkront i samme gest: da er fokus i popupen FØR første
        // applyKeyboardLayout-apply, så popupen posisjoneres rett (ingen
        // «anker → snap til topp»-hopp ved åpning).
        try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
    }
    requestAnimationFrame(_anchorSpecPopupTop);
}

function closeSpecPopup() {
    var sp = document.getElementById('spec-popup');
    sp.classList.remove('active');
    if (typeof _clearPopupTopAnchor === 'function') _clearPopupTopAnchor('spec-popup');
    specPopupCallback = null;
    specPopupMatType = 'kabelhylse';
    specMeterMode = false;
}

// Måler høyeste modus (Stk dim-felter) uansett aktiv modus via synkron
// display-toggle (ingen flicker) og topp-forankrer spec-popupen der. Toppen +
// Stk/Meter-toggle står fast; boksen følger innhold (CLAUDE.md "Popup-størrelse").
function _anchorSpecPopupTop() {
    var sp = document.getElementById('spec-popup');
    if (!sp || !sp.classList.contains('active')) return;
    var sheet = sp.querySelector('.spec-popup-sheet');
    if (!sheet) return;
    var input1 = document.getElementById('spec-popup-input');
    var field1 = input1 ? input1.parentElement : null;
    var field2 = document.getElementById('spec-popup-field2');
    var field3 = document.getElementById('spec-popup-field3');
    var meterField = document.getElementById('spec-popup-meter-field');
    var saved = {
        f1: field1 ? field1.style.display : null,
        f2: field2 ? field2.style.display : null,
        f3: field3 ? field3.style.display : null,
        m: meterField ? meterField.style.display : null
    };
    sheet.style.minHeight = '';
    if (field1) field1.style.display = '';
    if (field2) field2.style.display = '';
    if (field3) field3.style.display = (specPopupMatType === 'mansjett') ? 'none' : '';
    if (meterField) meterField.style.display = 'none';
    var measured = sheet.offsetHeight;
    if (field1) field1.style.display = saved.f1;
    if (field2) field2.style.display = saved.f2;
    if (field3) field3.style.display = saved.f3;
    if (meterField) meterField.style.display = saved.m;
    if (measured > 0 && typeof _applyPopupTopAnchor === 'function') {
        _applyPopupTopAnchor('spec-popup', measured);
    }
}

function _setSpecPopupMode(mode) {
    specMeterMode = (mode === 'meter');
    var input1 = document.getElementById('spec-popup-input');
    var input2 = document.getElementById('spec-popup-input2');
    var input3 = document.getElementById('spec-popup-input3');
    var field1 = input1.parentElement;
    var field2 = document.getElementById('spec-popup-field2');
    var field3 = document.getElementById('spec-popup-field3');
    var meterField = document.getElementById('spec-popup-meter-field');
    var meterInput = document.getElementById('spec-popup-meter-input');
    var toggle = document.getElementById('spec-popup-mode-toggle');

    // KRITISK rekkefølge: vis MÅL-feltet og flytt fokus dit SYNKRONT FØR vi
    // skjuler det gamle. Skjuler vi det fokuserte feltet (display:none) mens
    // det har fokus, blurrer browseren det → Android lukker tastaturet og
    // åpner det igjen ved re-fokus («lukk/åpne et splittsekund»). Ved å
    // flytte fokus først forblir tastaturet åpent kontinuerlig.
    if (specMeterMode) {
        // Meter-modus: vis + fokuser meter-input, DERETTER skjul dim-feltene.
        if (meterField) meterField.style.display = '';
        if (meterInput) { try { meterInput.focus({ preventScroll: true }); } catch (e) { meterInput.focus(); } }
        if (field1) field1.style.display = 'none';
        if (field2) field2.style.display = 'none';
        if (field3) field3.style.display = 'none';
    } else {
        // Stk-modus: vis + fokuser dim-felt, DERETTER skjul meter-input.
        if (field1) field1.style.display = '';
        if (field2) field2.style.display = '';
        if (field3) field3.style.display = (specPopupMatType === 'mansjett') ? 'none' : '';
        input1.disabled = false;
        input2.disabled = false;
        input3.disabled = false;
        try { input1.focus({ preventScroll: true }); } catch (e) { input1.focus(); }
        if (meterField) meterField.style.display = 'none';
    }
    if (toggle) {
        toggle.querySelectorAll('.kappe-picker-mode-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
        });
    }
    // Høyden endres ved modus-bytte (topp fast, bunn flytter); be tastatur-
    // handleren re-beregne transform/max-height umiddelbart (ikke vent på ResizeObserver).
    if (typeof window.applyKeyboardLayout === 'function') window.applyKeyboardLayout();
}
window._setSpecPopupMode = _setSpecPopupMode;

// Beholdt som alias for prefill-flyten som tvinger meter-modus ved redigering av meter-rad.
function toggleSpecMeterMode() {
    _setSpecPopupMode(specMeterMode ? 'stk' : 'meter');
}

function confirmSpecPopup() {
    // Meter-modus: bruker skriver meter direkte i popupen.
    if (specMeterMode) {
        var meterEl = document.getElementById('spec-popup-meter-input');
        var meterVal = meterEl ? String(meterEl.value || '').trim() : '';
        var meterNum = parseFloat(meterVal.replace(',', '.'));
        if (!meterVal || isNaN(meterNum) || meterNum <= 0) {
            showNotificationModal('Fyll inn meter.');
            return;
        }
        if (specPopupCallback) specPopupCallback(null, meterVal);
        closeSpecPopup();
        return;
    }

    const val1 = document.getElementById('spec-popup-input').value.trim();
    const val2 = document.getElementById('spec-popup-input2').value.trim();
    const val3 = document.getElementById('spec-popup-input3').value.trim();
    if (!val1) {
        showNotificationModal(t('dim_invalid_diameter'));
        return;
    }

    const num1 = parseInt(val1, 10);
    if (isNaN(num1) || num1 <= 0) {
        showNotificationModal(t('dim_invalid_diameter'));
        return;
    }
    var num2 = val2 ? parseInt(val2, 10) : 0;
    var num3 = val3 ? parseInt(val3, 10) : 0;
    var spec;

    if (specPopupMatType === 'mansjett') {
        // Mansjett: bredde/Ø + høyde(valgfri), ingen runder
        var isSquare = num2 > 0;
        if (isSquare) {
            spec = num1 + 'x' + num2 + 'mm';
        } else {
            spec = '\u00d8' + num1 + 'mm';
        }
    } else if (specPopupMatType === 'brannpakning') {
        // Brannpakning: bredde/Ø + høyde(valgfri) + runder(obligatorisk)
        if (!num3 || num3 <= 0) {
            showNotificationModal(t('dim_invalid_diameter'));
            return;
        }
        var isSquare = num2 > 0;
        if (isSquare) {
            spec = num1 + 'x' + num2;
        } else {
            spec = '\u00d8' + num1;
        }
        spec += 'mm';
        if (num3 > 1) {
            spec += ' ' + num3 + ' lag';
        }
    } else {
        // Kabelhylse: bredde/Ø + høyde(valgfri) + dybde(obligatorisk)
        if (!num3 || num3 <= 0) {
            showNotificationModal(t('dim_invalid_diameter'));
            return;
        }
        if (num2 > 0) {
            spec = num1 + 'x' + num2 + 'x' + num3 + 'mm';
        } else {
            spec = '\u00d8' + num1 + 'x' + num3 + 'mm';
        }
    }
    if (specPopupCallback) specPopupCallback(spec);
    closeSpecPopup();
}

function pickerOverlayConfirm() {
    if (!pickerOrderCard && !pickerConfirmCallback) { closePickerOverlay(); return; }

    // Helper: check if name is a spec-base material (launcher) — should never be exported
    var allMats = getMaterialPickerOptions(cachedMaterialOptions || []);
    function isSpecBase(name) {
        if (name === MATERIAL_KAPPE_LAUNCHER) return true;
        if (name === MATERIAL_ISOLATION_LAUNCHER) return true;
        return allMats.some(function(m) {
            return m.name === name && (m.type === 'mansjett' || m.type === 'brannpakning' || m.type === 'kabelhylse' || m.type === 'kappe-isolation');
        });
    }



    // Validate: warn if any material has partial data (skip spec-base launchers)
    const incomplete = [];
    for (const [name, state] of Object.entries(pickerState)) {
        if (isSpecBase(name)) continue;
        const hasAntall = !!state.antall;
        const hasEnhet = !!state.enhet;
        if (state.checked && (!hasAntall || !hasEnhet)) {
            incomplete.push(name);
        }
    }
    if (incomplete.length > 0) {
        showNotificationModal(t('picker_incomplete', incomplete.join(', ')));
        return;
    }

    const materials = [];
    for (const [name, state] of Object.entries(pickerState)) {
        if (isSpecBase(name)) continue;
        if (state.checked) {
            // Strip internal picker suffixes before persisting materials.
            const parsedKey = parseMaterialPickerKey(name);
            const realName = parsedKey.realName;
            var source = state.source || ((!hasConfiguredMaterialName(name) && isKappeIsolationMaterial(name, state.source)) ? 'kappe-products'
                : ((!hasConfiguredMaterialName(name) && isKappeStiftMaterial(name, state.source, state.enhet)) ? 'kappe-stift' : ''));
            var material = { name: realName, antall: state.antall || '', enhet: state.enhet || '' };
            if (source) material.source = source;
            // Opphav for festemidler: egen Festemidler-gruppe vs. festemiddel i
            // Isolasjon-gruppen. Persisteres så grupperingen overlever gjenåpning.
            if (state.stiftGroup) material.stiftGroup = true;
            if (state.quantityUnit) material.quantityUnit = state.quantityUnit;
            // Isolasjon: bredde + specMode + plate (plate-dim trengs til kalkulering).
            if (source === 'kappe-products') {
                if (state.specMode === 'plate') {
                    material.specMode = 'plate';
                } else if (state.bredde) {
                    material.bredde = state.bredde;
                    material.specMode = 'bredde';
                } else if (state.specMode === 'bredde') {
                    material.specMode = 'bredde';
                }
                if (state.plate && (state.plate.length || state.plate.width)) {
                    material.plate = state.plate;
                }
                if (state.lmPerSide) material.lmPerSide = state.lmPerSide;
                if (state.antallObjekter) material.antallObjekter = state.antallObjekter;
                if (state.sider) material.sider = state.sider;
                if (state.kappeOrient) material.kappeOrient = state.kappeOrient;
            }
            materials.push(material);
        }
    }

    if (pickerConfirmCallback) {
        pickerConfirmCallback(materials);
        pickerConfirmCallback = null;
        closePickerOverlay();
        return;
    }

    const matContainer = pickerOrderCard.querySelector('.mobile-order-materials');
    renderMaterialSummary(matContainer, materials);
    if (typeof _updateOrderSkipUI === 'function') _updateOrderSkipUI(pickerOrderCard);
    if (pickerOrderCard.closest('#service-entries')) {
        sessionStorage.setItem('firesafe_service_current', JSON.stringify(getServiceFormData()));
    } else {
        sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    }
    closePickerOverlay();
}

// Variant popup for standard materials with variants
let variantPopupCallback = null;

function openVariantPopup(baseName, options, callback) {
    variantPopupCallback = callback;
    document.getElementById('variant-popup-title').textContent = baseName;
    var listEl = document.getElementById('variant-popup-list');
    var html = '';
    options.forEach(function(v) {
        var label = v.label || (typeof v === 'string' ? v : (v.plural || v.singular || v));
        html += '<button type="button" class="variant-popup-btn" onclick="selectVariant(\'' + escapeHtml(label).replace(/'/g, "\\'") + '\',\'variant\')">' + escapeHtml(label) + '</button>';
    });
    listEl.innerHTML = html;
    document.getElementById('variant-popup').classList.add('active');
}

function selectVariant(variant, type) {
    if (variantPopupCallback) variantPopupCallback(variant, type || 'variant');
    closeVariantPopup();
}

function closeVariantPopup() {
    document.getElementById('variant-popup').classList.remove('active');
    variantPopupCallback = null;
}

// ============================================
// PLAN PICKER
// ============================================
let _planPickerDisplay = null;
let _planPickerState = {};

function openPlanPicker(displayEl) {
    // Normalize: if called from "+ Plan" button, find the sibling .plan-display
    if (!displayEl.classList.contains('plan-display')) {
        var field = displayEl.closest('.mobile-field');
        if (field) displayEl = field.querySelector('.plan-display') || displayEl;
    }
    _planPickerDisplay = displayEl;
    document.getElementById('plan-popup').classList.add('active');

    // If cache is empty and user is logged in, fetch from Firebase first
    if ((!cachedPlanOptions || cachedPlanOptions.length === 0) && currentUser && db && typeof loadPlanOptions === 'function') {
        document.getElementById('plan-popup-list').innerHTML = '<div class="popup-list-empty">' + t('loading') + '</div>';
        loadPlanOptions().then(function() { _renderPlanPickerList(displayEl); });
        return;
    }
    _renderPlanPickerList(displayEl);
}

// keepState: behold avhukingene som ligger i _planPickerState i stedet for å lese
// dem på nytt fra elementet. Brukes etter at en etasje er lagt til fra popupen —
// ellers ville brukerens valg blitt nullstilt av re-renderingen.
function _renderPlanPickerList(displayEl, keepState) {
    var existing = (displayEl.getAttribute('data-plan') || '').split(',').map(s => s.trim()).filter(s => s);
    var options = cachedPlanOptions || [];
    var prevState = keepState ? _planPickerState : null;
    _planPickerState = {};
    if (prevState) {
        Object.keys(prevState).forEach(function(k) { if (prevState[k]) existing.push(k); });
    }

    var listEl = document.getElementById('plan-popup-list');
    var html = '';

    // Add configured options
    options.forEach(function(name) {
        _planPickerState[name] = existing.indexOf(name) !== -1;
        html += '<div class="plan-popup-row' + (_planPickerState[name] ? ' plan-popup-selected' : '') + '" data-plan="' + escapeHtml(name) + '">' +
            '<span class="plan-popup-check">\u2713</span>' +
            '<span class="plan-popup-name">' + escapeHtml(name) + '</span>' +
            '</div>';
    });

    // Add existing values not in options (backward compat)
    existing.forEach(function(name) {
        if (!_planPickerState.hasOwnProperty(name)) {
            _planPickerState[name] = true;
            html += '<div class="plan-popup-row plan-popup-selected" data-plan="' + escapeHtml(name) + '">' +
                '<span class="plan-popup-check">\u2713</span>' +
                '<span class="plan-popup-name">' + escapeHtml(name) + '</span>' +
                '</div>';
        }
    });

    if (!html) {
        html = '<div class="popup-list-empty">' + t('settings_no_plans') + '</div>';
    }

    // Admin kan legge til etasjer direkte her — uten dette måtte man ut av
    // skjemaet og inn i Innstillinger, og den tomme lista var en blindvei.
    // Samme mønster som «Nytt materiale» i materialvelgeren, og samme
    // admin-gate: _persistPlanList krever den.
    if (typeof isAdmin !== 'undefined' && isAdmin) {
        html += '<div class="plan-popup-add">' +
            '<input type="text" id="plan-popup-new" class="plan-popup-add-input" placeholder="' +
                escapeHtml(t('settings_plan_placeholder')) + '" autocapitalize="characters" autocomplete="off">' +
            '<button type="button" class="plan-popup-add-btn" onclick="addPlanFromPicker()">+</button>' +
        '</div>';
    }

    listEl.innerHTML = html;

    // Attach click handlers
    listEl.querySelectorAll('.plan-popup-row').forEach(function(row) {
        row.addEventListener('click', function() {
            var name = this.getAttribute('data-plan');
            _planPickerState[name] = !_planPickerState[name];
            this.classList.toggle('plan-popup-selected');
        });
    });

    // Enter i feltet legger til, så man slipper å sikte på knappen.
    var newInp = document.getElementById('plan-popup-new');
    if (newInp) {
        newInp.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); addPlanFromPicker(); }
        });
    }
}

function confirmPlanPicker() {
    var selected = [];
    for (var name in _planPickerState) {
        if (_planPickerState[name]) selected.push(name);
    }
    // Sort by original options order
    var options = cachedPlanOptions || [];
    selected.sort(function(a, b) {
        var ia = options.indexOf(a);
        var ib = options.indexOf(b);
        if (ia === -1) ia = 999;
        if (ib === -1) ib = 999;
        return ia - ib;
    });
    var val = selected.join(', ');
    _planPickerDisplay.setAttribute('data-plan', val);
    if (_planPickerDisplay.classList.contains('dag-timer-etasje-btn')) {
        // Bestilling-nivå etasje-knapp i Dager & tid-modalen.
        _planPickerDisplay.textContent = val || '+ Etasje';
        _planPickerDisplay.classList.toggle('dag-timer-etasje-btn--empty', !val);
        document.getElementById('plan-popup').classList.remove('active');
        var modalE = document.getElementById('dag-timer-modal');
        if (modalE) modalE.classList.remove('dag-timer-modal--hidden');
        return;
    }
    if (_planPickerDisplay.classList.contains('dag-timer-plan-btn')) {
        // Per-dag plan-trigger i Dager & tid-modal: oppdater trigger + values-display.
        // dag-timer-modalen ble skjult når picker åpnet — vis den igjen.
        _planPickerDisplay.textContent = val ? 'Endre' : '+ Etasje';
        _planPickerDisplay.classList.toggle('dag-timer-plan-btn--empty', !val);
        var dayRow = _planPickerDisplay.closest('.dag-timer-modal-row');
        if (dayRow) {
            var valuesEl = dayRow.querySelector('.dag-timer-plan-values');
            if (valuesEl) {
                valuesEl.style.display = val ? '' : 'none';
                valuesEl.textContent = val;
            }
        }
        document.getElementById('plan-popup').classList.remove('active');
        var modal = document.getElementById('dag-timer-modal');
        if (modal) modal.classList.remove('dag-timer-modal--hidden');
        return;
    } else {
        var dispText = _planPickerDisplay.querySelector('.plan-display-text');
        if (dispText) dispText.textContent = val;
        var card = _planPickerDisplay.closest('.mobile-order-card') || _planPickerDisplay.closest('.service-entry-card');
        var planBtn = card && card.querySelector('.mobile-plan-btn');
        if (val) {
            _planPickerDisplay.style.display = '';
            if (planBtn) planBtn.style.display = 'none';
        } else {
            _planPickerDisplay.style.display = 'none';
            if (planBtn) planBtn.style.display = '';
        }
    }
    closePlanPicker();
}

function closePlanPicker() {
    document.getElementById('plan-popup').classList.remove('active');
    // Vis dag-timer-modal igjen om den var skjult under plan-valg
    var modal = document.getElementById('dag-timer-modal');
    if (modal) modal.classList.remove('dag-timer-modal--hidden');
    _planPickerDisplay = null;
    _planPickerState = {};

}

function updateOrderTitle(card) {
    var titleEl = card.querySelector('.mobile-order-title');
    if (!titleEl) return;
    var descInput = card.querySelector('.mobile-order-desc');
    var fullText = descInput ? descInput.value : '';
    var trimmed = fullText.trim();
    var cards = document.querySelectorAll('#mobile-orders .mobile-order-card');
    var idx = Array.prototype.indexOf.call(cards, card);
    var num = idx >= 0 ? idx + 1 : cards.length + 1;
    var wrap = card.querySelector('.mobile-order-body-wrap');
    var isExpanded = wrap && wrap.classList.contains('expanded');
    if (isExpanded) {
        titleEl.textContent = t('order_title') + ' ' + num;
    } else if (trimmed) {
        titleEl.textContent = num + '. ' + trimmed;
    } else {
        titleEl.textContent = t('order_title') + ' ' + num;
    }
}

var dagTimerActiveCard = null;
// Arbeidstid-editoren redigerer nå via en SESSION-abstraksjon, så samme editor
// kan brukes på BÅDE den åpne ordreseddelens DOM-kort OG en lagret ordreseddels
// data-objekt (uke-oversikten). En session = { getTimer(), getPlans(),
// commit(timer,dager,plans), afterClose() }.
var _dagTimerSession = null;

// DOM-kort-session: leser/skriver kortets data-attributter (uendret oppførsel).
// afterClose kan overstyres (f.eks. dag-visningen returnerer dit i stedet for
// bestilling-oversikten); default = _maybeReturnToTimerOverview.
// ── Uker og timer ────────────────────────────────────────────────────────────
// Uke-feltet er fritekst og skrives ut verbatim på ordreseddelen. Men det brukes
// OGSÅ som nøkkel: hvilke uker gjelder timene? De to rollene skilles her — teksten
// røres ikke, men vi utleder et sett med ukenumre fra den.
//
// Uten dette kunne en ordreseddel over «30 & 31» bare lagre SYV ukedags-felt, så
// to onsdager havnet i samme celle («Onsdag 21 t»). Den informasjonen var tapt ved
// registrering og kunne ikke gjenskapes i etterkant.
//
// Håndterer «30 & 31», «31 & 30», «30-31», «30 og 31», «30, 31», «30/31»,
// «Uke 30 til 31». Gir tom liste når teksten ikke inneholder ukenumre
// («sommerferie») — da faller alt tilbake til den flate ukedags-lista som før.
function parseUkeNumbers(text) {
    var s = String(text == null ? '' : text).toLowerCase().replace(/uke/g, ' ');
    var found = {};
    var add = function(n) { if (n >= 1 && n <= 53) found[n] = true; };
    // Intervaller FØRST, og de fjernes fra strengen så endepunktene ikke telles
    // en gang til av det løse tall-søket under.
    s = s.replace(/(\d{1,2})\s*(?:-|\u2013|til|t\.o\.m\.)\s*(\d{1,2})/g, function(_, a, b) {
        a = parseInt(a, 10); b = parseInt(b, 10);
        if (b >= a && b - a <= 53) { for (var i = a; i <= b; i++) add(i); }
        return ' ';
    });
    s.replace(/\d{1,2}/g, function(n) { add(parseInt(n, 10)); return ''; });
    return Object.keys(found).map(Number).sort(function(a, b) { return a - b; });
}

// Hvilken uke flate timer (uten .uker-fordeling) trygt kan tilskrives: KUN når
// skjemaet dekker NØYAKTIG ÉN uke — da hører alle timene per definisjon til den.
// Dekker skjemaet null eller flere uker, er fordelingen ukjent, og da skal det
// ikke gjettes. Gjelder gamle skjemaer og skjemaer lagret i perioden der
// getFormData droppet `uker`; de har timer, men ingen fordeling.
function soleWeekOf(weeks) {
    return (weeks && weeks.length === 1) ? String(weeks[0]) : '';
}

// Ukene ordreseddelen som er ÅPEN gjelder for. Tom liste = ukjent.
function currentFormUkeNumbers() {
    var el = document.getElementById('mobile-dato');
    return parseUkeNumbers(el ? el.value : '');
}

var TIMER_DAY_KEYS_CORE = ['ma', 'ti', 'on', 'to', 'fr', 'lo', 'so'];

// Timer-objektet har to lag:
//   flate nøkler (ma, ti, … _generelt)  = SUM på tvers av uker
//   .uker = { "30": {ma,…,_generelt}, "31": {…} }  = kilden, per uke
// De flate nøklene beholdes fordi ALLE eksisterende lesere (eksport, PDF,
// ordrekort, timer-oversikt) bruker dem — de fortsetter å virke uendret. De
// regnes alltid ut på nytt fra .uker ved lagring, så de kan ikke drive fra
// hverandre. Mangler .uker (data lagret før dette), ER de flate nøklene dataen.
function timerWeekBuckets(timer, weeks) {
    var out = {};
    var known = (weeks || []).map(String);
    if (timer && timer.uker && typeof timer.uker === 'object') {
        // Behold alle lagrede uker, også de som ikke lenger står i Uke-feltet —
        // ellers ville timer forsvunnet stille om noen retter teksten.
        Object.keys(timer.uker).forEach(function(w) { out[w] = Object.assign({}, timer.uker[w]); });
        known.forEach(function(w) { if (!out[w]) out[w] = {}; });
        return out;
    }
    // Migrering av flate data: én uke → entydig. Flere uker → informasjonen om
    // hvilken uke finnes ikke, så alt legges på FØRSTE uke. Totalen bevares, og
    // fordelingen kan rettes manuelt. Se kommentaren over parseUkeNumbers.
    var flat = {};
    TIMER_DAY_KEYS_CORE.forEach(function(k) { if (timer && timer[k]) flat[k] = timer[k]; });
    var gen = timer && (timer._generelt || timer._total);
    if (gen) flat._generelt = gen;
    if (!known.length) return { '': flat };
    known.forEach(function(w, i) { out[w] = (i === 0) ? flat : {}; });
    return out;
}

// Bygg timer-objektet fra uke-bøttene: flate summer + .uker.
function timerFromWeekBuckets(buckets) {
    var timer = {};
    var uker = {};
    var anyWeek = false;
    Object.keys(buckets).forEach(function(w) {
        var b = buckets[w] || {};
        var kept = {};
        TIMER_DAY_KEYS_CORE.concat(['_generelt']).forEach(function(k) {
            var v = String(b[k] == null ? '' : b[k]).trim();
            if (!v) return;
            kept[k] = v;
            var n = parseFloat(v.replace(',', '.'));
            if (isNaN(n)) return;
            var prev = parseFloat(String(timer[k] || '0').replace(',', '.'));
            if (isNaN(prev)) prev = 0;
            var sum = prev + n;
            // Hele tall uten desimal, ellers én desimal med komma — samme form
            // som brukeren selv skriver.
            timer[k] = (Math.round(sum * 10) / 10).toString().replace('.', ',');
        });
        if (w && Object.keys(kept).length) { uker[w] = kept; anyWeek = true; }
    });
    if (anyWeek) timer.uker = uker;
    return timer;
}

// ── Personer: hvem har utført timene ────────────────────────────────────────
// Timer-objektet har nå TRE lag, hvert avledet av det under:
//   flate nøkler (ma, ti, … _generelt)  = sum på tvers av personer OG uker
//   .uker = { "30": {…}, "31": {…} }    = sum per uke, på tvers av personer
//   .personer = [ { navn, uker } ]      = KILDEN når flere har jobbet
//
// De to øverste lagene beholder nøyaktig samme betydning som før, så ALLE
// eksisterende lesere (eksport-totaler, PDF, timer-chip, uke-oversikt,
// orderHoursForWeek) fortsetter å virke uendret — de ser summen slik de alltid
// har gjort. Det er derfor person kunne legges til uten å røre dem.
//
// .personer skrives KUN når den tilfører noe: to eller flere personer, eller én
// person som ikke er meg (jeg fører for en kollega). Jobber jeg alene, er
// timer-objektet bit-identisk med det appen lagret før denne endringen — ingen
// migrering, og ingen falsk «ulagret» på eksisterende ordresedler.
var TIMER_BUCKET_KEYS = TIMER_DAY_KEYS_CORE.concat(['_generelt']);

function _timerFmtNum(n) {
    // Hele tall uten desimal, ellers én desimal med komma — samme form som
    // brukeren selv skriver, og som timerFromWeekBuckets bruker.
    return (Math.round(n * 10) / 10).toString().replace('.', ',');
}

function _timerTrim(v) { return String(v == null ? '' : v).trim(); }

// Slå sammen flere bøtte-kart ({uke: {dag: timer}}) til ett, med summering per
// (uke, dag). Brukes til å utlede .uker fra personene.
function _mergeBucketMaps(maps) {
    var out = {};
    (maps || []).forEach(function(m) {
        Object.keys(m || {}).forEach(function(w) {
            var src = m[w] || {};
            var dst = out[w] || (out[w] = {});
            TIMER_BUCKET_KEYS.forEach(function(d) {
                var v = _timerTrim(src[d]);
                if (!v) return;
                var n = parseFloat(v.replace(',', '.'));
                if (isNaN(n)) { if (!dst[d]) dst[d] = v; return; }
                var prev = parseFloat(_timerTrim(dst[d] || '0').replace(',', '.'));
                if (isNaN(prev)) prev = 0;
                dst[d] = _timerFmtNum(prev + n);
            });
        });
    });
    return out;
}

// Behold bare dager med verdi; dropp tomme uker.
function _cleanBucketMap(map) {
    var out = {};
    Object.keys(map || {}).forEach(function(w) {
        var src = map[w] || {};
        var kept = {};
        TIMER_BUCKET_KEYS.forEach(function(d) {
            var v = _timerTrim(src[d]);
            if (v) kept[d] = v;
        });
        if (Object.keys(kept).length) out[w] = kept;
    });
    return out;
}

// Er personlista verdt å lagre? Se blokk-kommentaren over.
function _shouldStorePersons(persons, myName) {
    if (!persons || !persons.length) return false;
    if (persons.length > 1) return true;
    var only = _timerTrim(persons[0].navn).toLowerCase();
    var me = _timerTrim(myName).toLowerCase();
    return !!only && only !== me;
}

// Har dette timer-objektet en personfordeling? (Ellers er timene «mine».)
function timerHasPersons(timer) {
    return !!(timer && Array.isArray(timer.personer) && timer.personer.length);
}

// Timer-objekt → redigerbar personliste [{navn, buckets}].
// Uten .personer får vi ÉN person (meg) med dagens bøtter — da oppfører popupen
// seg nøyaktig som før.
function timerPersonList(timer, weeks, myName) {
    if (timerHasPersons(timer)) {
        return timer.personer.map(function(p) {
            return {
                navn: _timerTrim(p && p.navn),
                buckets: timerWeekBuckets({ uker: (p && p.uker) || {} }, weeks)
            };
        });
    }
    return [{ navn: _timerTrim(myName), buckets: timerWeekBuckets(timer, weeks) }];
}

// Redigerbar personliste → timer-objekt (alle tre lag).
function timerFromPersonList(persons, myName) {
    var clean = [];
    (persons || []).forEach(function(p) {
        var uker = _cleanBucketMap(p && p.buckets);
        if (!Object.keys(uker).length) return;      // person uten timer lagres ikke
        clean.push({ navn: _timerTrim(p && p.navn), uker: uker });
    });
    var merged = _mergeBucketMaps(clean.map(function(p) { return p.uker; }));
    var timer = timerFromWeekBuckets(merged);
    if (_shouldStorePersons(clean, myName)) timer.personer = clean;
    return timer;
}

// Timer ført av ÉN person på tvers av alle uker. Uten personfordeling er alle
// timene mine, så da svarer den for meg og 0 for alle andre.
function orderHoursForPerson(timer, personName, myName) {
    if (!timer || typeof timer !== 'object') return 0;
    var want = _timerTrim(personName).toLowerCase();
    var sum = 0;
    var addBucket = function(b) {
        TIMER_BUCKET_KEYS.forEach(function(d) {
            var n = parseFloat(_timerTrim(b[d]).replace(',', '.'));
            if (!isNaN(n)) sum += n;
        });
    };
    if (timerHasPersons(timer)) {
        timer.personer.forEach(function(p) {
            if (_timerTrim(p.navn).toLowerCase() !== want) return;
            Object.keys(p.uker || {}).forEach(function(w) { addBucket(p.uker[w] || {}); });
        });
        return sum;
    }
    if (want && want !== _timerTrim(myName).toLowerCase()) return 0;
    return orderTimerSum(timer);
}

// Alle personnavn i et timer-objekt, i lagret rekkefølge. Tom liste = ingen
// fordeling (timene er mine).
function timerPersonNames(timer) {
    if (!timerHasPersons(timer)) return [];
    var out = [], seen = {};
    timer.personer.forEach(function(p) {
        var n = _timerTrim(p && p.navn);
        if (!n || seen[n.toLowerCase()]) return;
        seen[n.toLowerCase()] = true;
        out.push(n);
    });
    return out;
}

// Uke-feltet er en ETIKETT på ordreseddelen, ikke en nøkkel timene eies av.
// Timene tilhører BESTILLINGEN: fører du 2 t lørdag, skal ordreseddelen vise 2 t
// lørdag — uansett hva som senere står i Uke-feltet. Retter du en uke du førte
// feil, skal timene bli med over.
//
// timer.uker finnes utelukkende for å holde to LIKE ukedager fra hverandre når
// ordreseddelen dekker flere uker («30 & 31» har to onsdager). Bøttene er derfor
// POSISJONELLE: første bøtte hører til første uke i Uke-feltet, andre bøtte til
// den andre. Endres Uke-feltet, følger bøttene med, posisjon for posisjon:
//
//   [35] → [34]         bøtta flyttes til uke 34 — 2 t lørdag står der den skal
//   [30,31] → [31,32]   posisjon for posisjon
//   [30,31] → [30]      to bøtter slås sammen (summeres) — ingen timer forsvinner
//   [30] → [30,31]      uke 31 blir tom, klar til utfylling
//   [30] → «sommerferie»  ingen ukenumre å feste til → bøttene beholdes urørt
//
// Totalen er alltid uendret: de flate nøklene regnes ut på nytt fra bøttene av
// timerFromWeekBuckets, så det er kun ETIKETTEN som flyttes.
// Timer ført av MEG — brukt av «Timer uke N»-chipen, som svarer på «hvor mye har
// JEG ført denne uka». Uten en personfordeling er alle timene mine, akkurat som
// før personer fantes; det gjør at eldre ordresedler teller uendret.
function orderHoursForWeekMine(timer, week, myName) {
    if (!timerHasPersons(timer)) return orderHoursForWeek(timer, week);
    var want = _timerTrim(myName).toLowerCase();
    if (!want) return 0;
    var sum = 0;
    timer.personer.forEach(function(p) {
        if (_timerTrim(p && p.navn).toLowerCase() !== want) return;
        var b = ((p && p.uker) || {})[String(week)];
        if (!b) return;
        TIMER_BUCKET_KEYS.forEach(function(d) {
            var n = parseFloat(_timerTrim(b[d]).replace(',', '.'));
            if (!isNaN(n)) sum += n;
        });
    });
    return sum;
}

function orderTimerSumMine(timer, myName) {
    if (!timerHasPersons(timer)) return orderTimerSum(timer);
    return orderHoursForPerson(timer, myName, myName);
}

// Navnet(e) til Montør-cella i eksporten. Har bestillingene en personfordeling,
// er det DE som har utført arbeidet — da skal cella vise dem, ikke meg. Fører jeg
// timer for en kollega uten å ha vært der selv, ville «Montør: Igor, Ola» stått
// for at jeg var på jobben, og det er ikke sant.
//
// Uten personfordeling er timene mine, og cella viser montør-feltet som før.
// Merk: `data.montor` selv røres ALDRI — den er fortsatt ett fornavn, slik
// stripEtternavn og resten av felt-koden forventer.
function formMontorLabel(data) {
    var names = [], seen = {};
    (data && Array.isArray(data.orders) ? data.orders : []).forEach(function(o) {
        timerPersonNames(o && o.timer).forEach(function(n) {
            var key = n.toLowerCase();
            if (seen[key]) return;
            seen[key] = true;
            names.push(n);
        });
    });
    if (names.length) return names.join(', ');
    return stripEtternavn(data && data.montor);
}

// Alle uker som forekommer i timer-objektet — både på toppnivå og hos hver
// person. ÉN felles liste er nødvendig fordi personer kan ha ULIK uke-dekning:
// jobbet Igor uke 30 og 31, men Ola bare uke 31, ville en per-person posisjonell
// flytting sendt Olas eneste bøtte til første måluke — altså en annen uke enn
// Igors timer fra samme dag. Alle skal flyttes med SAMME mapping.
function _timerAllWeekKeys(timer) {
    var seen = {};
    var add = function(map) { Object.keys(map || {}).forEach(function(w) { if (w) seen[w] = true; }); };
    if (timer && timer.uker && typeof timer.uker === 'object') add(timer.uker);
    if (timerHasPersons(timer)) timer.personer.forEach(function(p) { add(p && p.uker); });
    return Object.keys(seen).sort(function(a, b) { return parseInt(a, 10) - parseInt(b, 10); });
}

// gammel uke → ny uke. Flere gamle uker enn nye → de overskytende peker på SISTE
// nye uke, så de slås sammen der. Alternativet ville vært å droppe dem, og da
// forsvant timer.
function _buildWeekMapping(oldWeeks, target) {
    var map = {};
    oldWeeks.forEach(function(k, i) { map[k] = target[Math.min(i, target.length - 1)]; });
    // Den tomme nøkkelen er «ukjent uke» (Uke-feltet var fritekst uten ukenummer).
    // Nå som vi VET uken, hører de timene til den første — samme regel som
    // timerWeekBuckets bruker når flate data skal fordeles.
    map[''] = target[0];
    return map;
}

// Bygg om ett bøtte-kart etter mappingen. Returnerer null når ingenting endret seg,
// så kallerne kan skille «uendret» fra «ny verdi».
function _applyWeekMapping(bucketMap, map) {
    var keys = Object.keys(bucketMap || {});
    if (!keys.length) return null;
    var out = {};
    var changed = false;
    keys.sort(function(a, b) { return parseInt(a, 10) - parseInt(b, 10); }).forEach(function(k) {
        var dest = (map[k] !== undefined) ? map[k] : k;
        if (dest !== k) changed = true;
        out[dest] = out[dest] || {};
        var src = bucketMap[k] || {};
        TIMER_BUCKET_KEYS.forEach(function(d) {
            var v = _timerTrim(src[d]);
            if (!v) return;
            if (!out[dest][d]) { out[dest][d] = v; return; }
            changed = true;                                  // to bøtter slått sammen
            var a = parseFloat(_timerTrim(out[dest][d]).replace(',', '.'));
            var n = parseFloat(v.replace(',', '.'));
            if (isNaN(a) || isNaN(n)) { out[dest][d] = v; return; }
            out[dest][d] = _timerFmtNum(a + n);
        });
    });
    return changed ? out : null;
}

// Finnes det timer ført på «ukjent uke» (den tomme nøkkelen)? De skal flyttes til
// den første kjente uka så snart brukeren skriver inn et ukenummer — ellers ville
// timer ført mens Uke-feltet var utolkbar fritekst blitt liggende utenfor alle
// ukene, og aldri telt med i uke-summeringen.
function _timerHasUnknownWeekBucket(timer) {
    if (timer && timer.uker && typeof timer.uker === 'object' && timer.uker['']) return true;
    if (timerHasPersons(timer)) {
        for (var i = 0; i < timer.personer.length; i++) {
            var p = timer.personer[i];
            if (p && p.uker && p.uker['']) return true;
        }
    }
    return false;
}

function realignTimerWeeks(timer, newWeeks) {
    if (!timer || typeof timer !== 'object') return timer;
    var target = (newWeeks || []).map(String);
    if (!target.length) return timer;                       // ukjent uke → la bøttene stå
    var oldWeeks = _timerAllWeekKeys(timer);
    var hasUnknown = _timerHasUnknownWeekBucket(timer);
    if (!oldWeeks.length && !hasUnknown) return timer;
    // Allerede i takt → returner samme objekt (kallerne bruker det som «uendret»).
    // Et ukjent-bøtte har alltid noe å gjøre, uansett om ukene ellers stemmer.
    if (!hasUnknown && oldWeeks.length === target.length
        && oldWeeks.every(function(k, i) { return k === target[i]; })) return timer;

    var map = _buildWeekMapping(oldWeeks, target);
    var newUker = (timer.uker && typeof timer.uker === 'object') ? _applyWeekMapping(timer.uker, map) : null;
    var newPersons = null;
    if (timerHasPersons(timer)) {
        var anyPersonChanged = false;
        newPersons = timer.personer.map(function(p) {
            var m = _applyWeekMapping(p && p.uker, map);
            if (!m) return p;
            anyPersonChanged = true;
            return Object.assign({}, p, { uker: m });
        });
        if (!anyPersonChanged) newPersons = null;
    }
    if (!newUker && !newPersons) return timer;
    var res = Object.assign({}, timer);
    if (newUker) res.uker = newUker;
    if (newPersons) res.personer = newPersons;
    return res;
}

// Legg om ALLE bestillingenes uke-bøtter til Uke-feltets nåværende uker.
// Kalles når Uke-feltet er ferdig endret (change, ikke input: midt i en
// redigering av «30 & 31» ville et mellomsteg med bare «30» slått de to bøttene
// sammen, og den sammenslåingen kan ikke angres) og når et lagret skjema åpnes
// (reparerer skjemaer der uken ble endret før denne mekanismen fantes).
function realignAllOrderTimerWeeks() {
    var weeks = currentFormUkeNumbers();
    if (!weeks.length) return;                              // ukjent uke → ikke rør noe
    var changed = false;
    document.querySelectorAll('#mobile-orders .mobile-order-card').forEach(function(card) {
        var timer;
        try { timer = JSON.parse(card.getAttribute('data-timer') || '{}') || {}; } catch (e) { return; }
        var next = realignTimerWeeks(timer, weeks);
        if (next === timer) return;
        card.setAttribute('data-timer', JSON.stringify(next));
        if (typeof updateDagTimerSummary === 'function') updateDagTimerSummary(card);
        changed = true;
    });
    if (changed && typeof updateTimerChip === 'function') updateTimerChip();
}

// Kanonisk uke-etikett til EKSPORTEN. Uke-feltet er fritekst — «30 & 31»,
// «31 & 30», «30, ,31» og «30-31» betyr det samme, men ble skrevet ordrett ut på
// kundedokumentet med skrivefeil og alt («Uke 30, ,31»).
//
// Sammenhengende uker skrives som INTERVALL med bindestrek, resten med komma:
//   [30]              → «Uke 30»
//   [30,31]           → «Uke 30-31»
//   [30,31,32,33]     → «Uke 30-33»
//   [30,33]           → «Uke 30, 33»          (ikke sammenhengende)
//   [30,31,32,35]     → «Uke 30-32, 35»
//
// Intervallet er nødvendig av PLASS: Dato-cella i PDF-en er 30 mm, og
// «Uke 30, 31, 32, 33» får ikke plass der — cella kutter stille (se fieldCell).
// «Uke 30-33» gjør det.
// Bindestrek kan IKKE brukes på uker som ikke henger sammen: «Uke 30-33» betyr
// 30, 31, 32 og 33, så for uke 30 og 33 alene ville den lagt til to uker som
// aldri ble ført. Derfor komma i akkurat de tilfellene — det er en regel om hva
// som er SANT, ikke et stilvalg.
//
// Lar teksten seg ikke tolke («sommerferie»), skrives den ordrett som før —
// da har vi ingenting bedre å tilby.
function formatUkeLabel(text) {
    var raw = String(text == null ? '' : text).trim();
    if (!raw) return '';
    var uker = parseUkeNumbers(raw);
    if (!uker.length) return /^uke\s/i.test(raw) ? raw : 'Uke ' + raw;
    var deler = [];
    var i = 0;
    while (i < uker.length) {
        var start = uker[i], slutt = start;
        while (i + 1 < uker.length && uker[i + 1] === slutt + 1) { i++; slutt = uker[i]; }
        deler.push(slutt > start ? (start + '-' + slutt) : String(start));
        i++;
    }
    return 'Uke ' + deler.join(', ');
}

// Arbeidstid-linjene til eksportens beskrivelses-blokk. Returnerer ÉN linje per
// uke når timene er fordelt på flere, ellers én samlet linje som før.
// Uten dette ble to uker slått sammen til én liste der «Lørdag (31t)» egentlig var
// to lørdager — samme sammenblanding som popupen nå unngår.
function orderArbeidstidMeta(order, fallbackWeeks) {
    // dagShortMap, ikke fulle dagnavn: med full skrivemåte brøt linja til to når
    // en uke hadde mange dager. Dette er dessuten den forkortelsen appen ALLEREDE
    // bruker i sammendraget på bestillings-kortet, så montøren og kunden ser nå
    // samme form. Vil man ha tre bokstaver («Man»), er det ett sted å endre.
    // Samme grunn til «Annet» framfor «Uspesifisert dag»: kortere, og det er
    // ordet både popupen og kort-sammendraget bruker.
    var timer = (order && order.timer && typeof order.timer === 'object') ? order.timer : null;
    if (!timer) return [];
    // «Ma 2t» — ÉN fast form uansett om bestillingen har én dag eller sju.
    // Parentesene fra «Ma (2t)» er borte fordi de kostet 2 tegn per oppføring uten
    // å tilføre noe, men «t» beholdes: «Ma 2» alene leser som en dato eller et
    // løpenummer, ikke som timer.
    // Prøvd og forkastet: å velge dagform etter hvor mye plass som er ledig
    // (fulle navn ved én dag, forkortet ved sju). Det ga to formater i samme
    // dokument, og konsistens veier tyngre enn å utnytte ledig plass.
    // Skilletegnet er «·» og ikke komma: verdiene inneholder selv komma som
    // desimalskille, så «Ma 2t, Ti 8t» ville vært flertydig.
    var bygg = function(tm) {
        var parts = [];
        TIMER_DAY_KEYS_CORE.forEach(function(d) {
            var tv = tm[d];
            if (tv != null && String(tv).trim()) parts.push((dagShortMap[d] || d) + ' ' + String(tv).replace('.', ',') + 't');
        });
        var g = tm._generelt || tm._total;
        if (g != null && String(g).trim()) parts.push('Annet ' + String(g).replace('.', ',') + 't');
        return parts;
    };
    // Etiketten er «Arbeidstid uke N» — samme ord som total-raden nederst i
    // eksporten (t('order_days')), så dokumentet bruker ETT begrep om timer.
    // Den sto en periode som «Timer uke N» fordi linja brøt til to og etiketten
    // var den største enkeltposten. Det er ikke nødvendig lenger: beskrivelses-
    // kolonnen ble 4 mm bredere da venstremargen ble halvert (133 mm mot 129).
    // Målt: full uke med alle sju dager + Annet og desimaltimer er 122,6 mm og
    // får plass. Bare et konstruert tilfelle med 37,5 t HVER dag (136,6 mm) bryter.
    // Ukenummeret tas med OGSÅ når det bare er ÉN uke — da er formen den samme
    // uansett, i stedet for å veksle mellom «Arbeidstid uke 30:» og «Arbeidstid:».
    // Flere personer: ÉN linje per (uke, person), gruppert på uke. Da ser kunden
    // hvem som jobbet hvilken dag — det er den oppstillingen som holder hvis
    // timene senere blir bestridt, og det er kunden som signerer på dem.
    //
    // Etiketten kortes fra «Arbeidstid uke 30:» til «Uke 30 · Igor:» av PLASS:
    // beskrivelses-kolonnen er 133 mm, og en full uke med alle sju dager måler
    // allerede 122,6 mm (se kommentaren over). Med «Arbeidstid» foran navnet ville
    // linja brutt. Ordet står uansett igjen på totalraden nederst i tabellen, så
    // dokumentet mangler ikke begrepet.
    if (timerHasPersons(timer)) {
        var pOut = [];
        var weekOrder = [], weekSeen = {};
        timer.personer.forEach(function(p) {
            Object.keys((p && p.uker) || {}).forEach(function(w) {
                if (weekSeen[w]) return;
                weekSeen[w] = true;
                weekOrder.push(w);
            });
        });
        // Tom nøkkel («ukjent uke») først, deretter ukenummer stigende.
        weekOrder.sort(function(a, b) {
            if (!a) return -1;
            if (!b) return 1;
            return Number(a) - Number(b);
        });
        weekOrder.forEach(function(w) {
            timer.personer.forEach(function(p) {
                var parts = bygg(((p && p.uker) || {})[w] || {});
                if (!parts.length) return;
                var navn = _timerTrim(p && p.navn);
                var lbl;
                if (navn && w) lbl = 'Uke ' + w + ' \u00b7 ' + navn + ': ';
                else if (navn) lbl = navn + ': ';
                else lbl = t('order_days') + (w ? ' uke ' + w : '') + ': ';
                pOut.push({ label: lbl, value: parts.join(' \u00b7 ') });
            });
        });
        if (pOut.length) return pOut;
    }

    var uker = (timer.uker && typeof timer.uker === 'object')
        ? Object.keys(timer.uker).sort(function(a, b) { return Number(a) - Number(b); })
        : [];
    if (uker.length) {
        var out = [];
        uker.forEach(function(w) {
            var parts = bygg(timer.uker[w] || {});
            if (parts.length) out.push({ label: t('order_days') + ' uke ' + w + ': ', value: parts.join(' \u00b7 ') });
        });
        if (out.length) return out;
    }
    // Ingen uke-fordeling (data lagret før uke-oppdelingen). Dekker skjemaet
    // bare ÉN uke, vet vi likevel hvilken timene hører til — se soleWeekOf.
    var flat = bygg(timer);
    if (!flat.length) return [];
    var sole = soleWeekOf(fallbackWeeks);
    return [{ label: t('order_days') + (sole ? ' uke ' + sole : '') + ': ', value: flat.join(' \u00b7 ') }];
}

// Total timer i ett timer-objekt: de FLATE nøklene, som er summen på tvers av
// både personer og uker. Leser bevisst ikke .uker/.personer — de er avledede lag
// av nøyaktig de samme timene, og ville gitt dobbelttelling.
//
// Erstatter et tidligere `Object.values(timer)`-løp i begge eksport-veiene. Det
// ga riktig svar, men bare fordi .uker er et objekt og parseFloat('[object
// Object]') blir NaN. Enhver ny nøkkel med et TALL i seg ville blitt talt med.
function orderTimerSum(timer) {
    if (!timer || typeof timer !== 'object') return 0;
    var sum = 0;
    TIMER_DAY_KEYS_CORE.concat(['_generelt', '_total']).forEach(function(k) {
        var n = parseFloat(String(timer[k] == null ? '' : timer[k]).replace(',', '.'));
        if (!isNaN(n)) sum += n;
    });
    return sum;
}

// Timer ført på ÉN bestemt uke. Brukes til uke-summering på tvers av ordresedler.
function orderHoursForWeek(timer, week) {
    if (!timer || typeof timer !== 'object') return 0;
    var sum = 0;
    var addAll = function(obj) {
        TIMER_DAY_KEYS_CORE.concat(['_generelt', '_total']).forEach(function(k) {
            var n = parseFloat(String(obj[k] == null ? '' : obj[k]).replace(',', '.'));
            if (!isNaN(n)) sum += n;
        });
    };
    if (timer.uker && typeof timer.uker === 'object') {
        var b = timer.uker[String(week)];
        if (b) addAll(b);
        return sum;
    }
    // Uten .uker finnes ingen fordeling. Timene tilhører uken KUN hvis
    // ordreseddelen bare dekker den ene — det avgjør kalleren.
    addAll(timer);
    return sum;
}

// Kladd mens popupen er åpen. Fanebytte renderer fra denne, så ingenting går
// tapt når man skifter person eller uke.
//   _dagTimerPersons  = [{ navn, buckets: { ukeNøkkel: {ma..so,_generelt} } }]
// Jobber man alene er det ÉN person (meg), og popupen ser ut som før: ingen
// person-fanerad, bare dagradene.
var _dagTimerWeeks = [];
var _dagTimerPersons = [];
var _dagTimerActivePerson = 0;
var _dagTimerActiveWeek = '';
var _dagTimerMyName = '';

function _dagTimerActiveBuckets() {
    var p = _dagTimerPersons[_dagTimerActivePerson];
    if (!p) return {};
    return p.buckets || (p.buckets = {});
}

// Alle personers bøtter slått sammen — brukes til å avgjøre hvilke uker som
// trenger fane (en uke der BARE kollegaen jobbet må også være synlig).
function _dagTimerMergedBuckets() {
    return _mergeBucketMaps(_dagTimerPersons.map(function(p) { return p.buckets || {}; }));
}

// Summen for én person på tvers av alle uker (tallet på person-fanen).
function _dagTimerPersonSum(person) {
    var sum = 0;
    Object.keys((person && person.buckets) || {}).forEach(function(w) {
        sum += _dagTimerBucketSum(person.buckets[w]);
    });
    return sum;
}

// Vises person-fanene? Bare når de tilfører noe: flere personer, eller én person
// som ikke er meg (jeg fører for en kollega). Ellers holder «+ Legg til person».
function _dagTimerShowPersonTabs() {
    if (_dagTimerPersons.length > 1) return true;
    if (!_dagTimerPersons.length) return false;
    var only = String(_dagTimerPersons[0].navn || '').trim().toLowerCase();
    var me = String(_dagTimerMyName || '').trim().toLowerCase();
    return !!only && only !== me;
}

function _dagTimerCardSession(card, afterClose) {
    return {
        card: card,
        // Ukene hentes fra det ÅPNE skjemaets Uke-felt.
        getWeeks: function() { return currentFormUkeNumbers(); },
        // Hvem er «meg»? Montør-feltet i skjemaet — navnet som allerede står på
        // dokumentet. Styrer om timene lagres uten personfordeling (solo).
        getMyName: function() { return currentFormMontorName(); },
        getTimer: function() {
            try { return JSON.parse(card.getAttribute('data-timer') || '{}') || {}; } catch (e) { return {}; }
        },
        getPlans: function() {
            return (typeof _getCardPlans === 'function') ? _getCardPlans(card) : [];
        },
        commit: function(timer, dager, plans) {
            card.setAttribute('data-dager', JSON.stringify(dager));
            card.setAttribute('data-timer', JSON.stringify(timer));
            card.setAttribute('data-day-plans', '{}');
            card.setAttribute('data-plans', JSON.stringify(plans));
            var unionPlan = plans.join(', ');
            var planDisp = card.querySelector('.plan-display');
            if (planDisp) {
                planDisp.setAttribute('data-plan', unionPlan);
                var dispText = planDisp.querySelector('.plan-display-text');
                if (dispText) dispText.textContent = unionPlan;
            }
            updateDagTimerSummary(card);
            if (typeof updateTimerChip === 'function') updateTimerChip();
        },
        afterClose: afterClose || function() { _maybeReturnToTimerOverview(); }
    };
}

var dagNameMap = { ma: 'Mandag', ti: 'Tirsdag', on: 'Onsdag', to: 'Torsdag', fr: 'Fredag', lo: 'Lørdag', so: 'Søndag' };
var dagShortMap = { ma: 'Ma', ti: 'Ti', on: 'On', to: 'To', fr: 'Fr', lo: 'Lø', so: 'Sø' };

// Etasjer (plans) er nå en attributt på BESTILLINGEN, ikke per dag. Helper
// dedupliserer eldre per-dag-format til en flat liste for migrering.
function _migrateFromDayPlans(dayPlans) {
    if (!dayPlans || typeof dayPlans !== 'object') return [];
    var set = {};
    var order = [];
    Object.keys(dayPlans).forEach(function(k) {
        var v = dayPlans[k];
        String(v || '').split(',').map(function(s) { return s.trim(); })
            .filter(Boolean).forEach(function(p) {
                if (!set[p]) { set[p] = true; order.push(p); }
            });
    });
    return order;
}

// Henter bestillingens etasjer som UNION-array på tvers av dager. Brukes til
// summary/eksport som viser én flat liste. Foretrekker data-day-plans
// (primær), faller tilbake til data-plans (eldre bestilling-nivå).
// Etasjer er nå BESTILLING-NIVÅ (én liste for hele bestillingen, ikke per dag) —
// data-plans er primær. Faller tilbake til union av eldre per-dag data-day-plans
// for skjemaer lagret før omleggingen.
function _getCardPlans(card) {
    if (!card) return [];
    var arr = [];
    try { arr = JSON.parse(card.getAttribute('data-plans') || '[]') || []; } catch (e) {}
    if (Array.isArray(arr) && arr.length) return arr;
    var dp = {};
    try { dp = JSON.parse(card.getAttribute('data-day-plans') || '{}') || {}; } catch (e) {}
    return _migrateFromDayPlans(dp);
}

// Henter PER-DAG etasje-objekt: { ma: 'U3, U2', ti: 'U1' }. Primær kilde er
// data-day-plans (det er nå hovedformatet). Hvis tomt og kortet har eldre
// bestilling-nivå data-plans → repliker plans-strengen til alle dager med
// timer (auto-migrering ved første lasting).
// Rå per-dag etasje-objekt {ma:'U3, U2'} — KUN for eldre skjemaer lagret med
// per-dag-modellen. Nye skjemaer har {} her (etasjer er bestilling-nivå i
// data-plans). Ingen auto-replikering lenger (ville gjenskapt per-dag).
function _getCardDayPlans(card) {
    if (!card) return {};
    var dp = {};
    try { dp = JSON.parse(card.getAttribute('data-day-plans') || '{}') || {}; } catch (e) {}
    return (dp && typeof dp === 'object') ? dp : {};
}

// Skjul bullet-separator hvis prev og next dag-del er på forskjellige linjer
// (dvs. separatoren ville være "dangling" på en linje-grense).
function _hideEdgeSeparators(container) {
    if (!container) return;
    var seps = container.querySelectorAll('.dt-sep');
    seps.forEach(function(sep) {
        var prev = sep.previousElementSibling;
        var next = sep.nextElementSibling;
        if (!prev || !next) { sep.style.visibility = 'hidden'; return; }
        var prevTop = prev.getBoundingClientRect().top;
        var nextTop = next.getBoundingClientRect().top;
        // Hvis prev og next er på ulike linjer → wrap har skjedd → skjul separator
        sep.style.visibility = (Math.abs(prevTop - nextTop) > 2) ? 'hidden' : 'visible';
    });
}

function updateDagTimerSummary(card) {
    const display = card.querySelector('.dag-timer-display');
    if (!display) return;
    const textEl = display.querySelector('.dag-timer-display-text');
    const btn = card.querySelector('.mobile-arbeidstid-btn');
    const timer = JSON.parse(card.getAttribute('data-timer') || '{}');
    function _formatDayPart(label, hours) {
        var hoursStr = hours ? escapeHtml(String(hours).replace('.', ',')) + 't' : '';
        var inner = '<b class="dt-day">' + escapeHtml(label) + '</b>';
        if (hoursStr) inner += ' ' + hoursStr;
        return '<span class="dt-part">' + inner + '</span>';
    }
    // Dag-delene for ETT sett timer — én uke, eller de flate nøklene for data
    // lagret før uke-oppdelingen. TIMER_DAY_KEYS_CORE er samme kilde som
    // eksporten bruker, så dagrekkefølgen kan ikke drive fra hverandre.
    function _dayParts(tm) {
        var out = TIMER_DAY_KEYS_CORE.filter(function(d) { return tm[d]; }).map(function(d) {
            return _formatDayPart(dagShortMap[d] || d, tm[d]);
        });
        var g = tm._generelt || tm._total;
        if (g) out.push(_formatDayPart('Annet', g));
        return out;
    }
    var SEP = '<span class="dt-sep">•</span>';
    var lines = [];
    // Flere personer: samme oppdeling som eksporten — én linje per (uke, person).
    // Kortet er der man leser tilbake det man har ført, så det MÅ vise samme
    // fordeling som dokumentet kunden signerer. Slo vi personene sammen her,
    // ville kortet sagt «Ma 16t» mens eksporten sa «Igor 8t / Ola 8t».
    if (timerHasPersons(timer)) {
        var pWeeks = [], pSeen = {};
        timer.personer.forEach(function(p) {
            Object.keys((p && p.uker) || {}).forEach(function(w) {
                if (pSeen[w]) return;
                pSeen[w] = true;
                pWeeks.push(w);
            });
        });
        pWeeks.sort(function(a, b) {
            if (!a) return -1;
            if (!b) return 1;
            return Number(a) - Number(b);
        });
        pWeeks.forEach(function(w) {
            timer.personer.forEach(function(p) {
                var parts = _dayParts(((p && p.uker) || {})[w] || {});
                if (!parts.length) return;
                var navn = _timerTrim(p && p.navn);
                var lbl = w ? ('Uke ' + w + (navn ? ' \u00b7 ' + navn : '')) : (navn || 'Arbeidstid');
                lines.push('<span class="dt-part"><b class="dt-label">' + escapeHtml(lbl) + '</b></span>'
                    + SEP + parts.join(SEP));
            });
        });
    }
    var uker = (!lines.length && timer.uker && typeof timer.uker === 'object')
        ? Object.keys(timer.uker).sort(function(a, b) { return Number(a) - Number(b); })
        : [];
    if (uker.length) {
        // ÉN LINJE PER UKE. De flate nøklene i `timer` er SUMMEN på tvers av uker,
        // så én felles linje viste «On 19t» for to onsdager à 9,5t — nettopp den
        // sammenblandingen uke-modellen ble laget for å fjerne, og stikk i strid
        // med eksporten, som skiller ukene. Kortet er der man leser tilbake det
        // man har ført; slås ukene sammen, kan man ikke kontrollere det uten å
        // åpne popupen.
        // Ukenummeret tas med OGSÅ når det bare er én uke — samme begrunnelse som
        // i orderArbeidstidMeta: én fast form, framfor å veksle etter antall uker.
        uker.forEach(function(w) {
            var p = _dayParts(timer.uker[w] || {});
            if (!p.length) return;
            lines.push('<span class="dt-part"><b class="dt-label">Uke ' + escapeHtml(w) + '</b></span>'
                + SEP + p.join(SEP));
        });
    } else if (!lines.length) {
        // Uten fordeling: merk likevel linja når skjemaet dekker bare ÉN uke.
        // Samme regel som eksporten bruker (soleWeekOf), så de to viser likt.
        // `!lines.length` er nødvendig fordi person-grenen over allerede kan ha
        // fylt lines — uten den la denne på en flat linje i tillegg, og kortet
        // viste både «Uke 30 · Igor: Ma 8t» og en samlet «Ma 16t» under.
        var flat = _dayParts(timer);
        if (flat.length) {
            var sole = soleWeekOf(typeof currentFormUkeNumbers === 'function' ? currentFormUkeNumbers() : []);
            lines.push(sole
                ? '<span class="dt-part"><b class="dt-label">Uke ' + escapeHtml(sole) + '</b></span>' + SEP + flat.join(SEP)
                : flat.join(SEP));
        }
    }
    // Etasjer — bestilling-nivå, vist ÉN gang. Egen linje: hengt på slutten av
    // siste uke-linje ville de sett ut som om de bare gjaldt den uka.
    // Etiketten er nødvendig: uten den sto linja som et bart «1, 2, 3», som ikke
    // sier hva tallene ER — og den var den eneste linja uten etikett etter at
    // uke-linjene fikk sin. Teksten hentes fra SAMME nøkkel som raden i
    // Arbeidstid-popupen bruker, så kortet og popupen ikke kan si ulike ting.
    // Fast form (alltid flertall), ikke entall/flertall etter antall: appen skal
    // ikke veksle mellom to former for samme felt.
    var floors = ((typeof _getCardPlans === 'function') ? _getCardPlans(card) : []).join(', ');
    if (floors) {
        lines.push('<span class="dt-part"><b class="dt-label">' + escapeHtml(t('settings_req_etasjer'))
            + '</b></span>' + SEP
            + '<span class="dt-part"><span class="dt-plan">' + escapeHtml(floors) + '</span></span>');
    }
    var summary = lines.map(function(l) { return '<span class="dt-line">' + l + '</span>'; }).join('');
    textEl.innerHTML = summary;
    // Skjul separator-bullets som havner først/sist på en linje (ved wrap)
    requestAnimationFrame(function() { _hideEdgeSeparators(textEl); });
    if (summary) {
        display.style.display = '';
        if (btn) btn.style.display = 'none';
    } else {
        display.style.display = 'none';
        if (btn) btn.style.display = '';
    }
    // Synkroniser skip-UI så "Ikke aktuelt"-status/lenke matcher ny innhold.
    if (typeof _updateOrderSkipUI === 'function') _updateOrderSkipUI(card);
}

function openDagTimerModal(arg) {
    // arg = ferdig session (uke-oversikt for lagret ordreseddel) ELLER et DOM-
    // element (bestilling-kortets knapp/visning) → bygg en DOM-kort-session.
    var session = (arg && typeof arg.getTimer === 'function')
        ? arg
        : _dagTimerCardSession(arg.closest('.mobile-order-card'));
    _dagTimerSession = session;
    dagTimerActiveCard = session.card || null;   // bakoverkompat for ev. ekstern bruk
    const timer = session.getTimer();
    // Ukene ordreseddelen dekker. Tom liste (ukjent/ikke tolkbar tekst) → nøkkelen
    // '' og nøyaktig samme flate liste som før, uten faner.
    var formWeeks = (typeof session.getWeeks === 'function') ? session.getWeeks() : [];
    _dagTimerMyName = (typeof session.getMyName === 'function') ? session.getMyName() : '';
    _dagTimerPersons = timerPersonList(timer, formWeeks, _dagTimerMyName);
    _dagTimerActivePerson = 0;
    // Fanene bygges av unionen, ikke av Uke-feltet alene — se _dagTimerWeeksToShow.
    // Union på tvers av ALLE personer: en uke der bare kollegaen jobbet må også ha fane.
    _dagTimerWeeks = _dagTimerWeeksToShow(_dagTimerMergedBuckets(), formWeeks);
    // Aktiv uke: ordreseddelens FØRSTE uke når den finnes (der nye timer normalt
    // føres), ellers første uke som har timer. Fanene viser delsummen for de andre,
    // så en uke med timer utenfor Uke-feltet er synlig uten å bytte fane.
    _dagTimerActiveWeek = formWeeks.length ? String(formWeeks[0]) : (_dagTimerWeeks[0] || '');
    const list = document.getElementById('dag-timer-modal-list');
    list.innerHTML = '';

    // === Etasjer — ÉN gang for HELE bestillingen (ikke per dag) ===
    // Bestilling-nivå: én picker øverst. Lagres som union i data-plans.
    var floorsVal = (session.getPlans() || []).join(', ');
    var etRow = document.createElement('div');
    etRow.className = 'dag-timer-etasje-row';
    var etLabel = document.createElement('span');
    etLabel.className = 'dag-timer-etasje-label';
    etLabel.textContent = t('settings_req_etasjer');   // «Etasjer»
    var etBtn = document.createElement('button');
    etBtn.type = 'button';
    etBtn.className = 'dag-timer-etasje-btn' + (floorsVal ? '' : ' dag-timer-etasje-btn--empty');
    etBtn.setAttribute('data-plan', floorsVal);
    etBtn.textContent = floorsVal || '+ Etasje';
    etBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var modal = document.getElementById('dag-timer-modal');
        if (modal) modal.classList.add('dag-timer-modal--hidden');
        openPlanPicker(etBtn);
    });
    etRow.appendChild(etLabel);
    etRow.appendChild(etBtn);
    list.appendChild(etRow);

    // === Personrad ===
    // Fanerad når flere har jobbet, ellers bare «+ Legg til person». Ligger ØVERST
    // fordi person er den ytterste dimensjonen: hver person har sine uker, og hver
    // uke sine dager.
    var personRow = document.createElement('div');
    personRow.id = 'dag-timer-person-row';
    list.appendChild(personRow);
    _renderDagTimerPersonRow();

    // === Ukefaner (kun når ordreseddelen dekker FLERE uker) ===
    // Ett felt per (uke, dag) i stedet for ett per dag. Uten dette havnet to
    // onsdager i samme celle når Uke var «30 & 31», og informasjonen om hvilken
    // onsdag var tapt allerede ved registrering.
    // Delsummen står PÅ fanen, så begge uker er synlige uten å bytte — ellers er
    // det lett å glemme å fylle den man ikke ser.
    if (_dagTimerWeeks.length > 1) {
        var tabs = document.createElement('div');
        tabs.className = 'dag-timer-week-tabs';
        tabs.id = 'dag-timer-week-tabs';
        list.appendChild(tabs);
        _renderDagTimerTabs();
    }

    var rowsWrap = document.createElement('div');
    rowsWrap.id = 'dag-timer-day-rows';
    list.appendChild(rowsWrap);
    _renderDagTimerDayRows();

    // Sum-rad: samme tall som «Arbeidstid»-raden i eksporten (alle dager + Annet,
    // på tvers av ALLE uker), så montøren ser totalen mens han fører timene.
    _bindDagTimerTotal();

    var modal = document.getElementById('dag-timer-modal');
    modal.classList.add('active');
    modal.addEventListener('touchmove', dagTimerBlockScroll, { passive: false });
    modal.addEventListener('wheel', dagTimerBlockScroll, { passive: false });
}

// Fane-rad med delsum per uke.
function _renderDagTimerTabs() {
    var tabs = document.getElementById('dag-timer-week-tabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    _dagTimerWeeks.forEach(function(w) {
        var key = String(w);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dag-timer-week-tab' + (key === _dagTimerActiveWeek ? ' active' : '');
        var sum = _dagTimerBucketSum(_dagTimerActiveBuckets()[key]);
        // «Uke 30», ikke «Timer uke 30»: fanene deler bredden mellom seg, så hvert
        // ord koster plass PER uke. Med fire uker ble «Timer uke 30» kuttet til
        // «Timer uk…». Ordet «Timer» er dessuten overflødig her — popupen heter
        // «Dager & tid», og delsummen rett under står med «t».
        btn.innerHTML = '<span class="dag-timer-week-tab-name">Uke ' + key + '</span>'
            + '<span class="dag-timer-week-tab-sum">' + (sum ? _fmtDagTimerHours(sum) + ' t' : '—') + '</span>';
        btn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            _flushDagTimerInputs();
            _dagTimerActiveWeek = key;
            _renderDagTimerTabs();
            _renderDagTimerDayRows();
            _bindDagTimerTotal();
        };
        tabs.appendChild(btn);
    });
}

// ── Personrad i Arbeidstid-popupen ──────────────────────────────────────────
// Speiler uke-fanene: samme mønster, samme delsum-på-fanen, samme flush-før-bytte.
// Person er den YTTERSTE dimensjonen (person → uke → dag), derfor står raden
// øverst.
function _renderDagTimerPersonRow() {
    var row = document.getElementById('dag-timer-person-row');
    if (!row) return;
    row.innerHTML = '';

    if (_dagTimerShowPersonTabs()) {
        var tabs = document.createElement('div');
        tabs.className = 'dag-timer-person-tabs';
        _dagTimerPersons.forEach(function(p, i) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dag-timer-person-tab' + (i === _dagTimerActivePerson ? ' active' : '');
            var sum = _dagTimerPersonSum(p);
            btn.innerHTML =
                '<span class="dag-timer-person-tab-name">' + escapeHtml(p.navn || t('dag_timer_person_me')) + '</span>' +
                '<span class="dag-timer-person-tab-sum">' + (sum ? _fmtDagTimerHours(sum) + ' t' : '—') + '</span>';
            btn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                _switchDagTimerPerson(i);
            };
            var x = document.createElement('span');
            x.className = 'dag-timer-person-x';
            x.innerHTML = '&times;';
            x.setAttribute('aria-label', t('dag_timer_person_remove'));
            x.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                _removeDagTimerPerson(i);
            };
            btn.appendChild(x);
            tabs.appendChild(btn);
        });
        var add = document.createElement('button');
        add.type = 'button';
        add.className = 'dag-timer-person-add';
        add.innerHTML = '+';
        add.setAttribute('aria-label', t('dag_timer_person_add'));
        add.onclick = function(e) { e.preventDefault(); e.stopPropagation(); openPersonPicker(); };
        tabs.appendChild(add);
        row.appendChild(tabs);
    } else {
        // Solo: ingen fanerad — popupen ser ut som før. Bare én diskré lenke, som
        // ellers ville vært den eneste måten å komme i gang med en kollega på.
        var link = document.createElement('button');
        link.type = 'button';
        link.className = 'dag-timer-person-add-link';
        link.textContent = '+ ' + t('dag_timer_person_add');
        link.onclick = function(e) { e.preventDefault(); e.stopPropagation(); openPersonPicker(); };
        row.appendChild(link);
    }

    _renderDagTimerCopyBtn(row);
}

function _switchDagTimerPerson(i) {
    if (i === _dagTimerActivePerson) return;
    _flushDagTimerInputs();           // behold det som står i feltene nå
    _dagTimerActivePerson = i;
    _renderDagTimerPersonRow();
    _renderDagTimerTabs();
    _renderDagTimerDayRows();
    _bindDagTimerTotal();
}

// «Kopier timene fra X» — det vanligste tilfellet er at laget jobbet i lag og har
// SAMME timer. Uten denne måtte hvert tall tastes om igjen per person. Vises kun
// når den aktive personen ennå er tom og noen andre har timer å kopiere.
function _renderDagTimerCopyBtn(row) {
    if (_dagTimerPersons.length < 2) return;
    var active = _dagTimerPersons[_dagTimerActivePerson];
    if (!active || _dagTimerPersonSum(active) > 0) return;
    var src = null;
    for (var i = 0; i < _dagTimerPersons.length; i++) {
        if (i === _dagTimerActivePerson) continue;
        if (_dagTimerPersonSum(_dagTimerPersons[i]) > 0) { src = _dagTimerPersons[i]; break; }
    }
    if (!src) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dag-timer-person-copy';
    btn.textContent = t('dag_timer_person_copy') + ' ' + (src.navn || t('dag_timer_person_me'));
    btn.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        _copyDagTimerHoursFrom(src);
    };
    row.appendChild(btn);
}

function _copyDagTimerHoursFrom(src) {
    var active = _dagTimerPersons[_dagTimerActivePerson];
    if (!active || !src) return;
    var copy = {};
    Object.keys(src.buckets || {}).forEach(function(w) {
        copy[w] = Object.assign({}, src.buckets[w]);
    });
    active.buckets = copy;
    _renderDagTimerPersonRow();
    _renderDagTimerTabs();
    _renderDagTimerDayRows();
    _bindDagTimerTotal();
}

function _removeDagTimerPerson(i) {
    var p = _dagTimerPersons[i];
    if (!p) return;
    if (_dagTimerPersons.length <= 1) return;   // siste person kan ikke fjernes
    var doRemove = function() {
        _flushDagTimerInputs();
        _dagTimerPersons.splice(i, 1);
        if (_dagTimerActivePerson >= _dagTimerPersons.length) _dagTimerActivePerson = _dagTimerPersons.length - 1;
        else if (_dagTimerActivePerson > i) _dagTimerActivePerson--;
        _renderDagTimerPersonRow();
        _renderDagTimerTabs();
        _renderDagTimerDayRows();
        _bindDagTimerTotal();
    };
    // Har personen timer, er det reell data som forsvinner → bekreft først.
    // Arbeidstid-popupen blir stående synlig bak bekreftelsen (CSS hever den over,
    // se styles.css). Å skjule den slik plan-velgeren gjør er ikke mulig her:
    // showConfirmModal har ingen avbryt-callback, så «Avbryt» ville etterlatt
    // popupen skjult og timene utilgjengelige.
    if (_dagTimerPersonSum(p) > 0) {
        showConfirmModal(
            t('dag_timer_person_remove') + ': ' + (p.navn || '') + '?',
            doRemove,
            t('delete_btn'), '#E8501A'
        );
        return;
    }
    doRemove();
}

// ── Person-velger ───────────────────────────────────────────────────────────
// Kildene er Min info (meg) + Kolleger-lista fra Innstillinger. Fritekst er
// bevisst utelatt: samme kollega skrevet på tre måter ville blitt tre personer i
// kundedokumentet. Nye navn legges til ett sted, og gjelder da overalt.
function openPersonPicker() {
    // Uten et navn på MEG får den første personen ingen etikett, og eksporten
    // ville fått en navnløs linje ved siden av kollegaens. Bedre å si fra én gang
    // enn å produsere et kundedokument der halve arbeidstiden er anonym.
    if (!String(_dagTimerMyName || '').trim()) {
        showNotificationModal(t('dag_timer_person_need_montor'));
        return;
    }
    var modal = document.getElementById('dag-timer-modal');
    if (modal) modal.classList.add('dag-timer-modal--hidden');

    var taken = {};
    _dagTimerPersons.forEach(function(p) {
        var n = String(p.navn || '').trim().toLowerCase();
        if (n) taken[n] = true;
    });

    var candidates = [];
    var me = String(_dagTimerMyName || '').trim();
    if (me && !taken[me.toLowerCase()]) candidates.push(me);
    getKolleger().forEach(function(k) {
        var n = String(k.navn || '').trim();
        if (n && !taken[n.toLowerCase()]) candidates.push(n);
    });

    var listEl = document.getElementById('person-popup-list');
    var html = candidates.length
        ? candidates.map(function(n) {
            return '<div class="plan-popup-row" data-person="' + escapeHtml(n) + '">' +
                '<span class="plan-popup-name">' + escapeHtml(n) + '</span>' +
                '</div>';
        }).join('')
        : '<div class="popup-list-empty">' + escapeHtml(t('dag_timer_person_none')) + '</div>';

    // Ny kollega direkte herfra — uten dette var den tomme lista en blindvei som
    // tvang brukeren ut av skjemaet og inn i Innstillinger midt i timeføringen.
    // Feltet ligger I LISTA, ikke i knapperaden, nettopp så det også vises når
    // lista er tom. Samme mønster, samme CSS og samme Enter-snarvei som
    // etasje-velgeren (addPlanFromPicker) og materialvelgerens «Nytt materiale».
    // Ingen admin-gate: Kolleger er dine egne data, og knappen i Innstillinger
    // har ingen gate heller.
    html += '<div class="plan-popup-add">' +
        '<input type="text" id="person-popup-new" class="plan-popup-add-input" placeholder="' +
            escapeHtml(t('settings_kolleger_placeholder')) + '" autocapitalize="words" autocomplete="off">' +
        '<button type="button" class="plan-popup-add-btn" onclick="addKollegaFromPicker()">+</button>' +
    '</div>';
    listEl.innerHTML = html;

    listEl.querySelectorAll('.plan-popup-row').forEach(function(el) {
        el.addEventListener('click', function() {
            _addDagTimerPerson(el.getAttribute('data-person'));
        });
    });
    // Enter i feltet legger til, så man slipper å sikte på knappen.
    var newInp = document.getElementById('person-popup-new');
    if (newInp) {
        newInp.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); addKollegaFromPicker(); }
        });
    }
    document.getElementById('person-popup').classList.add('active');
}

function closePersonPicker() {
    document.getElementById('person-popup').classList.remove('active');
    var modal = document.getElementById('dag-timer-modal');
    if (modal) modal.classList.remove('dag-timer-modal--hidden');
}

function _addDagTimerPerson(navn) {
    navn = String(navn || '').trim();
    closePersonPicker();
    if (!navn) return;
    _flushDagTimerInputs();
    // Første person er «meg» og kan være navnløs (solo-tilfellet). Legger man til
    // en kollega, må meg-personen få navn — ellers ville eksporten vist én linje
    // uten navn ved siden av kollegaens.
    if (_dagTimerPersons.length === 1 && !String(_dagTimerPersons[0].navn || '').trim()) {
        _dagTimerPersons[0].navn = _dagTimerMyName || '';
    }
    _dagTimerPersons.push({ navn: navn, buckets: {} });
    _dagTimerActivePerson = _dagTimerPersons.length - 1;
    _renderDagTimerPersonRow();
    _renderDagTimerTabs();
    _renderDagTimerDayRows();
    _bindDagTimerTotal();
}

window.openPersonPicker = openPersonPicker;
window.closePersonPicker = closePersonPicker;

function _fmtDagTimerHours(n) {
    return (Math.round(n * 10) / 10).toString().replace('.', ',');
}

function _dagTimerBucketSum(bucket) {
    var s = 0;
    if (!bucket) return 0;
    Object.keys(bucket).forEach(function(k) {
        var n = parseFloat(String(bucket[k] || '').replace(',', '.'));
        if (!isNaN(n)) s += n;
    });
    return s;
}

function _dagTimerBucketHasValue(bucket) {
    if (!bucket) return false;
    return Object.keys(bucket).some(function(k) { return String(bucket[k] == null ? '' : bucket[k]).trim() !== ''; });
}

// Ukene popupen skal VISE: ordreseddelens uker UNION ukene det faktisk ER ført
// timer på.
//
// Uten unionen ble en uke som finnes i dataene, men ikke i Uke-feltet, verken
// vist eller redigerbar — samtidig som timene talte med i total-raden, fordi den
// summerer alle bøttene. Popupen kunne da vise «alle dager 0 t» og
// «Total arbeidstid 2,0 t» samtidig, og timene var umulige å rette fra UI-et.
// Det inntreffer så snart Uke-feltet endres etter at timer er ført (uke-feltet er
// bruker-persistent og kan rettes når som helst), og når teksten ikke lenger lar
// seg tolke til de samme ukenumrene.
//
// Timene har aldri gått tapt — kladden beholder alle bøtter og
// timerFromWeekBuckets skriver dem tilbake — de var bare usynlige.
//
// Den tomme nøkkelen '' er «ukjent uke» (Uke-feltet er fritekst som ikke lot seg
// tolke). Den er ikke en uke, og skal ikke ha fane: da faller popupen tilbake til
// den flate dag-lista, som før.
function _dagTimerWeeksToShow(buckets, formWeeks) {
    var out = [], seen = {};
    (formWeeks || []).forEach(function(w) {
        var k = String(w);
        if (!k || seen[k]) return;
        seen[k] = true;
        out.push(k);
    });
    Object.keys(buckets || {}).forEach(function(k) {
        if (!k || seen[k]) return;
        if (!_dagTimerBucketHasValue(buckets[k])) return;   // tom uke → ingen grunn til fane
        seen[k] = true;
        out.push(k);
    });
    return out.sort(function(a, b) { return parseInt(a, 10) - parseInt(b, 10); });
}

// Les det som står i de synlige feltene inn i den aktive uke-bøtta. Kalles før
// fanebytte og før lagring, så ingenting går tapt ved skifte.
function _flushDagTimerInputs() {
    var wrap = document.getElementById('dag-timer-day-rows');
    if (!wrap) return;
    var ab = _dagTimerActiveBuckets();
    var b = ab[_dagTimerActiveWeek] || (ab[_dagTimerActiveWeek] = {});
    Object.keys(b).forEach(function(k) { delete b[k]; });
    wrap.querySelectorAll('.dag-timer-modal-input').forEach(function(inp) {
        var v = String(inp.value || '').trim();
        if (v) b[inp.dataset.dag] = v;
    });
}

// Dag-radene for den AKTIVE uka (eller den ene flate lista når uken er ukjent).
function _renderDagTimerDayRows() {
    var wrap = document.getElementById('dag-timer-day-rows');
    if (!wrap) return;
    wrap.innerHTML = '';
    var bucket = _dagTimerActiveBuckets()[_dagTimerActiveWeek] || {};
    var dagOrder = ['ma','ti','on','to','fr','lo','so'];
    dagOrder.forEach(function(dag) {
        var row = document.createElement('div');
        row.className = 'dag-timer-modal-row';
        row.dataset.dag = dag;
        var topRow = document.createElement('div');
        topRow.className = 'dag-timer-modal-row-top';
        var label = document.createElement('span');
        label.className = 'dag-timer-modal-name';
        label.textContent = dagNameMap[dag];
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'dag-timer-modal-input';
        inp.inputMode = 'decimal';
        inp.placeholder = '0';
        inp.dataset.dag = dag;
        inp.value = bucket[dag] || '';
        var inpWrap = document.createElement('div');
        inpWrap.className = 'dag-timer-input-wrap';
        var unit = document.createElement('span');
        unit.className = 'dag-timer-unit';
        unit.textContent = 't';
        inpWrap.appendChild(inp);
        inpWrap.appendChild(unit);
        topRow.appendChild(label);
        topRow.appendChild(inpWrap);
        row.appendChild(topRow);
        wrap.appendChild(row);
    });

    // Annet-rad (additiv timer for uspesifisert dag, kun timer).
    var genRow = document.createElement('div');
    genRow.className = 'dag-timer-modal-row dag-timer-total-row';
    genRow.dataset.dag = '_generelt';
    var genTopRow = document.createElement('div');
    genTopRow.className = 'dag-timer-modal-row-top';
    var genLabel = document.createElement('span');
    genLabel.className = 'dag-timer-modal-name';
    genLabel.textContent = 'Annet';
    var genInp = document.createElement('input');
    genInp.type = 'text';
    genInp.className = 'dag-timer-modal-input';
    genInp.inputMode = 'decimal';
    genInp.placeholder = '0';
    genInp.id = 'dag-timer-generelt-input';
    genInp.dataset.dag = '_generelt';
    genInp.value = bucket._generelt || '';
    var genInpWrap = document.createElement('div');
    genInpWrap.className = 'dag-timer-input-wrap';
    var genUnit = document.createElement('span');
    genUnit.className = 'dag-timer-unit';
    genUnit.textContent = 't';
    genInpWrap.appendChild(genInp);
    genInpWrap.appendChild(genUnit);
    genTopRow.appendChild(genLabel);
    genTopRow.appendChild(genInpWrap);
    genRow.appendChild(genTopRow);
    wrap.appendChild(genRow);
}

// Summerer ALLE timefeltene i dag-timer-popupen (ukedagene + «Annet») og skriver
// resultatet til sum-raden. Samme regnestykke som eksportens Arbeidstid-rad, som
// også summerer alle verdiene i order.timer inkl. _generelt.
function _updateDagTimerTotal() {
    var valueEl = document.getElementById('dag-timer-total-value');
    if (!valueEl) return;
    // Flush først: de synlige feltene er den ferskeste sannheten for aktiv uke.
    _flushDagTimerInputs();
    // Summen skal dekke ALLE uker, ikke bare den fanen som vises — ellers ville
    // totalen falt når man byttet til en tom uke.
    // ...og alle PERSONER: totalen er hele bestillingens arbeidstid, som er tallet
    // som havner på totalraden i eksporten.
    var sum = 0;
    _dagTimerPersons.forEach(function(p) { sum += _dagTimerPersonSum(p); });
    valueEl.textContent = sum.toFixed(1).replace('.', ',') + ' t';
    _renderDagTimerTabs();        // delsummene på uke-fanene holdes i takt
    _renderDagTimerPersonRow();   // ...og på person-fanene
}

// Etikett + live-oppdatering. Etiketten bygges fra t('order_days') så den er
// samme begrep som overalt ellers («Total arbeidstid»).
function _bindDagTimerTotal() {
    var labelEl = document.getElementById('dag-timer-total-label');
    if (labelEl) labelEl.textContent = 'Total ' + t('order_days').toLowerCase();
    var list = document.getElementById('dag-timer-modal-list');
    if (list) {
        list.querySelectorAll('.dag-timer-modal-input').forEach(function(inp) {
            inp.addEventListener('input', _updateDagTimerTotal);
        });
    }
    _updateDagTimerTotal();
}

function dagTimerBlockScroll(e) {
    var list = document.getElementById('dag-timer-modal-list');
    // Tillat scroll kun hvis event er inni listen og listen faktisk kan scrolle
    if (list && list.contains(e.target) && list.scrollHeight > list.clientHeight) return;
    e.preventDefault();
}

function closeDagTimerModal(confirmed) {
    var modal = document.getElementById('dag-timer-modal');
    if (!confirmed || !_dagTimerSession) {
        modal.classList.remove('active');
        modal.removeEventListener('touchmove', dagTimerBlockScroll);
        modal.removeEventListener('wheel', dagTimerBlockScroll);
        var sCancel = _dagTimerSession;
        _dagTimerSession = null;
        dagTimerActiveCard = null;
        if (sCancel && sCancel.afterClose) sCancel.afterClose();
        return;
    }
    const list = document.getElementById('dag-timer-modal-list');

    // Les KLADDEN, ikke DOM-en: bare den aktive uka finnes som felt, så en
    // DOM-innsamling ville slettet de andre ukene.
    _flushDagTimerInputs();
    const timer = timerFromPersonList(_dagTimerPersons, _dagTimerMyName);
    // «dager» = ukedager det er ført timer på, på tvers av alle uker. Brukes til
    // sammendraget på kortet og til eksportens Arbeidstid-linje.
    const dager = TIMER_DAY_KEYS_CORE.filter(function(k) { return timer[k]; });

    // Etasjer (bestilling-nivå) fra den ene picker-knappen.
    var etBtn = list.querySelector('.dag-timer-etasje-btn');
    var floorsStr = etBtn ? (etBtn.getAttribute('data-plan') || '').trim() : '';
    var unionArr = floorsStr ? floorsStr.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; }) : [];

    // Validering: er det ført timer på en ukedag, må bestillingen ha minst én
    // etasje. (Etasje er ikke per dag lenger — én liste gjelder hele bestillingen.)
    var anyWeekdayHours = dager.length > 0;
    if (anyWeekdayHours && !unionArr.length) {
        showNotificationModal(t('validation_etasje_required'));
        return;  // Hold modalen åpen så bruker kan fikse
    }

    // Først nå (validering OK) lukker vi modalen.
    modal.classList.remove('active');
    modal.removeEventListener('touchmove', dagTimerBlockScroll);
    modal.removeEventListener('wheel', dagTimerBlockScroll);

    // Persister via session (DOM-kort skriver attributter; lagret ordreseddel
    // skriver til data-objekt + auto-lagrer). updateTimerChip kalles i commit.
    var s = _dagTimerSession;
    _dagTimerSession = null;
    dagTimerActiveCard = null;
    s.commit(timer, dager, unionArr);
    if (s.afterClose) s.afterClose();
}

// Åpnet Dager & tid fra Timer-oversikten? Gå tilbake dit (oppdatert) ved
// både OK og Avbryt, så brukeren blir værende i oversikts-flyten.
function _maybeReturnToTimerOverview() {
    if (!window._timerOverviewReturn) return;
    window._timerOverviewReturn = false;
    if (typeof openTimerOverview === 'function') openTimerOverview();
}

function scrollCardToTop(card, smooth) {
    if (!card) return;
    var scrollContainer = card.closest('.container.form-view')
        || card.closest('.container.service-view')
        || card.closest('.view')
        || document.scrollingElement
        || document.documentElement;
    if (!scrollContainer) return;
    var cardRect = card.getBoundingClientRect();
    var containerRect = scrollContainer.getBoundingClientRect();
    // Kompenser for sticky form-header som dekker toppen av scroll-containeren
    var stickyHeader = scrollContainer.querySelector('.modal-header');
    var stickyHeight = stickyHeader ? stickyHeader.offsetHeight : 0;
    var target = cardRect.top - containerRect.top + scrollContainer.scrollTop - stickyHeight - 4;
    if (target < 0) target = 0;
    scrollContainer.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
}

function toggleOrder(headerEl) {
    if (event && event.target.closest('.mobile-order-header-delete')) return;
    if (document.activeElement) document.activeElement.blur();
    const card = headerEl.closest('.mobile-order-card');
    const wrap = card.querySelector('.mobile-order-body-wrap');
    const arrow = card.querySelector('.mobile-order-arrow');
    if (!wrap.classList.contains('expanded')) {
        wrap.classList.add('expanded');
        arrow.innerHTML = '&#9650;';
        const desc = card.querySelector('.mobile-order-desc');
        if (desc && desc.style.display !== 'none') autoResizeTextarea(desc);
        // Vent på at ekspansjons-animasjonen (250ms) er ferdig før scroll —
        // scrollHeight må ha vokst slik at scrollTo faktisk kan nå target-posisjonen.
        setTimeout(function() { scrollCardToTop(card, true); }, 270);
    } else {
        wrap.classList.remove('expanded');
        arrow.innerHTML = '&#9660;';
    }
    updateOrderTitle(card);
}

function renumberOrders() {
    document.querySelectorAll('#mobile-orders .mobile-order-card').forEach((card) => {
        updateOrderTitle(card);
    });
    if (typeof updateTimerChip === 'function') updateTimerChip();
}

function addOrder() {
    const container = document.getElementById('mobile-orders');
    // Collapse existing open cards
    container.querySelectorAll('.mobile-order-card').forEach(card => {
        const wrap = card.querySelector('.mobile-order-body-wrap');
        if (wrap && wrap.classList.contains('expanded')) {
            wrap.classList.remove('expanded');
            card.querySelector('.mobile-order-arrow').innerHTML = '&#9660;';
        }
    });
    const card = createOrderCard({ description: '', dager: [], plan: '', merknad: '', materials: [], timer: '' }, true);
    container.appendChild(card);
    updateOrderDeleteStates();
    renumberOrders();
    if (typeof updateRequiredIndicators === 'function') updateRequiredIndicators();
    if (document.activeElement) document.activeElement.blur();
    // Wait for collapse animation to finish before scrolling
    setTimeout(function() { scrollCardToTop(card, true); }, 270);
}

function removeOrder(btn) {
    const card = btn.closest('.mobile-order-card');
    showConfirmModal(t('order_delete_confirm'), function() {
        card.remove();
        updateOrderDeleteStates();
        renumberOrders();
        sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    });
}

function updateOrderDeleteStates() {
    const cards = document.querySelectorAll('#mobile-orders .mobile-order-card');
    const deleteButtons = document.querySelectorAll('#mobile-orders .mobile-order-header-delete');
    deleteButtons.forEach(btn => { btn.disabled = cards.length <= 1; });
}

// --- Service entry card functions ---

function createServiceEntryCard(entryData, expanded) {
    var data = entryData || {};
    var card = document.createElement('div');
    card.className = 'service-entry-card';

    var srvReq = cachedRequiredSettings ? cachedRequiredSettings.service : getDefaultRequiredSettings().service;
    var datoReq = srvReq.dato !== false ? ' field-required' : '';
    var pnrReq = srvReq.prosjektnr !== false ? ' field-required' : '';
    var pnavnReq = srvReq.prosjektnavn !== false ? ' field-required' : '';
    var matReq = srvReq.materialer !== false ? ' field-required' : '';

    card.innerHTML =
        '<div class="service-entry-header" onclick="toggleServiceEntry(this)">' +
            '<span class="mobile-order-arrow">' + (expanded ? '&#9650;' : '&#9660;') + '</span>' +
            '<span class="service-entry-title">' + t('service_entry_title') + '</span>' +
            '<button type="button" class="mobile-order-header-delete" onclick="event.stopPropagation(); removeServiceEntry(this)">' + deleteIcon + '</button>' +
        '</div>' +
        '<div class="mobile-order-body-wrap' + (expanded ? ' expanded' : '') + '">' +
        '<div class="service-entry-body">' +
            '<div class="mobile-field' + datoReq + '"><label data-i18n="label_dato">' + t('label_dato') + '</label>' +
                '<input type="text" class="service-entry-dato" inputmode="numeric" placeholder="DD.MM.ÅÅÅÅ" value="' + escapeHtml(data.dato || '') + '"></div>' +
            '<div class="mobile-field' + pnrReq + '"><label data-i18n="label_prosjektnr">' + t('label_prosjektnr') + '</label>' +
                '<input type="text" class="service-entry-prosjektnr" inputmode="numeric" value="' + escapeHtml(data.prosjektnr || '') + '"></div>' +
            '<div class="mobile-field' + pnavnReq + '"><label data-i18n="label_prosjektnavn">' + t('label_prosjektnavn') + '</label>' +
                '<input type="text" class="service-entry-prosjektnavn" autocapitalize="sentences" value="' + escapeHtml(data.prosjektnavn || '') + '"></div>' +
            '<div class="mobile-order-materials-section' + matReq + '">' +
                '<label class="mobile-order-sublabel" data-i18n="order_materials_label">' + t('order_materials_label') + '</label>' +
                '<div class="mobile-order-materials"></div>' +
                '<button type="button" class="mobile-add-mat-btn" onclick="openMaterialPicker(this)">+ ' + t('order_add_material') + '</button>' +
                '<button type="button" class="section-skip-link" onclick="toggleOrderSkip(this, \'materier\')" data-i18n="order_skip_materialer">' + t('order_skip_materialer') + '</button>' +
                '<div class="section-skip-status" hidden>' +
                    '<span class="section-skip-icon">✓</span>' +
                    '<span class="section-skip-text" data-i18n="order_skipped_materialer">' + t('order_skipped_materialer') + '</span>' +
                    '<button type="button" class="section-skip-undo" onclick="toggleOrderSkip(this, \'materier\')" data-i18n="btn_undo">' + t('btn_undo') + '</button>' +
                '</div>' +
            '</div>' +
        '</div>' +
        '</div>';

    // Add materials
    var matContainer = card.querySelector('.mobile-order-materials');
    var mats = data.materials && data.materials.length > 0 ? data.materials : [];
    renderMaterialSummary(matContainer, mats);

    // "Ikke aktuelt"-flagg for materialer på service-entry. Samme mønster som
    // ordreseddel; serviceentries har ikke arbeidstid-seksjon.
    if (data.materierSkipped === true) card.setAttribute('data-skip-materier', 'true');
    if (typeof _updateOrderSkipUI === 'function') _updateOrderSkipUI(card);

    // Update header live when prosjektnavn changes
    card.querySelector('.service-entry-prosjektnavn').addEventListener('input', renumberServiceEntries);

    // Init date input validation
    initDateInput(card.querySelector('.service-entry-dato'));

    return card;
}

function addServiceEntry() {
    var container = document.getElementById('service-entries');
    container.querySelectorAll('.service-entry-card').forEach(function(card) {
        var wrap = card.querySelector('.mobile-order-body-wrap');
        if (wrap && wrap.classList.contains('expanded')) {
            wrap.classList.remove('expanded');
            card.querySelector('.mobile-order-arrow').innerHTML = '&#9660;';
        }
    });
    // Ny entry får alltid dagens dato (system-styrt)
    var entryData = { dato: formatDate(new Date()) };
    var card = createServiceEntryCard(entryData, true);
    container.appendChild(card);
    updateServiceDeleteStates();
    renumberServiceEntries();
    sessionStorage.setItem('firesafe_service_current', JSON.stringify(getServiceFormData()));
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function removeServiceEntry(btn) {
    var card = btn.closest('.service-entry-card');
    var container = document.getElementById('service-entries');
    if (container.querySelectorAll('.service-entry-card').length <= 1) return;
    showConfirmModal(t('service_entry_delete_confirm'), function() {
        card.remove();
        updateServiceDeleteStates();
        renumberServiceEntries();
        sessionStorage.setItem('firesafe_service_current', JSON.stringify(getServiceFormData()));
    }, t('btn_remove'), '#e74c3c');
}

function toggleServiceEntry(headerEl) {
    if (document.activeElement) document.activeElement.blur();
    var card = headerEl.closest('.service-entry-card');
    var wrap = card.querySelector('.mobile-order-body-wrap');
    var arrow = headerEl.querySelector('.mobile-order-arrow');
    if (!wrap.classList.contains('expanded')) {
        wrap.classList.add('expanded');
        arrow.innerHTML = '&#9650;';
        setTimeout(function() { scrollCardToTop(card, true); }, 270);
    } else {
        wrap.classList.remove('expanded');
        arrow.innerHTML = '&#9660;';
    }
}

function renumberServiceEntries() {
    document.querySelectorAll('#service-entries .service-entry-card').forEach(function(card, idx) {
        var nameInput = card.querySelector('.service-entry-prosjektnavn');
        var title = nameInput && nameInput.value.trim()
            ? nameInput.value.trim()
            : t('service_entry_title') + ' ' + (idx + 1);
        card.querySelector('.service-entry-title').textContent = title;
    });
}

function updateServiceDeleteStates() {
    var cards = document.querySelectorAll('#service-entries .service-entry-card');
    var delBtns = document.querySelectorAll('#service-entries .mobile-order-header-delete');
    delBtns.forEach(function(btn) { btn.disabled = cards.length <= 1; });
}

function getServiceFormData() {
    var entries = [];
    document.querySelectorAll('#service-entries .service-entry-card').forEach(function(card) {
        var matContainer = card.querySelector('.mobile-order-materials');
        var mats = matContainer ? getMaterialsFromContainer(matContainer) : [];
        // "Ikke aktuelt"-flagg, kun lagret når true OG tomt (samme regel som
        // ordreseddel).
        var materierSkipped = card.getAttribute('data-skip-materier') === 'true' && mats.length === 0;
        entries.push({
            dato: card.querySelector('.service-entry-dato').value,
            prosjektnr: card.querySelector('.service-entry-prosjektnr').value,
            prosjektnavn: card.querySelector('.service-entry-prosjektnavn').value,
            materials: mats,
            materierSkipped: materierSkipped
        });
    });
    return {
        type: 'service',
        montor: document.getElementById('service-montor').value,
        uke: (document.getElementById('service-uke') || {}).value || '',
        signaturePaths: window._serviceSignaturePaths || [],
        canvasAspectRatio: canvasAspectRatio,
        signatureImage: document.getElementById('service-signatur').value,
        entries: entries,
        savedAt: new Date().toISOString()
    };
}

function setServiceFormData(data) {
    if (typeof syncOneFormWithProjects === 'function') data = syncOneFormWithProjects(data, 'identity');
    if (!data) return;
    var montorEl = document.getElementById('service-montor');
    if (montorEl) montorEl.value = stripEtternavn(data.montor);
    var ukeEl = document.getElementById('service-uke');
    if (ukeEl) ukeEl.value = data.uke || '';

    // Restore signature
    window._serviceSignaturePaths = data.signaturePaths || [];
    var sigInput = document.getElementById('service-signatur');
    if (sigInput) sigInput.value = data.signatureImage || '';
    var srvPreviewImg = document.getElementById('service-signature-preview-img');
    var srvPlaceholder = document.querySelector('#service-signature-preview .signature-placeholder');
    if (data.signatureImage && data.signatureImage.startsWith('data:image')) {
        if (srvPreviewImg) { srvPreviewImg.src = data.signatureImage; srvPreviewImg.style.display = 'block'; }
        if (srvPlaceholder) srvPlaceholder.style.display = 'none';
    } else {
        if (srvPreviewImg) { srvPreviewImg.style.display = 'none'; srvPreviewImg.src = ''; }
        if (srvPlaceholder) srvPlaceholder.style.display = '';
    }

    // Render entries
    var container = document.getElementById('service-entries');
    container.innerHTML = '';
    var list = data.entries && data.entries.length > 0 ? data.entries : [{}];
    list.forEach(function(entry, idx) {
        // Alle ekspandert ved åpning (konsekvent med ordreseddel/kappe).
        container.appendChild(createServiceEntryCard(entry, true));
    });
    renumberServiceEntries();
    updateServiceDeleteStates();
}

// ─── Timebok: Firestore-henting ─────────────────────────────────────────────
// Siste N dager (for initial cache). docId = YYYY-MM-DD → sorterbar.
async function getTimebokRecentDays() {
    if (currentUser && db) {
        try {
            var snapshot = await db.collection('users').doc(currentUser.uid).collection('timebok')
                .orderBy(firebase.firestore.FieldPath.documentId(), 'desc').limit(60).get();
            return snapshot.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        } catch (e) { console.error('getTimebokRecentDays error:', e); }
    }
    return safeParseJSON(TIMEBOK_STORAGE_KEY, []);
}
// Dager innenfor en dato-range (begge inkl., YYYY-MM-DD-strenger).
async function getTimebokDays(startId, endId) {
    if (currentUser && db) {
        try {
            var fp = firebase.firestore.FieldPath.documentId();
            var snapshot = await db.collection('users').doc(currentUser.uid).collection('timebok')
                .orderBy(fp).startAt(startId).endAt(endId).get();
            return snapshot.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        } catch (e) { console.error('getTimebokDays error:', e); }
    }
    return safeParseJSON(TIMEBOK_STORAGE_KEY, []).filter(function (d) {
        var id = d.id || d.date; return id >= startId && id <= endId;
    });
}

// Firebase helpers for service forms
async function getServiceForms(lastDoc) {
    if (currentUser && db) {
        try {
            var q = db.collection('users').doc(currentUser.uid).collection('serviceforms')
                .orderBy('savedAt', 'desc').limit(50);
            if (lastDoc) q = q.startAfter(lastDoc);
            var snapshot = await q.get();
            return {
                forms: snapshot.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); }),
                lastDoc: snapshot.docs[snapshot.docs.length - 1] || null
            };
        } catch(e) { console.error('getServiceForms error:', e); }
    }
    return { forms: safeParseJSON(SERVICE_STORAGE_KEY, []), lastDoc: null };
}

async function getServiceSentForms(lastDoc) {
    if (currentUser && db) {
        try {
            var q = db.collection('users').doc(currentUser.uid).collection('serviceArchive')
                .orderBy('savedAt', 'desc').limit(50);
            if (lastDoc) q = q.startAfter(lastDoc);
            var snapshot = await q.get();
            return {
                forms: snapshot.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); }),
                lastDoc: snapshot.docs[snapshot.docs.length - 1] || null
            };
        } catch(e) { console.error('getServiceSentForms error:', e); }
    }
    return { forms: safeParseJSON(SERVICE_ARCHIVE_KEY, []), lastDoc: null };
}

async function getKappeForms(lastDoc) {
    if (currentUser && db) {
        try {
            var q = db.collection('users').doc(currentUser.uid).collection('kappeforms')
                .orderBy('savedAt', 'desc').limit(50);
            if (lastDoc) q = q.startAfter(lastDoc);
            var snapshot = await q.get();
            return {
                forms: snapshot.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); }),
                lastDoc: snapshot.docs[snapshot.docs.length - 1] || null
            };
        } catch(e) { console.error('getKappeForms error:', e); }
    }
    return { forms: safeParseJSON(KAPPE_STORAGE_KEY, []), lastDoc: null };
}

async function getKappeSentForms(lastDoc) {
    if (currentUser && db) {
        try {
            var q = db.collection('users').doc(currentUser.uid).collection('kappeArchive')
                .orderBy('savedAt', 'desc').limit(50);
            if (lastDoc) q = q.startAfter(lastDoc);
            var snapshot = await q.get();
            return {
                forms: snapshot.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); }),
                lastDoc: snapshot.docs[snapshot.docs.length - 1] || null
            };
        } catch(e) { console.error('getKappeSentForms error:', e); }
    }
    return { forms: safeParseJSON(KAPPE_ARCHIVE_KEY, []), lastDoc: null };
}

// Get all orders data from mobile form
function getOrdersData() {
    const orders = [];
    document.querySelectorAll('#mobile-orders .mobile-order-card').forEach(card => {
        const descInput = card.querySelector('.mobile-order-desc');
        const description = descInput.value;
        const merknad = card.querySelector('.mobile-order-merknad').value;
        // KANONISK serialisering — gjør «ulagret»-deteksjonen representasjons-
        // uavhengig: like data gir ALLTID lik JSON, uansett intern nøkkel-
        // rekkefølge eller avviklede felt. Dette er grunnen til at å åpne en
        // popup og trykke OK uten å endre noe IKKE skal markere skjemaet ulagret.
        const timerObj = JSON.parse(card.getAttribute('data-timer') || '{}');
        var timerCanon = {};
        ['ma','ti','on','to','fr','lo','so','_generelt','_total'].forEach(function(k) {
            if (timerObj[k] != null && String(timerObj[k]).trim()) timerCanon[k] = String(timerObj[k]).trim();
        });
        // .uker MÅ hvitelistes her. Hviteliste-filteret er selve mekanismen som gjør
        // serialiseringen kanonisk, så et felt som ikke står her blir stille kastet
        // ved lagring. Uten den mistet en fler-ukes ordreseddel uke-fordelingen, og
        // timerWeekBuckets falt tilbake til «alt på første uke» ved gjenåpning —
        // uke 31 så tom ut selv om timene var ført.
        // Kanoniseres etter samme prinsipp som de flate nøklene: uker i stigende
        // rekkefølge, dagnøkler i fast rekkefølge, tomme verdier utelatt. Ellers
        // ville nøkkel-rekkefølgen i JSON kunne markere skjemaet «ulagret» uten at
        // noe var endret.
        if (timerObj.uker && typeof timerObj.uker === 'object') {
            var ukerCanon = {};
            Object.keys(timerObj.uker)
                .sort(function(a, b) { return Number(a) - Number(b); })
                .forEach(function(w) {
                    var src = timerObj.uker[w] || {};
                    var dst = {};
                    ['ma','ti','on','to','fr','lo','so','_generelt'].forEach(function(k) {
                        if (src[k] != null && String(src[k]).trim()) dst[k] = String(src[k]).trim();
                    });
                    if (Object.keys(dst).length) ukerCanon[w] = dst;
                });
            if (Object.keys(ukerCanon).length) timerCanon.uker = ukerCanon;
        }
        // .personer MÅ hvitelistes av samme grunn som .uker: hviteliste-filteret
        // ER mekanismen som gjør serialiseringen kanonisk, så et felt som ikke står
        // her blir stille kastet ved lagring — og personfordelingen ville forsvunnet
        // ved første lagring etter at den ble ført.
        // Kanoniseres i lagret rekkefølge (personlista er ordnet — rekkefølgen
        // styrer linjene i eksporten), med uker stigende og dagnøkler i fast
        // rekkefølge, så JSON-en ikke kan endre seg uten at innholdet gjorde det.
        if (Array.isArray(timerObj.personer) && timerObj.personer.length) {
            var persCanon = [];
            timerObj.personer.forEach(function(p) {
                var navn = String((p && p.navn) || '').trim();
                var ukerP = {};
                Object.keys((p && p.uker) || {})
                    .sort(function(a, b) { return Number(a) - Number(b); })
                    .forEach(function(w) {
                        var srcP = p.uker[w] || {};
                        var dstP = {};
                        ['ma','ti','on','to','fr','lo','so','_generelt'].forEach(function(k) {
                            if (srcP[k] != null && String(srcP[k]).trim()) dstP[k] = String(srcP[k]).trim();
                        });
                        if (Object.keys(dstP).length) ukerP[w] = dstP;
                    });
                if (Object.keys(ukerP).length) persCanon.push({ navn: navn, uker: ukerP });
            });
            if (persCanon.length) timerCanon.personer = persCanon;
        }
        const timer = Object.keys(timerCanon).length > 0 ? timerCanon : '';
        // Arbeidsdager = dager med timer (avledet, ikke stale data-dager).
        const dager = ['ma','ti','on','to','fr','lo','so'].filter(function(d) { return timerCanon[d]; });
        // Etasjer = bestilling-nivå union (kanonisk via _getCardPlans). dayPlans
        // (per-dag) er avviklet → alltid tom, så representasjonen ikke gir drift.
        var plansArr = (typeof _getCardPlans === 'function') ? _getCardPlans(card) : [];
        const plans = (Array.isArray(plansArr) && plansArr.length) ? plansArr : '';
        const dayPlans = '';
        // «Plan»-strengen (eksport-mirror) avledes fra de kanoniske etasjene, så
        // den ikke driver fra .plan-display sin tekst-rekkefølge.
        const plan = (Array.isArray(plansArr) && plansArr.length) ? plansArr.join(', ') : '';
        const matContainer = card.querySelector('.mobile-order-materials');
        const materials = getMaterialsFromContainer(matContainer);
        // "Ikke aktuelt"-flagg. Kun lagret når true OG seksjonen er tom (ellers
        // er flagget irrelevant; FILLED-state fjerner det implisitt i UI).
        const materierSkipped = card.getAttribute('data-skip-materier') === 'true' && materials.length === 0;
        const dagerSkipped = card.getAttribute('data-skip-dager') === 'true' && !timer && !plans;
        orders.push({ description, dager, plan, dayPlans, plans, merknad, materials, timer, materierSkipped, dagerSkipped });
    });
    return orders;
}

// Sync mobile form to original (desktop) form for export
function syncMobileToOriginal() {
    // Simple fields
    const fieldMap = {
        'mobile-ordreseddel-nr': 'ordreseddel-nr',
        'mobile-oppdragsgiver': 'oppdragsgiver',
        'mobile-kundens-ref': 'kundens-ref',
        'mobile-fakturaadresse': 'fakturaadresse',
        'mobile-dato': 'dato',
        'mobile-prosjektnr': 'prosjektnr',
        'mobile-prosjektnavn': 'prosjektnavn',
        'mobile-montor': 'montor',
        'mobile-avdeling': 'avdeling',
        'mobile-sted': 'sted',
        'mobile-signering-dato': 'signering-dato',
        'mobile-kundens-underskrift': 'kundens-underskrift'
    };

    for (const [mobileId, originalId] of Object.entries(fieldMap)) {
        const mobileEl = document.getElementById(mobileId);
        const originalEl = document.getElementById(originalId);
        if (mobileEl && originalEl) {
            originalEl.value = mobileEl.value;
        }
    }

    // Update desktop signature image for export
    const signatureData = document.getElementById('mobile-kundens-underskrift').value;
    const desktopSigImg = document.getElementById('desktop-signature-img');
    if (desktopSigImg) {
        if (signatureData && signatureData.startsWith('data:image')) {
            desktopSigImg.src = signatureData;
            desktopSigImg.style.display = 'block';
        } else {
            desktopSigImg.style.display = 'none';
        }
    }

    // Build desktop work lines dynamically
    buildDesktopWorkLines();
}

// ============================================
// SIGNATURE (SVG-based for perfect scaling)
// ============================================

var signatureTarget = 'form'; // 'form' or 'service'
let signatureCanvas = null;
let signatureCtx = null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let signaturePaths = []; // Store paths for SVG generation
let signaturePathsBackup = []; // Backup for cancel functionality
let currentPath = [];
let canvasAspectRatio = 4; // width/height ratio, default 4:1
const signatureRatio = 3;

let signatureOrientationLocked = false;

// Failsafe: actively unlock orientation at app start so a previous session's lock
// (e.g., from a crashed signature flow) can't persist. Only signature overlay
// re-locks to landscape temporarily (see openSignatureOverlay).
if (screen.orientation && screen.orientation.unlock) {
    try { screen.orientation.unlock(); } catch(e) {}
}

function handleSignatureOrientationChange() {
    setTimeout(updateSignatureLayout, 200);
}

function updateSignatureLayout() {
    var overlay = document.getElementById('signature-overlay');
    if (!overlay.classList.contains('active')) return;

    // Re-init canvas only when device is landscape (portrait viser "snu enheten"-melding via CSS)
    var isPortraitMobile = window.innerWidth <= 1024 && window.innerHeight > window.innerWidth;
    if (isPortraitMobile) return;

    initSignatureCanvas();
    redrawSignature();
}

function _blockSignatureGestures(e) {
    // Blokker browser-håndterte gester (kant-swipe → tilbake, pull-to-refresh, pinch-zoom)
    // mens signaturfeltet er åpent. Pointer events fortsetter å fungere for tegning.
    // Tillat touches på knapper og inputs slik at click-events fyrer normalt.
    var t = e.target;
    if (t && t.closest && t.closest('button, input, select, textarea, a')) {
        return;
    }
    if (e.cancelable) e.preventDefault();
}

async function openSignatureOverlay() {
    const overlay = document.getElementById('signature-overlay');

    // Try to force landscape (works in installed PWA without fullscreen)
    signatureOrientationLocked = false;
    if (screen.orientation && screen.orientation.lock) {
        try {
            await screen.orientation.lock('landscape-primary');
            signatureOrientationLocked = true;
        } catch(e) {}
    }

    window._signatureSavedScroll = _saveScrollPositions();
    overlay.classList.add('active');
    document.body.classList.add('signature-active');

    window.addEventListener('resize', updateSignatureLayout);
    window.addEventListener('orientationchange', handleSignatureOrientationChange);
    document.addEventListener('touchstart', _blockSignatureGestures, { passive: false });
    document.addEventListener('touchmove', _blockSignatureGestures, { passive: false });
    document.addEventListener('gesturestart', _blockSignatureGestures, { passive: false });
    currentPath = [];
    if (signatureTarget === 'service') {
        signaturePaths = window._serviceSignaturePaths || [];
        signaturePathsBackup = JSON.parse(JSON.stringify(signaturePaths));
        window._signatureImageBackup = document.getElementById('service-signatur').value || '';
    } else {
        signaturePathsBackup = JSON.parse(JSON.stringify(signaturePaths));
        window._signatureImageBackup = document.getElementById('mobile-kundens-underskrift').value || '';
    }
    window._canvasAspectRatioBackup = canvasAspectRatio;

    requestAnimationFrame(function() {
        requestAnimationFrame(function() {
            initSignatureCanvas();
            redrawSignature();

            // Fallback: if no stroke data but signature image exists (old saved forms),
            // draw the existing image onto the canvas
            if (signaturePaths.length === 0) {
                var sigData = signatureTarget === 'service'
                    ? document.getElementById('service-signatur').value
                    : document.getElementById('mobile-kundens-underskrift').value;
                if (sigData && sigData.startsWith('data:image')) {
                    var img = new Image();
                    img.onload = function() {
                        var cw = signatureCanvas.clientWidth;
                        var ch = signatureCanvas.clientHeight;
                        var scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight) * 0.8;
                        var iw = img.naturalWidth * scale;
                        var ih = img.naturalHeight * scale;
                        signatureCtx.drawImage(img, (cw - iw) / 2, (ch - ih) / 2, iw, ih);
                    };
                    img.src = sigData;
                }
            }
        });
    });
}

function cleanupSignatureOverlay() {
    window.removeEventListener('resize', updateSignatureLayout);
    window.removeEventListener('orientationchange', handleSignatureOrientationChange);
    document.removeEventListener('touchstart', _blockSignatureGestures);
    document.removeEventListener('touchmove', _blockSignatureGestures);
    document.removeEventListener('gesturestart', _blockSignatureGestures);

    var overlay = document.getElementById('signature-overlay');
    overlay.classList.remove('active');
    document.body.classList.remove('signature-active');
    _restoreScrollPositions(window._signatureSavedScroll);
    window._signatureSavedScroll = null;
    overlay.style.width = '';
    overlay.style.height = '';
    overlay.style.right = '';
    overlay.style.bottom = '';
    overlay.style.transform = '';
    overlay.style.transformOrigin = '';

    if (signatureOrientationLocked) {
        signatureOrientationLocked = false;
        // Unlock so user can rotate freely again
        if (screen.orientation && screen.orientation.unlock) {
            try { screen.orientation.unlock(); } catch(e) {}
        }
    }
}

function closeSignatureOverlay() {
    signaturePaths = signaturePathsBackup;
    canvasAspectRatio = window._canvasAspectRatioBackup || canvasAspectRatio;
    // Restore image values in case Nullstill cleared them
    if (signatureTarget === 'service') {
        if (window._signatureImageBackup !== undefined) {
            document.getElementById('service-signatur').value = window._signatureImageBackup;
        }
        window._serviceSignaturePaths = JSON.parse(JSON.stringify(signaturePathsBackup));
    } else {
        if (window._signatureImageBackup !== undefined) {
            document.getElementById('mobile-kundens-underskrift').value = window._signatureImageBackup;
            document.getElementById('kundens-underskrift').value = window._signatureImageBackup;
        }
        // Re-snapshot so unsaved-changes detection stays accurate
        if (typeof lastSavedData !== 'undefined' && lastSavedData !== null) {
            lastSavedData = getFormDataSnapshot();
        }
    }
    cleanupSignatureOverlay();
    signatureTarget = 'form';

    // Clear preview flags (preview is still open, no action needed)
    window._signedFromPreview = false;
    window._signedFromServicePreview = false;
}

function _drawSignatureBaseline(ctx, w, h) {
    var y = Math.round(h * 0.7);
    var lineStart = Math.round(w * 0.1);
    var lineEnd = Math.round(w * 0.9);

    ctx.save();
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(lineStart, y);
    ctx.lineTo(lineEnd, y);
    ctx.stroke();

    // Label sentrert under linjen
    ctx.fillStyle = '#999';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var label = (typeof t === 'function') ? t('label_kundens_underskrift') : 'Kundens underskrift';
    ctx.fillText(label, w / 2, y + 8);
    ctx.restore();
}

function redrawSignature() {
    if (!signatureCanvas || !signatureCtx) return;
    const w = signatureCanvas.clientWidth;
    const h = signatureCanvas.clientHeight;

    signatureCtx.fillStyle = '#fff';
    signatureCtx.fillRect(0, 0, w, h);
    _drawSignatureBaseline(signatureCtx, w, h);

    if (signaturePaths.length === 0) return;

    signatureCtx.lineCap = 'round';
    signatureCtx.lineJoin = 'round';
    signatureCtx.lineWidth = 4;
    signatureCtx.strokeStyle = '#000';

    for (const path of signaturePaths) {
        if (path.length < 2) continue;
        signatureCtx.beginPath();
        signatureCtx.moveTo(path[0].x * w, path[0].y * h);
        for (var i = 1; i < path.length - 1; i++) {
            var midX = (path[i].x * w + path[i+1].x * w) / 2;
            var midY = (path[i].y * h + path[i+1].y * h) / 2;
            signatureCtx.quadraticCurveTo(path[i].x * w, path[i].y * h, midX, midY);
        }
        signatureCtx.lineTo(path[path.length-1].x * w, path[path.length-1].y * h);
        signatureCtx.stroke();
    }
}

function initSignatureCanvas() {
    signatureCanvas = document.getElementById('signature-canvas');
    signatureCtx = signatureCanvas.getContext('2d');

    const w = signatureCanvas.clientWidth;
    const h = signatureCanvas.clientHeight;
    signatureCanvas.width = w * signatureRatio;
    signatureCanvas.height = h * signatureRatio;
    signatureCtx.scale(signatureRatio, signatureRatio);

    // Store aspect ratio for correct SVG generation
    canvasAspectRatio = w / h;

    signatureCtx.lineCap = 'round';
    signatureCtx.lineJoin = 'round';
    signatureCtx.lineWidth = 4;
    signatureCtx.strokeStyle = '#000';

    // Clear canvas + tegn baseline-guide
    signatureCtx.fillStyle = '#fff';
    signatureCtx.fillRect(0, 0, w, h);
    _drawSignatureBaseline(signatureCtx, w, h);

    // Pointer events (unified mouse + touch, CSS transform-aware via offsetX/offsetY)
    signatureCanvas.onpointerdown = handlePointerDown;
    signatureCanvas.onpointermove = handlePointerMove;
    signatureCanvas.onpointerup = handlePointerUp;
    signatureCanvas.onpointercancel = handlePointerUp;
}

function getCanvasCoords(e) {
    // offsetX/offsetY are in the element's local coordinate space,
    // automatically accounting for CSS transforms like rotate(90deg)
    return {
        x: e.offsetX / signatureCanvas.clientWidth,
        y: e.offsetY / signatureCanvas.clientHeight
    };
}

function handlePointerDown(e) {
    e.preventDefault();
    signatureCanvas.setPointerCapture(e.pointerId);
    isDrawing = true;
    const coords = getCanvasCoords(e);
    lastX = coords.x;
    lastY = coords.y;
    currentPath = [{x: coords.x, y: coords.y}];
}

function handlePointerMove(e) {
    if (!isDrawing) return;
    e.preventDefault();
    var w = signatureCanvas.clientWidth;
    var h = signatureCanvas.clientHeight;

    // Use coalesced events for smooth lines with all intermediate points
    var events = (typeof e.getCoalescedEvents === 'function') ? e.getCoalescedEvents() : [e];
    if (events.length === 0) events = [e];

    signatureCtx.beginPath();
    signatureCtx.moveTo(lastX * w, lastY * h);
    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        var x = ev.offsetX / w;
        var y = ev.offsetY / h;
        signatureCtx.lineTo(x * w, y * h);
        currentPath.push({x: x, y: y});
        lastX = x;
        lastY = y;
    }
    signatureCtx.stroke();
}

function handlePointerUp() {
    if (isDrawing && currentPath.length > 1) {
        signaturePaths.push([...currentPath]);
    }
    isDrawing = false;
    currentPath = [];
}

function clearSignatureCanvas() {
    if (signatureCanvas && signatureCtx) {
        var w = signatureCanvas.clientWidth;
        var h = signatureCanvas.clientHeight;
        signatureCtx.fillStyle = '#fff';
        signatureCtx.fillRect(0, 0, w, h);
        _drawSignatureBaseline(signatureCtx, w, h);
        signaturePaths = [];
        currentPath = [];
        // Also clear existing image so OK after Nullstill actually removes signature
        document.getElementById('mobile-kundens-underskrift').value = '';
        document.getElementById('kundens-underskrift').value = '';
    }
}

function generateSVG(targetHeight, strokeWidth) {
    if (signaturePaths.length === 0) return null;

    // Calculate bounding box of signature (in normalized 0-1 coords)
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const path of signaturePaths) {
        for (const point of path) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }
    }

    // Add padding (5% of signature size)
    const padX = (maxX - minX) * 0.05;
    const padY = (maxY - minY) * 0.05;
    minX = Math.max(0, minX - padX);
    maxX = Math.min(1, maxX + padX);
    minY = Math.max(0, minY - padY);
    maxY = Math.min(1, maxY + padY);

    const boxWidth = maxX - minX;
    const boxHeight = maxY - minY;

    if (boxWidth <= 0 || boxHeight <= 0) return null;

    // Calculate output dimensions (maintaining signature aspect ratio, accounting for canvas shape)
    const sigAspect = (boxWidth / boxHeight) * (canvasAspectRatio || 1);
    const outputHeight = targetHeight;
    const outputWidth = Math.round(outputHeight * sigAspect);

    // Build path data with quadratic bezier curves for smooth lines
    let pathData = '';
    for (const path of signaturePaths) {
        if (path.length < 2) continue;
        var sx = ((path[0].x - minX) / boxWidth) * outputWidth;
        var sy = ((path[0].y - minY) / boxHeight) * outputHeight;
        pathData += 'M ' + sx.toFixed(2) + ' ' + sy.toFixed(2) + ' ';
        for (var i = 1; i < path.length - 1; i++) {
            var cx = ((path[i].x - minX) / boxWidth) * outputWidth;
            var cy = ((path[i].y - minY) / boxHeight) * outputHeight;
            var mx = ((path[i].x + path[i+1].x) / 2 - minX) / boxWidth * outputWidth;
            var my = ((path[i].y + path[i+1].y) / 2 - minY) / boxHeight * outputHeight;
            pathData += 'Q ' + cx.toFixed(2) + ' ' + cy.toFixed(2) + ' ' + mx.toFixed(2) + ' ' + my.toFixed(2) + ' ';
        }
        var lx = ((path[path.length-1].x - minX) / boxWidth) * outputWidth;
        var ly = ((path[path.length-1].y - minY) / boxHeight) * outputHeight;
        pathData += 'L ' + lx.toFixed(2) + ' ' + ly.toFixed(2) + ' ';
    }

    if (!pathData) return null;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${outputWidth} ${outputHeight}">
        <path d="${pathData}" fill="none" stroke="#000" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    return 'data:image/svg+xml;base64,' + btoa(svg);
}

function confirmSignature() {
    const hasSignature = signaturePaths.length > 0;

    if (signatureTarget === 'service') {
        var hasExistingServiceImage = !!document.getElementById('service-signatur').value;
        if (!hasSignature) {
            document.getElementById('service-signatur').value = '';
            window._serviceSignaturePaths = [];
        } else {
            var svgData = generateSVG(400, 18);
            if (svgData) {
                document.getElementById('service-signatur').value = svgData;
            }
        }
        window._serviceSignaturePaths = JSON.parse(JSON.stringify(signaturePaths));
        signaturePathsBackup = JSON.parse(JSON.stringify(signaturePaths));
        cleanupSignatureOverlay();
        signatureTarget = 'form';

        // Update service signature preview in form
        var srvSigData = document.getElementById('service-signatur').value;
        var srvPreviewImg = document.getElementById('service-signature-preview-img');
        var srvPlaceholder = document.querySelector('#service-signature-preview .signature-placeholder');
        if (srvPreviewImg && srvSigData && srvSigData.startsWith('data:image')) {
            srvPreviewImg.src = srvSigData;
            srvPreviewImg.style.display = 'block';
            if (srvPlaceholder) srvPlaceholder.style.display = 'none';
        } else if (srvPreviewImg) {
            srvPreviewImg.style.display = 'none';
            srvPreviewImg.src = '';
            if (srvPlaceholder) srvPlaceholder.style.display = '';
        }

        // Signert fra service-preview → regenerer PDF-preview med ny signatur.
        if (window._signedFromServicePreview) {
            window._signedFromServicePreview = false;
            updatePreviewHeaderState(hasSignature);
            if (typeof openServicePreview === 'function') openServicePreview();
        }
        return;
    }

    const hasExistingImage = !!document.getElementById('mobile-kundens-underskrift').value;

    if (!hasSignature && !hasExistingImage) {
        // No new drawing and no existing signature — clear
        document.getElementById('mobile-kundens-underskrift').value = '';
        document.getElementById('kundens-underskrift').value = '';
        document.getElementById('signature-preview-img').style.display = 'none';
        document.querySelector('#mobile-signature-preview .signature-placeholder').style.display = '';
    } else if (!hasSignature && hasExistingImage) {
        // No new drawing but existing signature — keep it as-is
    } else {
        // Generate SVG cropped to signature bounding box (high resolution, bold stroke)
        const svgData = generateSVG(400, 18);

        if (svgData) {
            document.getElementById('mobile-kundens-underskrift').value = svgData;
            document.getElementById('kundens-underskrift').value = svgData;
            const previewImg = document.getElementById('signature-preview-img');
            previewImg.src = svgData;
            previewImg.style.display = 'block';
            document.querySelector('#mobile-signature-preview .signature-placeholder').style.display = 'none';
        }
    }

    // Update backup to current paths (user confirmed, so keep changes)
    signaturePathsBackup = JSON.parse(JSON.stringify(signaturePaths));
    cleanupSignatureOverlay();

    // Signert fra ordreseddel-preview → regenerer PDF-preview med ny signatur.
    if (window._signedFromPreview) {
        window._signedFromPreview = false;
        updatePreviewHeaderState(hasSignature);
        if (typeof openPreview === 'function') openPreview();
    }
}

function clearSignaturePreview() {
    document.getElementById('mobile-kundens-underskrift').value = '';
    const previewImg = document.getElementById('signature-preview-img');
    if (previewImg) {
        previewImg.style.display = 'none';
        previewImg.src = '';
    }
    const placeholder = document.querySelector('#mobile-signature-preview .signature-placeholder');
    if (placeholder) placeholder.style.display = '';

    const desktopInput = document.getElementById('kundens-underskrift');
    if (desktopInput) desktopInput.value = '';

    signaturePaths = [];
    signaturePathsBackup = [];
}

function loadSignaturePreview(dataUrl) {
    if (dataUrl) {
        document.getElementById('mobile-kundens-underskrift').value = dataUrl;
        const previewImg = document.getElementById('signature-preview-img');
        if (previewImg) {
            previewImg.src = dataUrl;
            previewImg.style.display = 'block';
        }
        const placeholder = document.querySelector('#mobile-signature-preview .signature-placeholder');
        if (placeholder) placeholder.style.display = 'none';
    }
}

// Build the desktop form work lines from orders data (for PDF export)
function buildDesktopWorkLines() {
    const container = document.getElementById('work-lines');
    container.innerHTML = '';

    const orders = getOrdersData();

    function addRow(descText, antallText, enhetText, options) {
        const row = document.createElement('div');
        row.className = 'work-line';
        const descDiv = document.createElement('div');
        descDiv.className = 'work-line-desc';
        const descContent = document.createElement('div');
        descContent.className = 'work-line-desc-text';
        descContent.textContent = descText || '';
        if (options && options.bold) descContent.style.fontWeight = 'bold';
        if (options && options.italic) descContent.style.fontStyle = 'italic';
        if (options && options.alignRight) {
            descContent.style.textAlign = 'right';
            descContent.style.paddingRight = '20px';
        }
        descDiv.appendChild(descContent);
        row.appendChild(descDiv);

        const antallDiv = document.createElement('div');
        antallDiv.className = 'work-line-antall';
        const antallSpan = document.createElement('span');
        antallSpan.textContent = antallText || '';
        antallDiv.appendChild(antallSpan);
        row.appendChild(antallDiv);

        const enhetDiv = document.createElement('div');
        enhetDiv.className = 'work-line-enhet';
        const enhetSpan = document.createElement('span');
        enhetSpan.textContent = enhetText || '';
        enhetDiv.appendChild(enhetSpan);
        row.appendChild(enhetDiv);

        container.appendChild(row);
    }

    let totalTimer = 0;
    // Teller bestillingene som FAKTISK bidrar til timesummen. Sum-raden nederst
    // skjules når det bare er én — da ville den bare gjentatt bestillingens egen
    // Arbeidstid-rad med samme tall, og se ut som en feil.
    let timerRows = 0;

    orders.forEach((order, idx) => {
        // Description (with dager, plan and merknad combined, bold labels)
        if (order.description || (order.dager && order.dager.length > 0) || order.plan || order.merknad) {
            const row = document.createElement('div');
            row.className = 'work-line';
            const descDiv = document.createElement('div');
            descDiv.className = 'work-line-desc';
            const descContent = document.createElement('div');
            descContent.className = 'work-line-desc-text';

            if (order.description) {
                // Split description into paragraphs and render with controlled spacing
                const paragraphs = order.description.split(/\n\n+/);
                paragraphs.forEach((para, pIdx) => {
                    if (pIdx > 0) {
                        const spacer = document.createElement('div');
                        spacer.style.height = '6px';
                        descContent.appendChild(spacer);
                    }
                    descContent.appendChild(document.createTextNode(para));
                });
            }

            var genVal = order.timer && typeof order.timer === 'object' ? (order.timer._generelt || order.timer._total) : null;
            const hasMeta = (order.dager && order.dager.length > 0) || genVal || order.plan || order.merknad;
            if (order.description && hasMeta) {
                const spacer = document.createElement('div');
                spacer.style.height = '6px';
                descContent.appendChild(spacer);
            }

            // Én linje per uke når timene er fordelt (se orderArbeidstidMeta).
            var arbMeta = orderArbeidstidMeta(order, currentFormUkeNumbers());
            arbMeta.forEach(function(m, mi) {
                if (mi > 0) descContent.appendChild(document.createTextNode('\n'));
                const dagLabel = document.createElement('strong');
                dagLabel.textContent = m.label;
                descContent.appendChild(dagLabel);
                descContent.appendChild(document.createTextNode(m.value));
            });

            var hasDagerLine = arbMeta.length > 0;
            if (order.plan) {
                if (hasDagerLine) {
                    descContent.appendChild(document.createTextNode('\n'));
                }
                const planLabel = document.createElement('strong');
                planLabel.textContent = 'Plan: ';
                descContent.appendChild(planLabel);
                descContent.appendChild(document.createTextNode(order.plan));
            }

            if (order.merknad) {
                if (hasDagerLine || order.plan) {
                    descContent.appendChild(document.createTextNode('\n'));
                }
                const merknadLabel = document.createElement('strong');
                merknadLabel.textContent = 'Merknad: ';
                descContent.appendChild(merknadLabel);
                descContent.appendChild(document.createTextNode(order.merknad));
            }

            descDiv.appendChild(descContent);
            row.appendChild(descDiv);

            const antallDiv = document.createElement('div');
            antallDiv.className = 'work-line-antall';
            antallDiv.appendChild(document.createElement('span'));
            row.appendChild(antallDiv);

            const enhetDiv = document.createElement('div');
            enhetDiv.className = 'work-line-enhet';
            enhetDiv.appendChild(document.createElement('span'));
            row.appendChild(enhetDiv);

            container.appendChild(row);
        }

        // Materials
        const filledMats = (order.materials || []).filter(m => {
            if (!m.name && !m.antall && !m.enhet) return false;
            // Skip spec-base materials that shouldn't be exported (but not direct
            // meter-/eske-entries — dimensjonsløse poster lagret på basenavnet)
            if (cachedMaterialOptions && m.enhet !== 'meter' && m.enhet !== 'eske') {
                var specBase = cachedMaterialOptions.find(function(o) {
                    return o.name.toLowerCase() === (m.name || '').toLowerCase() && (o.type === 'mansjett' || o.type === 'brannpakning' || o.type === 'kabelhylse');
                });
                if (specBase) return false;
            }
            return true;
        });
        // Aggreger duplikater for eksport (samme name + enhet → sum antall)
        const aggregatedMats = aggregateExportMaterials(filledMats);
        if (aggregatedMats.length > 0) {
            // Helper to add a single material row to export
            function addExportMatRow(m, displayNameOverride) {
                var capName;
                if (displayNameOverride) {
                    capName = displayNameOverride;
                } else {
                    const rawName = m.name ? m.name.charAt(0).toUpperCase() + m.name.slice(1) : '';
                    capName = formatKabelhylseSpec(rawName.replace(/ø(?=\d)/g, 'Ø')).replace(/^(.+?)r(\d+)$/, '$1 ($2 lag)').replace(/^(.+?) (\d+) lag$/, '$1 ($2 lag)');
                    capName += materialVariantSuffix(m);
                }
                const antallNum = parseFloat((m.antall || '').replace(',', '.'));
                // Dimensjonsrader viser STK. Meter-omregningen brukes fortsatt, men
                // kun til gruppe-totalen (specGroupMeterTotal) — derfor er også
                // «(N stk)»-suffikset borte: stykktallet står i antall-kolonnen.
                // «(N lag)» ligger allerede i capName og beholdes.
                if (m.source === 'kappe-products') {
                    // Kappe-isolasjon på ordreseddel: vis materialforbruk i m² (antall plater × plate-areal).
                    // Plater beholdes på kappeskjemaet der det er montørens praktiske enhet.
                    var plateCount = (typeof calcKappePlateCount === 'function') ? calcKappePlateCount(m) : 0;
                    if (plateCount > 0) {
                        var areaM2 = (typeof calcKappeAreaM2 === 'function') ? calcKappeAreaM2(m, plateCount) : 0;
                        var areaLabel = (typeof formatKappeArea === 'function') ? formatKappeArea(areaM2) : String(areaM2);
                        addRow(capName, areaLabel, 'm²', { alignRight: true });
                    } else if (m.antall) {
                        // Fallback hvis bredde/plate-info mangler
                        var fallbackUnit = getMaterialRowUnit(m);
                        addRow(capName, formatRunningMeters(m.antall), fallbackUnit, { alignRight: true });
                    }
                } else {
                    var exportUnit = getMaterialRowUnit(m);
                    // getMaterialRowAntall: rull-dimensjonsrader viser omregnet
                    // meter her, og «(N stk)» ligger allerede i capName.
                    addRow(capName, getMaterialRowAntall(m), exportUnit, { alignRight: true });
                }
            }
            // Group materials for export (sorter items innen hver gruppe)
            var exportGroups = groupMaterialsByBase(aggregatedMats, { sortItems: true });
            // Eksport-spesifikk: slå sammen Isolasjon + Festemidler til én "Isolering"-seksjon.
            // (Ordrekort-summary beholder dem separert siden de håndteres ulikt i innstillinger/picker.)
            (function combineIsoAndFestemidler() {
                var isoIdx = exportGroups.findIndex(function(g) { return g.isIsolationGroup; });
                var festIdx = exportGroups.findIndex(function(g) { return g.isStiftGroup; });
                if (isoIdx === -1 || festIdx === -1) return;
                var isoG = exportGroups[isoIdx];
                var festG = exportGroups[festIdx];
                var mergedGroup = {
                    baseName: isoG.baseName,
                    displayName: 'Isolering',
                    items: isoG.items.concat(festG.items),
                    isSpecGroup: false,
                    isIsolationGroup: true,
                    isStiftGroup: true
                };
                // Fjern høyere index først så lavere index ikke flyttes
                if (festIdx > isoIdx) {
                    exportGroups.splice(festIdx, 1);
                    exportGroups[isoIdx] = mergedGroup;
                } else {
                    exportGroups.splice(isoIdx, 1);
                    exportGroups[festIdx] = mergedGroup;
                }
            })();
            // Ingen «Materiell:»-header over de løse varene. Den navnga hele
            // tabellen, ikke en gruppe — alt under er materiell — men hadde
            // samme stil som produkt-headerne (fet, høyrestilt) og leste derfor
            // som et produktnavn. Kolonne-headerne gir konteksten, og rammen
            // gir skillet mot beskrivelses-blokken over. Dokumentet var
            // uansett allerede uten den når alle varer lå i sub-grupper.
            // Samme fjerning i computeWorkRows (PDF) — de to må være like.
            exportGroups.forEach(function(group) {
                if (!group.isSpecGroup && !group.isIsolationGroup && !group.isStiftGroup) {
                    group.items.forEach(function(gm) { addExportMatRow(gm); });
                } else {
                    // Group header row (bold base name)
                    var exportGroupTitle = group.displayName || group.baseName;
                    addRow('  ' + exportGroupTitle.charAt(0).toUpperCase() + exportGroupTitle.slice(1) + ':', '', '', { bold: true, alignRight: true });
                    // Meter-totalen regnes av den DELTE helperen, ikke inline — den
                    // har tre konsumenter (denne, computeWorkRows og ordrekortet) og
                    // ville ellers drevet fra hverandre.
                    var groupMeter = specGroupMeterTotal(group.items);
                    var groupTotalPlater = 0;
                    var groupHasPlater = false;
                    // For Isolering: pre-aggreger isolasjons-rader med samme produkt+tykkelse,
                    // summer plate-antall. Festemiddel-items beholdes som separate rader.
                    var renderItems = group.items;
                    var isoAggLength = 0;
                    if (group.isIsolationGroup) {
                        var isoAgg = [];
                        var isoMap = {};
                        var nonIsoItems = [];
                        group.items.forEach(function(gm) {
                            if (gm.source !== 'kappe-products') {
                                // Festemiddel (kappe-stift / kappe-fastener) eller annet: ingen aggregering
                                nonIsoItems.push(gm);
                                return;
                            }
                            var key = (gm.name || '').toLowerCase() + '|' + (gm.enhet || '').toLowerCase();
                            var gmPC = (typeof calcKappePlateCount === 'function') ? calcKappePlateCount(gm) : 0;
                            if (isoMap[key]) {
                                isoMap[key].__plateSum += gmPC;
                            } else {
                                // plate bæres med så m²-beregningen får riktig plate-areal (samme produkt+tykkelse → samme plate).
                                isoMap[key] = { name: gm.name, enhet: gm.enhet, source: gm.source, plate: gm.plate, __plateSum: gmPC };
                                isoAgg.push(isoMap[key]);
                            }
                        });
                        isoAggLength = isoAgg.length;
                        renderItems = isoAgg.concat(nonIsoItems);
                    }
                    renderItems.forEach(function(gm) {
                        var subName;
                        if (gm.source === 'kappe-products' && typeof formatKappeIsolationName === 'function') {
                            // Eksport: vis produktnavn + tykkelse uten bredde/plate-suffiks.
                            subName = formatKappeIsolationName(gm.name, gm.enhet);
                        } else {
                            subName = getGroupedDisplayName(gm, group.baseName);
                        }
                        subName = subName.charAt(0).toUpperCase() + subName.slice(1);
                        subName = formatKabelhylseSpec(subName.replace(/ø(?=\d)/g, 'Ø')).replace(/^(.+?)r(\d+)$/, '$1 ($2 lag)').replace(/^(.+?) (\d+) lag$/, '$1 ($2 lag)');
                        if (gm.__plateSum != null) {
                            // Pre-aggregert isolasjon-rad: vis materialforbruk i m² (summert plater × plate-areal).
                            var aggM2 = (typeof calcKappeAreaM2 === 'function') ? calcKappeAreaM2(gm, gm.__plateSum) : 0;
                            var aggLabel = (typeof formatKappeArea === 'function') ? formatKappeArea(aggM2) : String(aggM2);
                            addRow('    ' + subName, aggLabel, 'm²', { alignRight: true });
                            groupTotalPlater += gm.__plateSum;
                            groupHasPlater = true;
                            return;
                        }
                        addExportMatRow(gm, '    ' + subName);
                        // Kun plate-akkumulering her; meter kommer fra specGroupMeterTotal.
                        if (gm.source === 'kappe-products') {
                            var gmPlateCount = (typeof calcKappePlateCount === 'function') ? calcKappePlateCount(gm) : 0;
                            if (gmPlateCount > 0) {
                                groupTotalPlater += gmPlateCount;
                                groupHasPlater = true;
                            }
                        }
                    });
                    // Totalt-rad: kun for spec-grupper (FSC/FSW/Kabelhylse) der alle rader representerer
                    // samme produkt med ulike spec/runder — der gir summen mening.
                    // For Isolering har hver rad et UNIKT produkt (Fireprotect 20mm vs 22mm vs ...),
                    // så et "totalt" på tvers ville ikke vært meningsfullt.
                    // Vises ved ETT bidrag også: radene viser stk, så totalen er nå
                    // ENESTE sted meter finnes — skjules den, forsvinner tallet helt.
                    if (groupMeter.hasMeter) {
                        addRow('    ' + specGroupTotalLabel(groupMeter.hasEske),
                            formatMeterTenths(groupMeter.tenths), 'meter', { bold: true, alignRight: true });
                    }
                }
            });
        }

        // Timer — sum all values (days + _generelt/_total). Etiketten hentes fra
        // t('order_days') slik at den er ORDRETT lik beskrivelses-linjen over
        // ("Arbeidstid: Mandag (9,5t)…") — ett ord for ett begrep i dokumentet.
        // Fet + tom rad over: uten det klistret raden seg til siste material-
        // gruppe og så ut som en del av den (f.eks. under "Totalt: 8,5 meter").
        if (order.timer && typeof order.timer === 'object') {
            const orderTotal = orderTimerSum(order.timer);
            if (orderTotal > 0) {
                const formatted = orderTotal.toFixed(1).replace('.', ',');
                addRow('', '', '');
                addRow(t('order_days') + ':', formatted, 'timer', { bold: true, alignRight: true });
                totalTimer += orderTotal;
                timerRows++;
            }
        } else if (typeof order.timer === 'string' && order.timer) {
            const val = parseFloat(order.timer.replace(',', '.'));
            const formatted = isNaN(val) ? order.timer.replace('.', ',') : val.toFixed(1).replace('.', ',');
            addRow('', '', '');
            addRow(t('order_days') + ':', formatted, 'timer', { bold: true, alignRight: true });
            if (!isNaN(val)) { totalTimer += val; timerRows++; }
        }
    });

    // Sum på tvers av bestillinger — kun når det faktisk er noe å summere (≥2
    // bidragsytere). Tom rad over for å skille fra siste bestilling (ellers ser
    // det ut som totalen tilhører forrige seksjon). Etiketten bygges fra samme
    // kilde som rad-etiketten, så de aldri spriker; «Totalt:» alene sa ikke hva
    // som ble summert og kolliderte med meter-summen i produktgruppene.
    if (totalTimer > 0 && timerRows > 1) {
        addRow('', '', '');
        const formatted = totalTimer.toFixed(1).replace('.', ',');
        addRow('Total ' + t('order_days').toLowerCase() + ':', formatted, 'timer', { bold: true, alignRight: true });
    }

    // Ensure minimum rows to fill the page
    const currentRows = container.querySelectorAll('.work-line').length;
    for (let i = currentRows; i < 15; i++) {
        addRow('', '', '');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELT rad-/material-beregning for arbeidslinje-tabellen. Returnerer STRUKTURERTE
// rader (data, ikke DOM) slik at den nye tekst-/vektor-PDF-en viser NØYAKTIG
// samme innhold som dagens eksport. Speiler buildDesktopWorkLines-logikken, men
// pusher rader til en array i stedet for DOM. Rad-typer:
//   { kind:'descblock', paragraphs:[str...], meta:[{label, value}] }  — beskrivelse + Dager/Plan/Merknad
//   { desc, antall, enhet, bold, italic, alignRight }                 — material/tid/total-rader
// minRows: fyll opp med tomme rader til minst N (som dagens 15-rad-gulv).
// weeks: ukene skjemaet dekker (fra Uke-feltet). Brukes kun som fallback når en
// bestilling mangler .uker-fordeling — se soleWeekOf.
function computeWorkRows(orders, minRows, weeks) {
    var rows = [];
    function addRow(desc, antall, enhet, options) {
        options = options || {};
        rows.push({
            desc: desc || '', antall: antall || '', enhet: enhet || '',
            bold: !!options.bold, italic: !!options.italic, alignRight: !!options.alignRight
        });
    }
    var totalTimer = 0;
    // Se kommentar i buildDesktopWorkLines — samme teller, må holdes i synk.
    var timerRows = 0;

    (orders || []).forEach(function(order) {
        // Beskrivelse-blokk (beskrivelse + Dager/Plan/Merknad med fete etiketter).
        var genVal = order.timer && typeof order.timer === 'object' ? (order.timer._generelt || order.timer._total) : null;
        if (order.description || (order.dager && order.dager.length > 0) || order.plan || order.merknad) {
            var paragraphs = order.description ? String(order.description).split(/\n\n+/) : [];
            var meta = [];
            // Samme kilde som HTML-eksporten — én linje per uke ved fordeling.
            orderArbeidstidMeta(order, weeks).forEach(function(m) { meta.push(m); });
            if (order.plan) meta.push({ label: 'Plan: ', value: order.plan });
            if (order.merknad) meta.push({ label: 'Merknad: ', value: order.merknad });
            rows.push({ kind: 'descblock', paragraphs: paragraphs, meta: meta });
        }

        // Materialer — identisk med buildDesktopWorkLines (gjenbruker globale helpere).
        var filledMats = (order.materials || []).filter(function(m) {
            if (!m.name && !m.antall && !m.enhet) return false;
            if (cachedMaterialOptions && m.enhet !== 'meter' && m.enhet !== 'eske') {
                var specBase = cachedMaterialOptions.find(function(o) {
                    return o.name.toLowerCase() === (m.name || '').toLowerCase() && (o.type === 'mansjett' || o.type === 'brannpakning' || o.type === 'kabelhylse');
                });
                if (specBase) return false;
            }
            return true;
        });
        var aggregatedMats = aggregateExportMaterials(filledMats);
        if (aggregatedMats.length > 0) {
            function addExportMatRow(m, displayNameOverride) {
                var capName;
                if (displayNameOverride) {
                    capName = displayNameOverride;
                } else {
                    var rawName = m.name ? m.name.charAt(0).toUpperCase() + m.name.slice(1) : '';
                    capName = formatKabelhylseSpec(rawName.replace(/ø(?=\d)/g, 'Ø')).replace(/^(.+?)r(\d+)$/, '$1 ($2 lag)').replace(/^(.+?) (\d+) lag$/, '$1 ($2 lag)');
                    capName += materialVariantSuffix(m);
                }
                var antallNum = parseFloat((m.antall || '').replace(',', '.'));
                // Dimensjonsrader viser STK — se kommentar i buildDesktopWorkLines.
                // Meter-omregningen brukes kun til gruppe-totalen.
                if (m.source === 'kappe-products') {
                    var plateCount = (typeof calcKappePlateCount === 'function') ? calcKappePlateCount(m) : 0;
                    if (plateCount > 0) {
                        var areaM2 = (typeof calcKappeAreaM2 === 'function') ? calcKappeAreaM2(m, plateCount) : 0;
                        var areaLabel = (typeof formatKappeArea === 'function') ? formatKappeArea(areaM2) : String(areaM2);
                        addRow(capName, areaLabel, 'm²', { alignRight: true });
                    } else if (m.antall) {
                        var fallbackUnit = getMaterialRowUnit(m);
                        addRow(capName, formatRunningMeters(m.antall), fallbackUnit, { alignRight: true });
                    }
                } else {
                    var exportUnit = getMaterialRowUnit(m);
                    // getMaterialRowAntall: rull-dimensjonsrader viser omregnet
                    // meter her, og «(N stk)» ligger allerede i capName.
                    addRow(capName, getMaterialRowAntall(m), exportUnit, { alignRight: true });
                }
            }
            var exportGroups = groupMaterialsByBase(aggregatedMats, { sortItems: true });
            (function combineIsoAndFestemidler() {
                var isoIdx = exportGroups.findIndex(function(g) { return g.isIsolationGroup; });
                var festIdx = exportGroups.findIndex(function(g) { return g.isStiftGroup; });
                if (isoIdx === -1 || festIdx === -1) return;
                var isoG = exportGroups[isoIdx], festG = exportGroups[festIdx];
                var mergedGroup = { baseName: isoG.baseName, displayName: 'Isolering', items: isoG.items.concat(festG.items), isSpecGroup: false, isIsolationGroup: true, isStiftGroup: true };
                if (festIdx > isoIdx) { exportGroups.splice(festIdx, 1); exportGroups[isoIdx] = mergedGroup; }
                else { exportGroups.splice(isoIdx, 1); exportGroups[festIdx] = mergedGroup; }
            })();
            // Ingen «Materiell:»-header — se begrunnelsen i buildDesktopWorkLines.
            exportGroups.forEach(function(group) {
                if (!group.isSpecGroup && !group.isIsolationGroup && !group.isStiftGroup) {
                    group.items.forEach(function(gm) { addExportMatRow(gm); });
                } else {
                    var exportGroupTitle = group.displayName || group.baseName;
                    addRow('  ' + exportGroupTitle.charAt(0).toUpperCase() + exportGroupTitle.slice(1) + ':', '', '', { bold: true, alignRight: true });
                    // Delt helper — se buildDesktopWorkLines.
                    var groupMeter = specGroupMeterTotal(group.items);
                    var renderItems = group.items;
                    if (group.isIsolationGroup) {
                        var isoAgg = [], isoMap = {}, nonIsoItems = [];
                        group.items.forEach(function(gm) {
                            if (gm.source !== 'kappe-products') { nonIsoItems.push(gm); return; }
                            var key = (gm.name || '').toLowerCase() + '|' + (gm.enhet || '').toLowerCase();
                            var gmPC = (typeof calcKappePlateCount === 'function') ? calcKappePlateCount(gm) : 0;
                            if (isoMap[key]) { isoMap[key].__plateSum += gmPC; }
                            else { isoMap[key] = { name: gm.name, enhet: gm.enhet, source: gm.source, plate: gm.plate, __plateSum: gmPC }; isoAgg.push(isoMap[key]); }
                        });
                        renderItems = isoAgg.concat(nonIsoItems);
                    }
                    renderItems.forEach(function(gm) {
                        var subName;
                        if (gm.source === 'kappe-products' && typeof formatKappeIsolationName === 'function') subName = formatKappeIsolationName(gm.name, gm.enhet);
                        else subName = getGroupedDisplayName(gm, group.baseName);
                        subName = subName.charAt(0).toUpperCase() + subName.slice(1);
                        subName = formatKabelhylseSpec(subName.replace(/ø(?=\d)/g, 'Ø')).replace(/^(.+?)r(\d+)$/, '$1 ($2 lag)').replace(/^(.+?) (\d+) lag$/, '$1 ($2 lag)');
                        if (gm.__plateSum != null) {
                            var aggM2 = (typeof calcKappeAreaM2 === 'function') ? calcKappeAreaM2(gm, gm.__plateSum) : 0;
                            var aggLabel = (typeof formatKappeArea === 'function') ? formatKappeArea(aggM2) : String(aggM2);
                            addRow('    ' + subName, aggLabel, 'm²', { alignRight: true });
                            return;
                        }
                        addExportMatRow(gm, '    ' + subName);
                    });
                    // Vises ved ETT bidrag også: radene viser stk, så totalen er nå
                    // ENESTE sted meter finnes — skjules den, forsvinner tallet helt.
                    if (groupMeter.hasMeter) {
                        addRow('    ' + specGroupTotalLabel(groupMeter.hasEske),
                            formatMeterTenths(groupMeter.tenths), 'meter', { bold: true, alignRight: true });
                    }
                }
            });
        }

        // Arbeidstid pr. bestilling — etiketten fra t('order_days') så den er
        // ordrett lik beskrivelses-linjen over. Fet + tom rad over så den ikke
        // klistrer seg til siste material-gruppe. Identisk med buildDesktopWorkLines.
        if (order.timer && typeof order.timer === 'object') {
            var orderTotal = orderTimerSum(order.timer);
            if (orderTotal > 0) {
                addRow('', '', '');
                addRow(t('order_days') + ':', orderTotal.toFixed(1).replace('.', ','), 'timer', { bold: true, alignRight: true });
                totalTimer += orderTotal; timerRows++;
            }
        } else if (typeof order.timer === 'string' && order.timer) {
            var val2 = parseFloat(order.timer.replace(',', '.'));
            addRow('', '', '');
            addRow(t('order_days') + ':', isNaN(val2) ? order.timer.replace('.', ',') : val2.toFixed(1).replace('.', ','), 'timer', { bold: true, alignRight: true });
            if (!isNaN(val2)) { totalTimer += val2; timerRows++; }
        }
    });

    // Sum kun når ≥2 bestillinger bidrar — se kommentar i buildDesktopWorkLines.
    if (totalTimer > 0 && timerRows > 1) {
        addRow('', '', '');
        addRow('Total ' + t('order_days').toLowerCase() + ':', totalTimer.toFixed(1).replace('.', ','), 'timer', { bold: true, alignRight: true });
    }
    if (minRows) { for (var i = rows.length; i < minRows; i++) addRow('', '', ''); }
    return rows;
}

// Sync original form to mobile form (not used in new structure, kept for compatibility)
function syncOriginalToMobile() {
    const fieldMap = {
        'ordreseddel-nr': 'mobile-ordreseddel-nr',
        'oppdragsgiver': 'mobile-oppdragsgiver',
        'kundens-ref': 'mobile-kundens-ref',
        'fakturaadresse': 'mobile-fakturaadresse',
        'dato': 'mobile-dato',
        'prosjektnr': 'mobile-prosjektnr',
        'prosjektnavn': 'mobile-prosjektnavn',
        'montor': 'mobile-montor',
        'avdeling': 'mobile-avdeling',
        'sted': 'mobile-sted',
        'signering-dato': 'mobile-signering-dato',
        'kundens-underskrift': 'mobile-kundens-underskrift'
    };

    for (const [originalId, mobileId] of Object.entries(fieldMap)) {
        const originalEl = document.getElementById(originalId);
        const mobileEl = document.getElementById(mobileId);
        if (originalEl && mobileEl) {
            mobileEl.value = originalEl.value;
        }
    }

    // Load or clear signature preview
    const signatureData = document.getElementById('mobile-kundens-underskrift').value;
    if (signatureData && signatureData.startsWith('data:image')) {
        loadSignaturePreview(signatureData);
    } else {
        clearSignaturePreview();
    }

}



function getFormData() {
    if (isMobile()) {
        syncMobileToOriginal();
    }

    return {
        ordreseddelNr: document.getElementById('ordreseddel-nr').value,
        oppdragsgiver: document.getElementById('oppdragsgiver').value,
        kundensRef: document.getElementById('kundens-ref').value,
        fakturaadresse: document.getElementById('fakturaadresse').value,
        dato: document.getElementById('dato').value,
        prosjektnr: document.getElementById('prosjektnr').value,
        prosjektnavn: document.getElementById('prosjektnavn').value,
        montor: document.getElementById('montor').value,
        avdeling: document.getElementById('avdeling').value,
        orders: getOrdersData(),
        sted: document.getElementById('sted').value,
        signeringDato: document.getElementById('signering-dato').value,
        kundensUnderskrift: document.getElementById('kundens-underskrift').value,
        signaturePaths: signaturePaths,
        canvasAspectRatio: canvasAspectRatio || null,
        savedAt: new Date().toISOString()
    };
}

function setFormData(data) {
    // Fasit-synk: prosjektet i Innstillinger eier skrivemåten på prosjektfeltene.
    if (typeof syncOneFormWithProjects === 'function') data = syncOneFormWithProjects(data, 'full');

    // Helper for safe value setting
    function setVal(id, val) {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    }

    // Set simple fields
    setVal('ordreseddel-nr', data.ordreseddelNr);
    setVal('oppdragsgiver', data.oppdragsgiver);
    setVal('kundens-ref', data.kundensRef);
    setVal('fakturaadresse', data.fakturaadresse);
    setVal('dato', data.dato);
    setVal('prosjektnr', data.prosjektnr);
    setVal('prosjektnavn', data.prosjektnavn);
    setVal('montor', stripEtternavn(data.montor));
    setVal('avdeling', data.avdeling);
    setVal('sted', data.sted);
    setVal('signering-dato', data.signeringDato);
    setVal('kundens-underskrift', data.kundensUnderskrift);

    // Restore signature stroke data (for re-editing)
    signaturePaths = data.signaturePaths || [];
    signaturePathsBackup = JSON.parse(JSON.stringify(signaturePaths));
    if (data.canvasAspectRatio) canvasAspectRatio = data.canvasAspectRatio;

    syncOriginalToMobile();
    updateFakturaadresseDisplay('fakturaadresse-display-text', data.fakturaadresse || '');

    // Convert old formats to orders
    let orders = data.orders;

    if (!orders) {
        if (data.workDescription || data.materials || data.timers) {
            // Previous flat format → 1 order
            orders = [{
                description: data.workDescription || '',
                materials: data.materials || [],
                timer: (data.timers && data.timers[0]) || ''
            }];
        } else if (data.workLines) {
            // Oldest workLines format → 1 order
            const descriptions = [];
            const materials = [];
            data.workLines.forEach(wl => {
                if (wl.description) descriptions.push(wl.description);
                if (wl.material || wl.antall || wl.enhet) {
                    materials.push({ name: wl.material || '', antall: wl.antall || '', enhet: wl.enhet || '' });
                }
            });
            orders = [{
                description: descriptions.join('\n'),
                materials: materials,
                timer: ''
            }];
        }
    }

    // Render order cards
    const container = document.getElementById('mobile-orders');
    container.innerHTML = '';
    const ordersList = orders && orders.length > 0 ? orders : [{ description: '', materials: [], timer: '' }];
    ordersList.forEach((order, idx) => {
        // Alle bestillinger ekspandert ved åpning av lagret skjema — innholdet
        // skal være synlig for gjennomgang uten å måtte tappe hver seksjon.
        const card = createOrderCard(order, true);
        container.appendChild(card);
    });
    container.querySelectorAll('.mobile-order-desc').forEach(ta => {
        if (ta.offsetHeight > 0) autoResizeTextarea(ta);
    });
    // Re-measure after browser has completed first paint (fixes initial load timing)
    requestAnimationFrame(function() {
        container.querySelectorAll('.mobile-order-desc').forEach(ta => {
            if (ta.offsetHeight > 0) autoResizeTextarea(ta);
        });
    });
    renumberOrders();
    updateOrderDeleteStates();
    // Uke-feltet eier ikke timene. Er bøttene merket med andre uker enn skjemaets
    // (uken ble rettet før denne mekanismen fantes), flyttes de på plass nå — da
    // viser kortet og Arbeidstid-popupen timene med én gang.
    realignAllOrderTimerWeeks();
}

// Validering av påkrevde felter (konfigurerbar via innstillinger)
function validateRequiredFields() {
    const settings = cachedRequiredSettings || getDefaultRequiredSettings();
    const saveReqs = settings.save || {};

    const fieldMap = {
        ordreseddelNr:  { id: 'mobile-ordreseddel-nr', key: 'validation_ordreseddel_nr' },
        dato:           { id: 'mobile-dato',           key: 'validation_dato' },
        oppdragsgiver:  { id: 'mobile-oppdragsgiver',  key: 'validation_oppdragsgiver' },
        kundensRef:     { id: 'mobile-kundens-ref',    key: 'validation_kundens_ref' },
        fakturaadresse: { id: 'mobile-fakturaadresse',  key: 'validation_fakturaadresse' },
        prosjektnr:     { id: 'mobile-prosjektnr',     key: 'validation_prosjektnr' },
        prosjektnavn:   { id: 'mobile-prosjektnavn',   key: 'validation_prosjektnavn' },
        montor:         { id: 'mobile-montor',          key: 'validation_montor' },
        avdeling:       { id: 'mobile-avdeling',        key: 'validation_avdeling' },
        sted:           { id: 'mobile-sted',            key: 'validation_sted' },
        signeringDato:  { id: 'mobile-signering-dato',  key: 'validation_signering_dato' }
    };

    for (const [settingKey, fieldInfo] of Object.entries(fieldMap)) {
        if (!saveReqs[settingKey]) continue;
        const el = document.getElementById(fieldInfo.id);
        if (!el || !el.value.trim()) {
            showNotificationModal(t('required_field', t(fieldInfo.key)));
            return false;
        }
    }

    // Validate orders (beskrivelse)
    if (saveReqs.beskrivelse !== false) {
        const orderCards = document.querySelectorAll('#mobile-orders .mobile-order-card');
        if (orderCards.length === 0) {
            showNotificationModal(t('required_order'));
            return false;
        }
        for (let i = 0; i < orderCards.length; i++) {
            const descInput = orderCards[i].querySelector('.mobile-order-desc');
            const descVal = descInput.value;
            if (!descVal.trim()) {
                showNotificationModal(t('required_description', i + 1));
                return false;
            }
        }
    }

    // Validate dager (Arbeidstid) — krever at hver bestilling har minst ÉN
    // dag med både timer OG etasje (eller "Annet"-timer). Per-dag-paret er
    // også sjekket av modal-OK, men her validerer vi at det er angitt INNHOLD
    // i det hele tatt. Skip-flagg overstyrer.
    if (saveReqs.dager) {
        const orderCards = document.querySelectorAll('#mobile-orders .mobile-order-card');
        const dagOrder = ['ma','ti','on','to','fr','lo','so'];
        for (let i = 0; i < orderCards.length; i++) {
            const card = orderCards[i];
            if (card.getAttribute('data-skip-dager') === 'true') continue;
            const cardTimer = JSON.parse(card.getAttribute('data-timer') || '{}');
            const cardFloors = (typeof _getCardPlans === 'function') ? _getCardPlans(card) : [];
            // Bestillingen må ha minst ÉN dag med timer (inkl. "Annet").
            var anyWeekdayHours = dagOrder.some(function(d) {
                return !!(cardTimer[d] && String(cardTimer[d]).trim());
            });
            var genVal = cardTimer._generelt || cardTimer._total;
            if (!anyWeekdayHours && !genVal) {
                showNotificationModal(t('required_field', t('order_days')) + ' (' + t('settings_req_beskrivelse') + ' ' + (i + 1) + ')');
                return false;
            }
            // Er det ført timer på en ukedag, må bestillingen ha minst én etasje
            // (etasje er nå bestilling-nivå, ikke per dag).
            if (anyWeekdayHours && !cardFloors.length) {
                showNotificationModal(t('validation_etasje_required') + ' (' + t('settings_req_beskrivelse') + ' ' + (i + 1) + ')');
                return false;
            }
        }
    }

    // Validate merknad
    if (saveReqs.merknad) {
        const orderCards = document.querySelectorAll('#mobile-orders .mobile-order-card');
        for (let i = 0; i < orderCards.length; i++) {
            const merknadInput = orderCards[i].querySelector('.mobile-order-merknad');
            if (!merknadInput || !merknadInput.value.trim()) {
                showNotificationModal(t('required_field', t('order_merknad')) + ' (' + t('settings_req_beskrivelse') + ' ' + (i + 1) + ')');
                return false;
            }
        }
    }

    // Validate materialer. Hopp over bestillinger der brukeren eksplisitt
    // har markert "Ingen materialer for denne bestillingen" (data-skip-materier).
    if (saveReqs.materialer) {
        const orderCards = document.querySelectorAll('#mobile-orders .mobile-order-card');
        for (let i = 0; i < orderCards.length; i++) {
            if (orderCards[i].getAttribute('data-skip-materier') === 'true') continue;
            const matContainer = orderCards[i].querySelector('.mobile-order-materials');
            const mats = matContainer ? matContainer.querySelectorAll('.mobile-material-row') : [];
            if (mats.length === 0) {
                showNotificationModal(t('required_field', t('order_materials_label')) + ' (' + t('settings_req_beskrivelse') + ' ' + (i + 1) + ')');
                return false;
            }
        }
    }

    // Validate signature
    if (saveReqs.signatur) {
        const sigVal = document.getElementById('mobile-kundens-underskrift').value;
        if (!sigVal || !sigVal.trim()) {
            showNotificationModal(t('required_field', t('validation_signatur')));
            return false;
        }
    }

    return true;
}

function validateServiceRequiredFields() {
    var req = cachedRequiredSettings ? cachedRequiredSettings.service : getDefaultRequiredSettings().service;

    // Montør
    if (req.montor !== false) {
        var montor = document.getElementById('service-montor');
        if (!montor || !montor.value.trim()) {
            showNotificationModal(t('required_field', t('validation_montor')));
            return false;
        }
    }

    // Each entry card fields
    var cards = document.querySelectorAll('#service-entries .service-entry-card');
    for (var i = 0; i < cards.length; i++) {
        if (req.dato !== false) {
            var dato = cards[i].querySelector('.service-entry-dato');
            if (!dato || !dato.value.trim()) {
                showNotificationModal(t('required_field', t('label_dato')) + ' (' + t('service_entry_title') + ' ' + (i + 1) + ')');
                return false;
            }
        }
        // Validate date format if filled
        var datoEl = cards[i].querySelector('.service-entry-dato');
        if (datoEl && datoEl.value.trim() && !parseDateDMY(datoEl.value.trim())) {
            datoEl.classList.add('date-invalid');
            showNotificationModal('Ugyldig datoformat. Bruk DD.MM.ÅÅÅÅ (' + t('service_entry_title') + ' ' + (i + 1) + ')');
            return false;
        }
        if (req.prosjektnr !== false) {
            var pnr = cards[i].querySelector('.service-entry-prosjektnr');
            if (!pnr || !pnr.value.trim()) {
                showNotificationModal(t('required_field', t('label_prosjektnr')) + ' (' + t('service_entry_title') + ' ' + (i + 1) + ')');
                return false;
            }
        }
        if (req.prosjektnavn !== false) {
            var pnavn = cards[i].querySelector('.service-entry-prosjektnavn');
            if (!pnavn || !pnavn.value.trim()) {
                showNotificationModal(t('required_field', t('label_prosjektnavn')) + ' (' + t('service_entry_title') + ' ' + (i + 1) + ')');
                return false;
            }
        }
        // Materialer-validering hopper over service-entries der brukeren har
        // markert "Ingen materialer" eksplisitt.
        if (req.materialer !== false && cards[i].getAttribute('data-skip-materier') !== 'true') {
            var matContainer = cards[i].querySelector('.mobile-order-materials');
            var matItems = matContainer ? matContainer.querySelectorAll('.mobile-material-row') : [];
            if (matItems.length === 0) {
                showNotificationModal(t('required_field', t('order_materials_label')) + ' (' + t('service_entry_title') + ' ' + (i + 1) + ')');
                return false;
            }
        }
    }

    // Signature
    if (req.signatur) {
        var sigInput = document.getElementById('service-signatur');
        if (!sigInput || !sigInput.value) {
            showNotificationModal(t('required_field', t('validation_signatur')));
            return false;
        }
    }

    return true;
}

function _clearSentStateAfterSave() {
    if (sessionStorage.getItem('firesafe_current_sent') === '1') {
        sessionStorage.removeItem('firesafe_current_sent');
        sessionStorage.removeItem('firesafe_current_status');
        document.getElementById('sent-banner').style.display = 'none';
        if (window._updateFormStatusButtons) window._updateFormStatusButtons();
    }
}

async function saveForm() {
    if (!validateRequiredFields()) return;

    // Validate order number against registered ranges (use cache for instant validation)
    const orderNr = document.getElementById('mobile-ordreseddel-nr').value.trim();
    const orderSettings = typeof _getCachedOrderNrSettings === 'function' ? _getCachedOrderNrSettings() : await getOrderNrSettings();
    const ranges = (orderSettings && orderSettings.ranges) ? orderSettings.ranges : [];

    const saveBtn = document.getElementById('header-save-btn');
    if (saveBtn && saveBtn.disabled) return;
    if (saveBtn) saveBtn.disabled = true;

    // Helper: oppdater signering-dato til dagens ved sendt → utkast-konvertering.
    // Brukes inne i confirm-callback så datoen KUN endres hvis brukeren bekrefter.
    function _applySentToSavedDate(dataObj) {
        _setSigneringDatoToday();
        if (dataObj) dataObj.signeringDato = formatDate(new Date());
    }

    try {
        const data = getFormData();

        const formsCollection = 'forms';
        const archiveCollection = 'archive';

        // Always use localStorage first (optimistic)
        const saved = safeParseJSON(STORAGE_KEY, []);
        const archived = safeParseJSON(ARCHIVE_KEY, []);

        // Sjekk sendte for duplikater
        var archivedIdx = archived.findIndex(function(item) { return item.ordreseddelNr === data.ordreseddelNr; });
        if (archivedIdx !== -1) {
            if (sessionStorage.getItem('firesafe_current_sent') === '1') {
                // Bevar ID fra arkivert skjema slik at det oppdateres, ikke dupliseres
                data.id = archived[archivedIdx].id;
                // Arkiv-fjerning skjer i confirm-callback nedenfor, ikke her
            } else {
                showNotificationModal(t('duplicate_in_sent', data.ordreseddelNr));
                return;
            }
        }

        const existingIndex = saved.findIndex(item =>
            item.ordreseddelNr === data.ordreseddelNr
        );

        if (existingIndex !== -1) {
            var isSent = sessionStorage.getItem('firesafe_current_sent') === '1';
            var doUpdate = function() {
                // Ved sendt → utkast-konvertering: oppdater dato til dagens (kun etter bekreft)
                if (isSent) _applySentToSavedDate(data);
                // Fjern fra arkiv først (hvis sendt skjema)
                if (archivedIdx !== -1) {
                    var freshArchived = safeParseJSON(ARCHIVE_KEY, []);
                    var idx = freshArchived.findIndex(function(item) { return item.ordreseddelNr === data.ordreseddelNr; });
                    if (idx !== -1) {
                        freshArchived.splice(idx, 1);
                        safeSetItem(ARCHIVE_KEY, JSON.stringify(freshArchived));
                    }
                }
                data.id = saved[existingIndex].id;
                saved[existingIndex] = data;
                safeSetItem(STORAGE_KEY, JSON.stringify(saved));
                addToOrderNumberIndex(data.ordreseddelNr);
                loadedForms = [];
                lastSavedData = getFormDataSnapshot();
                var wasSent = isSent;
                _clearSentStateAfterSave();
                _lastLocalSaveTs = Date.now();
                showNotificationModal(t(wasSent ? 'update_success' : 'save_success'), true);
                // Navigér til lagrede-listen uansett, slik at sendt → utkast-flyten ender
                // på samme sted som vanlig lagring (i stedet for å bli stående på skjemaet).
                showSavedForms();

                if (archivedIdx !== -1) {
                    enqueueUserDocMove(formsCollection, archiveCollection, data.id, data, 'Firestore save');
                } else {
                    enqueueUserDocSet(formsCollection, data.id, data, 'Firestore save');
                }
            };
            if (isSent) {
                // Sendt → utkast-konvertering er en state-endring som fortjener bekreftelse.
                showConfirmModal(t('confirm_move_to_saved'), doUpdate, t('btn_update'), '#E8501A');
            } else {
                // Vanlig oppdatering av eksisterende skjema: ingen bekreftelse — lagre direkte.
                doUpdate();
            }
        } else {
            // Save new form directly (no confirmation needed)
            // Ved sendt → utkast-konvertering: oppdater dato til dagens
            if (sessionStorage.getItem('firesafe_current_sent') === '1') {
                _applySentToSavedDate(data);
            }
            // Fjern fra arkiv først (hvis sendt skjema)
            if (archivedIdx !== -1) {
                var freshArchived2 = safeParseJSON(ARCHIVE_KEY, []);
                var idx2 = freshArchived2.findIndex(function(item) { return item.ordreseddelNr === data.ordreseddelNr; });
                if (idx2 !== -1) {
                    freshArchived2.splice(idx2, 1);
                    safeSetItem(ARCHIVE_KEY, JSON.stringify(freshArchived2));
                }
            }
            if (!data.id) data.id = Date.now().toString();
            saved.unshift(data);
            if (saved.length > 50) saved.pop();
            safeSetItem(STORAGE_KEY, JSON.stringify(saved));
            addToOrderNumberIndex(data.ordreseddelNr);
            loadedForms = [];
            lastSavedData = getFormDataSnapshot();
            var wasSent2 = sessionStorage.getItem('firesafe_current_sent') === '1';
            _clearSentStateAfterSave();
            _lastLocalSaveTs = Date.now();
            showNotificationModal(t('save_success'), true);
            if (!wasSent2) showSavedForms();

            if (archivedIdx !== -1) {
                enqueueUserDocMove(formsCollection, archiveCollection, data.id, data, 'Firestore save');
            } else {
                enqueueUserDocSet(formsCollection, data.id, data, 'Firestore save');
            }
        }
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

