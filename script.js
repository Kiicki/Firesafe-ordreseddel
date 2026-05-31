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
const MIN_INFO_KEY = 'firesafe_min_info';
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

// Strip eventuell etternavn fra en montør-streng. Etternavn er placeholder for fremtiden
// og skal aldri vises i UI eller eksport. Bruk denne overalt der montør hentes/settes.
function stripEtternavn(montorVal) {
    if (!montorVal) return '';
    return String(montorVal).trim().split(/\s+/)[0] || '';
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
    return String(name || '').replace(/__(\d+|meter)$/i, '');
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
    // Enhet (stk/eske) vises allerede i antall-kolonnen → ikke dupliser i navnet.
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
    if (hasKappeProducts || hasFasteners) {
        derived.push({
            name: MATERIAL_KAPPE_LAUNCHER,
            displayName: getMaterialKappeLabel(),
            type: 'kappe-isolation',
            defaultUnit: '',
            allowedUnits: [],
            quantityUnit: 'meter',
            source: 'kappe-materials-launcher'
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

function getMaterialQuantityUnit(materialName, enhet, source) {
    if (source && source.indexOf('unit:') === 0) return source.substring(5);
    var enhetLower = (enhet || '').toLowerCase();
    if (enhetLower === 'meter' || enhetLower === 'løpende' || enhetLower === 'lm') return 'meter';
    var productDefault = getKappeProductDefaultUnit(materialName);
    if (productDefault) return productDefault;
    if (source === 'kappe-products') return 'meter';
    var config = getMaterialPickerConfig(materialName);
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
function getSpecSortKey(name) {
    var s = name || '';
    if (/__meter$/i.test(s)) return [Number.MAX_SAFE_INTEGER, 0, 1];
    var diaMatch = s.match(/[øØ](\d+)/);
    var dia = diaMatch ? parseInt(diaMatch[1], 10) : 0;
    // Sekundær nøkkel: lag-tall ("2 lag" eller "r2") eller høyde for kabelhylse ("Ø50x250mm")
    var heightMatch = s.match(/[øØ]\d+x(\d+)mm/i);
    if (heightMatch) return [dia, parseInt(heightMatch[1], 10), 0];
    var lagMatch = s.match(/(\d+)\s*lag\b/i) || s.match(/r(\d+)\s*$/i);
    var lag = lagMatch ? parseInt(lagMatch[1], 10) : 0;
    return [dia, lag, 0];
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
                    var ka = getSpecSortKey(a.name);
                    var kb = getSpecSortKey(b.name);
                    if (ka[2] !== kb[2]) return ka[2] - kb[2];
                    if (ka[0] !== kb[0]) return ka[0] - kb[0];
                    return ka[1] - kb[1];
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
    // Direct meter entry under spec-base → label as "Løpende"
    if (m.enhet === 'meter' && name.toLowerCase() === baseName.toLowerCase()) {
        // Bevisst uten "meter"-suffiks her: enhet-kolonnen i tabell-visningene
        // (ordrekort-summary, eksport-skjema) viser allerede "meter", s\u00e5 dobbel
        // ville v\u00e6rt redundant. Picker-UI (uten enhet-kolonne) bruker sin egen
        // "L\u00f8pende meter"-streng p\u00e5 linje ~2750.
        return 'l\u00f8pende';
    }
    // For spec-derived materials, strip the base name prefix to show just the spec
    if (name.toLowerCase().startsWith(baseName.toLowerCase() + ' ')) {
        return name.substring(baseName.length + 1);
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
             LEVERINGSADRESSE_KEY, MIN_INFO_KEY,
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
                // Sync min_info, leveringsadresser, plate_size (autofyll-data — må være tilgjengelig før bruker åpner skjema)
                db.collection('users').doc(user.uid).collection('settings').doc('min_info').get()
                    .then(function(d) { if (d.exists) safeSetItem(MIN_INFO_KEY, JSON.stringify(d.data())); }).catch(function() {}),
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

    // Add "Uke " prefix to dato input for eksport-visning (input lagres som kun nummer)
    const datoInput = document.getElementById('dato');
    if (datoInput && datoInput.value && !/^uke\s/i.test(datoInput.value)) {
        const originalValue = datoInput.value;
        datoInput.value = 'Uke ' + originalValue;
        convertedElements.push({ datoInput: datoInput, originalValue: originalValue });
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

function copyOrderNumber() {
    const nr = document.getElementById('mobile-ordreseddel-nr').value;
    if (!nr) return;
    navigator.clipboard.writeText(nr).then(() => {
        showNotificationModal(t('copied_to_clipboard'), true);
    }).catch(() => {
        // Fallback for older browsers
        const input = document.getElementById('mobile-ordreseddel-nr');
        input.select();
        document.execCommand('copy');
        showNotificationModal(t('copied_to_clipboard'), true);
    });
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
                <label data-i18n="order_days">${t('order_days')}</label>
                <button type="button" class="mobile-arbeidstid-btn" onclick="openDagTimerModal(this)">+ ${t('order_days')}</button>
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
function getRunningMeterInfo(matName) {
    if (!matName) return null;
    var allMats = cachedMaterialOptions || [];
    for (var i = 0; i < allMats.length; i++) {
        var m = allMats[i];
        if ((m.type === 'mansjett' || m.type === 'brannpakning') && matName.toLowerCase().startsWith(m.name.toLowerCase() + ' ')) {
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
    if (m.plate && (m.plate.length || m.plate.width)) {
        div.setAttribute('data-mat-plate-length', m.plate.length || '');
        div.setAttribute('data-mat-plate-width', m.plate.width || '');
    }
    if (m.lmPerSide) div.setAttribute('data-mat-lm-per-side', m.lmPerSide);
    if (m.antallObjekter) div.setAttribute('data-mat-antall-objekter', m.antallObjekter);
    if (m.sider) div.setAttribute('data-mat-sider', m.sider);
    if (m.kappeOrient) div.setAttribute('data-mat-kappe-orient', m.kappeOrient);
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
        // Append variant to name if enhet is not stk/meter (it's a variant like "patron")
        var enhetVal = normalizeVariant(m.name, m.enhet || '').toLowerCase();
        if (enhetVal && enhetVal !== 'stk' && enhetVal !== 'meter') {
            nameFormatted += ' ' + enhetVal;
        }
        // Spec-suffix for isolasjon: bredde-modus → "×160mm" (uten spaces, konsistent med
        // FSC/FSW/Kabelhylse), plate-modus → "(plate)".
        if (m.bredde) {
            nameFormatted += '×' + String(m.bredde).replace(/mm$/i, '') + 'mm';
        } else if (m.specMode === 'plate') {
            nameFormatted += ' (plate)';
        }
        // Eske-suffix for festemiddel (samme mønster som bredde-suffix for isolasjon).
        if (m.quantityUnit === 'eske' && (m.source === 'kappe-stift' || m.source === 'kappe-fastener')) {
            nameFormatted += ' (eske)';
        }
    }
    const pipeInfo = getRunningMeterInfo(m.name);
    const pipesNum = m.antall ? parseFloat(m.antall.replace(',', '.')) : NaN;
    const hasPipeMeter = pipeInfo && !isNaN(pipesNum) && pipesNum > 0;
    if (hasPipeMeter) {
        var lagMatch = nameFormatted.match(/^(.+?) \((\d+) lag\)$/);
        var baseSpec = lagMatch ? lagMatch[1] : nameFormatted;
        var rounds = lagMatch ? parseInt(lagMatch[2], 10) : 1;
        if (rounds > 1) {
            nameFormatted = baseSpec + ' (' + m.antall + ' stk \u00d7 ' + rounds + ' lag)';
        } else {
            nameFormatted = baseSpec + ' (' + m.antall + ' stk)';
        }
    }
    nameFormatted = formatDisplayForBreak(nameFormatted);
    const nameText = nameFormatted ? escapeHtml(nameFormatted) : (groupBaseName ? '' : t('placeholder_material'));
    const detailParts = [];
    if (hasPipeMeter) {
        var lm = calculateRunningMeters(pipeInfo, pipesNum);
        detailParts.push(formatRunningMeters(lm) + ' meter');
    } else if (pipeInfo && m.antall) {
        detailParts.push(escapeHtml(m.antall) + ' stk');
    } else if (m.source === 'kappe-products') {
        // Kappe-isolasjon i ordreseddel-faktura: vis materialforbruk i m² (= lik eksporten).
        // m² = antall plater × plate-areal; plate-antallet beholdes på kappeskjemaet der montøren kapper.
        // Pre-aggregert rad (samme produkt+tykkelse slått sammen): bruk summen.
        var kappePlateCount = (m.__plateSum != null) ? m.__plateSum : calcKappePlateCount(m);
        if (kappePlateCount > 0) {
            var kappeM2 = (typeof calcKappeAreaM2 === 'function') ? calcKappeAreaM2(m, kappePlateCount) : 0;
            detailParts.push(((typeof formatKappeArea === 'function') ? formatKappeArea(kappeM2) : String(kappeM2)) + ' m²');
        } else if (m.antall) {
            // Fallback hvis bredde/plate-info mangler: fall tilbake til antall + enhet
            var qUnit = m.quantityUnit || getMaterialQuantityUnit(m.name, m.enhet, m.source);
            var uLabel = qUnit === 'meter' ? ' meter' : ' ' + qUnit;
            detailParts.push(formatRunningMeters(m.antall) + uLabel);
        }
    } else {
        if (m.antall) {
            var quantityUnit = m.quantityUnit || getMaterialQuantityUnit(m.name, m.enhet, m.source);
            var unitLabel = quantityUnit === 'meter' ? ' meter' : ' ' + quantityUnit;
            detailParts.push(formatRunningMeters(m.antall) + unitLabel);
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
        if (cachedMaterialOptions && m.enhet !== 'meter') {
            var specBase = cachedMaterialOptions.find(function(o) {
                return o.name.toLowerCase() === (m.name || '').toLowerCase() && (o.type === 'mansjett' || o.type === 'brannpakning' || o.type === 'kabelhylse');
            });
            if (specBase) return false;
        }
        return true;
    });
    // Group by base material name
    var groups = groupMaterialsByBase(filtered);
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
        const plateLength = row.getAttribute('data-mat-plate-length') || '';
        const plateWidth = row.getAttribute('data-mat-plate-width') || '';
        const lmPerSide = row.getAttribute('data-mat-lm-per-side') || '';
        const antallObjekter = row.getAttribute('data-mat-antall-objekter') || '';
        const sider = row.getAttribute('data-mat-sider') || '';
        const kappeOrient = row.getAttribute('data-mat-kappe-orient') || '';
        if (name || antall || enhet) {
            var mat = { name, antall, enhet };
            if (source) mat.source = source;
            if (quantityUnit) mat.quantityUnit = quantityUnit;
            if (bredde) mat.bredde = bredde;
            if (specMode) mat.specMode = specMode;
            if (plateLength || plateWidth) mat.plate = { length: plateLength, width: plateWidth };
            if (lmPerSide) mat.lmPerSide = lmPerSide;
            if (antallObjekter) mat.antallObjekter = antallObjekter;
            if (sider) mat.sider = sider;
            if (kappeOrient) mat.kappeOrient = kappeOrient;
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
            isDuplicate: !!meterMatch[2],
            duplicateIndex: meterMatch[2] ? parseInt(meterMatch[2], 10) : 1
        };
    }
    var dupMatch = raw.match(/^(.+)__(\d+)$/);
    if (dupMatch) {
        return {
            baseName: dupMatch[1],
            realName: dupMatch[1],
            isMeterEntry: false,
            isDuplicate: true,
            duplicateIndex: parseInt(dupMatch[2], 10)
        };
    }
    return {
        baseName: raw,
        realName: raw,
        isMeterEntry: false,
        isDuplicate: false,
        duplicateIndex: 1
    };
}

function openMaterialPicker(btn, onConfirm) {
    // If material cache is empty and user is logged in, fetch from Firebase first
    if ((!cachedMaterialOptions || cachedMaterialOptions.length === 0) && currentUser && db && typeof getDropdownOptions === 'function') {
        const modal = document.getElementById('picker-overlay');
        const list = document.getElementById('picker-overlay-list');
        list.innerHTML = '<div style="padding:16px;color:#999;text-align:center">' + t('loading') + '</div>';
        if (!window._pickerSavedScroll) window._pickerSavedScroll = _saveScrollPositions();
        modal.classList.add('active');
        document.body.classList.add('picker-active');
        getDropdownOptions().then(function() {
            modal.classList.remove('active');
            document.body.classList.remove('picker-active');
            // Behold _pickerSavedScroll — re-åpning gjenbruker scroll-posisjonen
            openMaterialPicker(btn, onConfirm);
        });
        return;
    }
    pickerConfirmCallback = onConfirm || null;
    const card = btn ? (btn.closest('.mobile-order-card') || btn.closest('.service-entry-card')) : null;
    pickerOrderCard = card;
    const matContainer = card ? card.querySelector('.mobile-order-materials') : null;
    const existing = matContainer ? getMaterialsFromContainer(matContainer) : [];

    const allMaterials = getMaterialPickerOptions(cachedMaterialOptions || []);

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
            // Skip spec-base materials (e.g. "FSC" when type is mansjett/brannpakning/kabelhylse), but not direct meter entries
            if (m.enhet !== 'meter' && isSpecBaseMat) return;
            // Direct meter entry on a spec-base → use __meter suffix so it's treated as a meter entry in the picker
            var storageKey = (m.enhet === 'meter' && isSpecBaseMat) ? m.name + '__meter' : m.name;
            // If this name already exists in pickerState, use __N suffix for duplicates
            var materialState = { checked: true, antall: m.antall || '', enhet: m.enhet || '' };
            if (m.source) materialState.source = m.source;
            if (m.quantityUnit) materialState.quantityUnit = m.quantityUnit;
            if (m.bredde) materialState.bredde = m.bredde;
            if (m.specMode) materialState.specMode = m.specMode;
            if (m.plate && (m.plate.length || m.plate.width)) materialState.plate = m.plate;
            if (m.lmPerSide) materialState.lmPerSide = m.lmPerSide;
            if (m.antallObjekter) materialState.antallObjekter = m.antallObjekter;
            if (m.sider) materialState.sider = m.sider;
            if (m.kappeOrient) materialState.kappeOrient = m.kappeOrient;
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
        // Klassifiser enhet:
        //  - meter/løpende: vises som liten "m"-badge ved siden av navn
        //  - stk eller tom: ingen ekstra visning (default)
        //  - alt annet (Patron, Pølse, etc.): er en variant — append'es til navn
        const isMeterEnhet = enhetLower === 'meter' || enhetLower === 'løpende' || enhetLower === 'lm';
        const isVariantEnhet = !!enhetLower && enhetLower !== 'stk' && !isMeterEnhet;
        const activeQuantityUnit = quantityUnit || getMaterialQuantityUnit(name, enhet, source);
        const isMeterQuantity = activeQuantityUnit === 'meter';
        // Bygg visningsnavn: append variant hvis material har variant valgt
        const displayName = (hasVariants && isVariantEnhet)
            ? baseDisplay + ' ' + (enhet || '')
            : baseDisplay;
        // Enhets-pill etter navnet for konsistens på alle rader. Spec-launchere
        // (ikke valgt enda) får ingen pill — de er placeholder for popup.
        let unitPillText = '';
        if (!isSpecLauncher && !isIsolationLauncher) {
            if (source === 'kappe-products') {
                unitPillText = isMeterQuantity ? 'meter' : 'plate';
            } else if (source === 'kappe-stift' || source === 'kappe-fastener') {
                unitPillText = enhetLower === 'eske' ? 'eske' : 'stk';
            } else if (isMeterQuantity) {
                unitPillText = 'meter';
            } else {
                // Inkluderer variants (Patron, Pølse, etc.) — de er stk-baserte
                unitPillText = 'stk';
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
                variantBadge = '<span class="picker-mat-variant-count" title="' + _vc + ' ' + (_vc === 1 ? 'variant' : 'varianter') + '">' + _vc + '</span>';
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
                kappeOrient: selection.kappeOrient || ''
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
                    antall: st.antall || ''
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
                    kappeOrient: st.kappeOrient || ''
                });
            }
        });
        return { entries: entries, keys: keys };
    }
    function _kappeMaterialEntryCount() {
        return _gatherKappeMaterialEntries().entries.length;
    }

    // Åpne iso-popupen forhåndsfylt med ALLE tidligere valg. "Velg" erstatter
    // hele iso/festemiddel-settet (sletter gamle nøkler først).
    function _openIsoMaterialPopup() {
        var g = _gatherKappeMaterialEntries();
        var replaced = false;
        openIsoCardPopup(function(selection) {
            if (!replaced) {
                g.keys.forEach(function(k) { delete pickerState[k]; });
                replaced = true;
            }
            addKappeMaterialSelection(selection);
            renderPickerList();
        }, g.entries.length ? { entries: g.entries } : undefined);
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
        // Build list: configured materials + checked spec-derived entries + checked custom entries
        const entries = [];

        // Add all configured materials
        allMaterials.forEach(matObj => {
            var matType = matObj.type || 'standard';
            if (matType === 'kappe-stift') {
                // Festemiddel håndteres nå inni "Isolering"-popupen — egen
                // Stift-launcher skjules (kun én "Isolering"-rad).
                return;
            }
            if (matType === 'kappe-isolation') {
                // Kun ÉN "Isolering"-launcher. Markeres aktiv + viser antall
                // valgte (iso + festemiddel) når den har data. Ingen løse rader.
                var _kCount = _kappeMaterialEntryCount();
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
                    return kLower.startsWith(baseLower + ' ') || kLower === baseLower + '__meter' || kLower.startsWith(baseLower + '__meter__');
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
            } else if (parsedEntryKey.isMeterEntry) {
                baseName = parsedEntryKey.baseName;
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
            if (group.isIsolationGroup) {
                var _isoData = (typeof _gatherKappeMaterialEntries === 'function') ? _gatherKappeMaterialEntries() : { entries: [], keys: [] };
                if (_isoData.entries.length) {
                    html += '<div class="picker-mat-group-header" data-mat-name="' + escapeHtml(group.baseName) + '" data-mat-type="kappe-isolation">'
                        + '<span class="picker-mat-name">' + escapeHtml(getMaterialIsolationLabel()) + '</span>'
                        + '<span class="picker-mat-dot picker-mat-dot-isolation"></span></div>';
                    var _isoDupIcon = duplicateIcon.replace('width="24"', 'width="18"').replace('height="24"', 'height="18"');
                    var _isoDelIcon = deleteIcon.replace('width="24"', 'width="18"').replace('height="24"', 'height="18"');
                    _isoData.entries.forEach(function(e, _i) {
                        var _key = _isoData.keys[_i];
                        var _isStift = isKappeStiftMaterial(e.name, e.source, e.enhet);
                        var _lbl, _pill = '', _val = '';
                        if (_isStift) {
                            // Festemiddel: navn + enhet-merke (eske/stk); REDIGERBART antall som spec-rader.
                            _lbl = formatKappeStiftName(e.enhet, e.name, e.specMode);
                            _pill = (e.specMode === 'eske' || e.quantityUnit === 'eske') ? t('kappe_unit_eske') : t('kappe_unit_stk');
                        } else {
                            // Isolasjon (eneste unntak): navn + kapp-bredde/plate-merke; m² KUN VISNING
                            // (= antall plater × plate-areal, inkl. svinn) — redigeres i popupen.
                            _lbl = formatKappeIsolationName(e.name, e.enhet);
                            _pill = (e.specMode === 'plate') ? 'plate' : (e.bredde ? (String(e.bredde).replace(/mm$/i, '') + 'mm') : '');
                            var _pc = (typeof calcKappePlateCount === 'function') ? calcKappePlateCount(e) : 0;
                            var _m2 = (_pc > 0 && typeof calcKappeAreaM2 === 'function') ? calcKappeAreaM2(e, _pc) : 0;
                            _val = _m2 > 0 ? ((typeof formatKappeArea === 'function' ? formatKappeArea(_m2) : _m2) + ' m²') : '';
                        }
                        var _pillHtml = _pill ? '<span class="picker-mat-unit-pill">' + escapeHtml(_pill) + '</span>' : '';
                        var _valCell = _isStift
                            ? '<input type="text" class="picker-mat-antall picker-iso-antall" inputmode="numeric" pattern="[0-9]*" value="' + escapeHtml(e.antall ? String(e.antall) : '') + '" placeholder="Antall">'
                            : '<span class="picker-iso-value">' + escapeHtml(_val) + '</span>';
                        html += '<div class="picker-mat-row picker-mat-grouped picker-mat-selected picker-iso-subrow" data-iso-key="' + escapeHtml(_key || '') + '">'
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
                    } else if (isSpec && nameNoSuffix.toLowerCase().startsWith(group.baseName.toLowerCase() + ' ')) {
                        subDisplay = nameNoSuffix.substring(group.baseName.length + 1);
                    } else if (parsePickerStorageKey(e.name).isMeterEntry) {
                        subDisplay = 'L\u00f8pende meter';
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
            row.addEventListener('click', function() { _openIsoMaterialPopup(); });
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
                    openMaterialKappePicker(function(selection) {
                        var addedKey = addKappeMaterialSelection(selection);
                        renderPickerList();
                        _scrollPickerTargetIntoView(addedKey, { focusAntall: true });
                    }, { name: MATERIAL_STIFT_LAUNCHER, source: 'kappe-stift' });
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
            var isSpecDerived = parsePickerStorageKey(name).isMeterEntry || !!findBaseMaterial(name);

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
        if (specPopupMatType === 'mansjett' || specPopupMatType === 'brannpakning') {
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
        document.getElementById('plan-popup-list').innerHTML = '<div style="padding:16px;color:#999;text-align:center">' + t('loading') + '</div>';
        loadPlanOptions().then(function() { _renderPlanPickerList(displayEl); });
        return;
    }
    _renderPlanPickerList(displayEl);
}

function _renderPlanPickerList(displayEl) {
    var existing = (displayEl.getAttribute('data-plan') || '').split(',').map(s => s.trim()).filter(s => s);
    var options = cachedPlanOptions || [];
    _planPickerState = {};

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
        html = '<div style="padding:16px;color:#999;text-align:center">' + t('settings_no_plans') + '</div>';
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
function _getCardPlans(card) {
    if (!card) return [];
    var dp = _getCardDayPlans(card);
    if (Object.keys(dp).length) return _migrateFromDayPlans(dp);
    var arr = [];
    try { arr = JSON.parse(card.getAttribute('data-plans') || '[]') || []; } catch (e) {}
    return Array.isArray(arr) ? arr : [];
}

// Henter PER-DAG etasje-objekt: { ma: 'U3, U2', ti: 'U1' }. Primær kilde er
// data-day-plans (det er nå hovedformatet). Hvis tomt og kortet har eldre
// bestilling-nivå data-plans → repliker plans-strengen til alle dager med
// timer (auto-migrering ved første lasting).
function _getCardDayPlans(card) {
    if (!card) return {};
    var dp = {};
    try { dp = JSON.parse(card.getAttribute('data-day-plans') || '{}') || {}; } catch (e) {}
    // Sjekk om dp har minst én ikke-tom verdi
    var hasAny = Object.keys(dp).some(function(k) {
        return dp[k] != null && String(dp[k]).trim();
    });
    if (hasAny) return dp;
    // Auto-migrer fra bestilling-nivå data-plans + data-timer: hver dag som
    // har timer arver hele plan-listen som komma-streng.
    var plans = [];
    try { plans = JSON.parse(card.getAttribute('data-plans') || '[]') || []; } catch (e) {}
    if (!Array.isArray(plans) || !plans.length) return {};
    var planStr = plans.join(', ');
    var timer = {};
    try { timer = JSON.parse(card.getAttribute('data-timer') || '{}') || {}; } catch (e) {}
    var out = {};
    ['ma','ti','on','to','fr','lo','so'].forEach(function(d) {
        if (timer[d] && String(timer[d]).trim()) out[d] = planStr;
    });
    return out;
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
    const dayPlans = _getCardDayPlans(card);
    const dagOrder = ['ma','ti','on','to','fr','lo','so'];
    function _formatDayPart(label, hours, plan) {
        var hoursStr = hours ? escapeHtml(String(hours).replace('.', ',')) + 't' : '';
        var inner = '<b class="dt-day">' + escapeHtml(label) + '</b>';
        if (hoursStr) inner += ' ' + hoursStr;
        if (plan) inner += ' <span class="dt-plan">' + escapeHtml(plan) + '</span>';
        return '<span class="dt-part">' + inner + '</span>';
    }
    const parts = dagOrder.filter(d => timer[d] || dayPlans[d]).map(d => {
        return _formatDayPart(dagShortMap[d] || d, timer[d] || '', dayPlans[d] || '');
    });
    var genVal = timer._generelt || timer._total;
    if (genVal) {
        // Annet — kun timer, ingen etasje.
        parts.push(_formatDayPart('Annet', genVal, ''));
    }
    var summary = parts.join('<span class="dt-sep">•</span>');
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

function openDagTimerModal(btn) {
    const card = btn.closest('.mobile-order-card');
    dagTimerActiveCard = card;
    const timer = JSON.parse(card.getAttribute('data-timer') || '{}');
    // Per-dag etasjer: data-day-plans er nå primær. Hvis tomt, faller vi
    // tilbake til bestilling-nivå data-plans og repliker til alle dager som
    // har timer (auto-migrering av eldre data).
    var dayPlans = _getCardDayPlans(card);
    const dagOrder = ['ma','ti','on','to','fr','lo','so'];
    const list = document.getElementById('dag-timer-modal-list');
    list.innerHTML = '';

    // === Dag-rader: timer + per-dag etasje-picker ===
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
        inp.value = timer[dag] || '';
        var inpWrap = document.createElement('div');
        inpWrap.className = 'dag-timer-input-wrap';
        var unit = document.createElement('span');
        unit.className = 'dag-timer-unit';
        unit.textContent = 't';
        inpWrap.appendChild(inp);
        inpWrap.appendChild(unit);
        topRow.appendChild(label);
        topRow.appendChild(inpWrap);
        // Etasje-picker for denne dagen. data-plan persisterer state mellom
        // åpninger av picker; confirmPlanPicker leser/skriver dette attributtet.
        // Picker'ens onclick-handler er gjenbruk av openPlanPicker som allerede
        // har kode-path for klassen 'dag-timer-plan-btn' (linje ~4138).
        var planVal = (dayPlans[dag] || '').trim();
        var planBtn = document.createElement('button');
        planBtn.type = 'button';
        planBtn.className = 'dag-timer-plan-btn' + (planVal ? '' : ' dag-timer-plan-btn--empty');
        planBtn.dataset.dag = dag;
        planBtn.setAttribute('data-plan', planVal);
        planBtn.textContent = planVal ? 'Endre' : '+ Etasje';
        planBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var modal = document.getElementById('dag-timer-modal');
            if (modal) modal.classList.add('dag-timer-modal--hidden');
            openPlanPicker(planBtn);
        });
        topRow.appendChild(planBtn);
        row.appendChild(topRow);
        // Verdier-visning under top-row når etasje(r) er valgt for dagen.
        var planValues = document.createElement('div');
        planValues.className = 'dag-timer-plan-values';
        planValues.dataset.dag = dag;
        planValues.style.display = planVal ? '' : 'none';
        planValues.textContent = planVal;
        planValues.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var modal = document.getElementById('dag-timer-modal');
            if (modal) modal.classList.add('dag-timer-modal--hidden');
            openPlanPicker(planBtn);
        });
        row.appendChild(planValues);
        list.appendChild(row);
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
    genInp.value = timer._generelt || timer._total || '';
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
    list.appendChild(genRow);

    var modal = document.getElementById('dag-timer-modal');
    modal.classList.add('active');
    modal.addEventListener('touchmove', dagTimerBlockScroll, { passive: false });
    modal.addEventListener('wheel', dagTimerBlockScroll, { passive: false });
}

function dagTimerBlockScroll(e) {
    var list = document.getElementById('dag-timer-modal-list');
    // Tillat scroll kun hvis event er inni listen og listen faktisk kan scrolle
    if (list && list.contains(e.target) && list.scrollHeight > list.clientHeight) return;
    e.preventDefault();
}

function closeDagTimerModal(confirmed) {
    var modal = document.getElementById('dag-timer-modal');
    if (!confirmed || !dagTimerActiveCard) {
        modal.classList.remove('active');
        modal.removeEventListener('touchmove', dagTimerBlockScroll);
        modal.removeEventListener('wheel', dagTimerBlockScroll);
        dagTimerActiveCard = null;
        _maybeReturnToTimerOverview();
        return;
    }
    const list = document.getElementById('dag-timer-modal-list');
    const dager = [];
    const timer = {};
    const dayPlans = {};

    // === Per-dag validering: hvis EN av {timer, etasje} er fylt for en dag,
    // må BÅDE være fylt. "Annet" er unntatt (kun timer). ===
    var validationFail = null;
    list.querySelectorAll('.dag-timer-modal-row:not(.dag-timer-total-row)').forEach(function(row) {
        if (validationFail) return;
        var dag = row.dataset.dag;
        var inp = row.querySelector('.dag-timer-modal-input');
        var planBtn = row.querySelector('.dag-timer-plan-btn');
        var timerVal = inp ? inp.value.trim() : '';
        var planVal = planBtn ? (planBtn.getAttribute('data-plan') || '').trim() : '';
        if (timerVal && !planVal) {
            validationFail = { dag: dag, missing: 'etasje' };
        } else if (!timerVal && planVal) {
            validationFail = { dag: dag, missing: 'timer' };
        }
        if (timerVal) { dager.push(dag); timer[dag] = timerVal; }
        if (planVal) { dayPlans[dag] = planVal; }
    });
    if (validationFail) {
        var dayName = dagNameMap[validationFail.dag] || validationFail.dag;
        var msgKey = validationFail.missing === 'etasje'
            ? 'validation_day_missing_etasje'
            : 'validation_day_missing_timer';
        showNotificationModal(t(msgKey, dayName));
        return;  // Hold modalen åpen så bruker kan fikse
    }
    var genInput = document.getElementById('dag-timer-generelt-input');
    var genVal = genInput ? genInput.value.trim() : '';
    if (genVal) timer._generelt = genVal;

    // Først nå (validering OK) lukker vi modalen.
    modal.classList.remove('active');
    modal.removeEventListener('touchmove', dagTimerBlockScroll);
    modal.removeEventListener('wheel', dagTimerBlockScroll);

    dagTimerActiveCard.setAttribute('data-dager', JSON.stringify(dager));
    dagTimerActiveCard.setAttribute('data-timer', JSON.stringify(timer));
    dagTimerActiveCard.setAttribute('data-day-plans', JSON.stringify(dayPlans));

    // Bestilling-nivå union for eldre lesere (eksport, timer-oversikt som
    // viser samlet etasje-liste). Bygges fra alle dager med plans.
    var unionSet = {};
    Object.keys(dayPlans).forEach(function(d) {
        (dayPlans[d] || '').split(',').forEach(function(p) {
            var s = p.trim();
            if (s) unionSet[s] = true;
        });
    });
    var unionArr = Object.keys(unionSet);
    dagTimerActiveCard.setAttribute('data-plans', JSON.stringify(unionArr));

    // Legacy .plan-display (eksport/validering) — speil samlet union.
    var unionPlan = unionArr.join(', ');
    var planDisp = dagTimerActiveCard.querySelector('.plan-display');
    if (planDisp) {
        planDisp.setAttribute('data-plan', unionPlan);
        var dispText = planDisp.querySelector('.plan-display-text');
        if (dispText) dispText.textContent = unionPlan;
    }
    updateDagTimerSummary(dagTimerActiveCard);
    dagTimerActiveCard = null;
    if (typeof updateTimerChip === 'function') updateTimerChip();
    _maybeReturnToTimerOverview();
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
        container.appendChild(createServiceEntryCard(entry, list.length === 1));
    });
    renumberServiceEntries();
    updateServiceDeleteStates();
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
        const dager = JSON.parse(card.getAttribute('data-dager') || '[]');
        const plan = card.querySelector('.plan-display').getAttribute('data-plan') || '';
        const dayPlansObj = JSON.parse(card.getAttribute('data-day-plans') || '{}');
        const dayPlans = Object.keys(dayPlansObj).length > 0 ? dayPlansObj : '';
        // Nytt: etasjer som bestilling-nivå-liste. Backward-kompatibel —
        // gamle lesere som kun ser dayPlans får fortsatt utfylt struktur.
        var plansArr = [];
        try { plansArr = JSON.parse(card.getAttribute('data-plans') || '[]') || []; } catch (e) {}
        const plans = plansArr.length ? plansArr : '';
        const merknad = card.querySelector('.mobile-order-merknad').value;
        const timerObj = JSON.parse(card.getAttribute('data-timer') || '{}');
        const timer = Object.keys(timerObj).length > 0 ? timerObj : '';
        const matContainer = card.querySelector('.mobile-order-materials');
        const materials = getMaterialsFromContainer(matContainer);
        // "Ikke aktuelt"-flagg. Kun lagret når true OG seksjonen er tom (ellers
        // er flagget irrelevant; FILLED-state fjerner det implisitt i UI).
        const materierSkipped = card.getAttribute('data-skip-materier') === 'true' && materials.length === 0;
        const dagerSkipped = card.getAttribute('data-skip-dager') === 'true' && !timer && !plans;
        // Per-dag etasjer er nå primær. data-day-plans inneholder allerede den
        // riktige formen ({ma: 'U3, U2', ti: 'U1'}).
        const dayPlansPrimary = _getCardDayPlans(card);
        const dayPlansOut = Object.keys(dayPlansPrimary).length ? dayPlansPrimary : (typeof dayPlans === 'object' ? dayPlans : '');
        orders.push({ description, dager, plan, dayPlans: dayPlansOut, plans, merknad, materials, timer, materierSkipped, dagerSkipped });
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

        // Update service export table signature if preview is open
        if (window._signedFromServicePreview) {
            window._signedFromServicePreview = false;
            var sigData = document.getElementById('service-signatur').value;
            var exportSigImg = document.getElementById('service-export-sig-img');
            if (exportSigImg) {
                if (sigData && sigData.startsWith('data:image')) {
                    exportSigImg.src = sigData;
                    exportSigImg.style.display = '';
                } else {
                    exportSigImg.style.display = 'none';
                }
            }
            updatePreviewHeaderState(hasSignature);
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

    // Update desktop signature directly in preview (preview stays open)
    if (window._signedFromPreview) {
        window._signedFromPreview = false;
        var sigData = document.getElementById('mobile-kundens-underskrift').value;
        var desktopImg = document.getElementById('desktop-signature-img');
        if (desktopImg) {
            if (sigData && sigData.startsWith('data:image')) {
                desktopImg.src = sigData;
                desktopImg.style.display = 'block';
            } else {
                desktopImg.style.display = 'none';
            }
        }
        // Update preview header to show "Ferdig" + "Signert"
        updatePreviewHeaderState(hasSignature);
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

            if ((order.dager && order.dager.length > 0) || genVal) {
                const dagMap = { ma: 'Mandag', ti: 'Tirsdag', on: 'Onsdag', to: 'Torsdag', fr: 'Fredag', lo: 'Lørdag', so: 'Søndag' };
                var dagParts = [];
                if (order.dager && order.dager.length > 0) {
                    dagParts = order.dager.map(d => {
                        const tv = order.timer && order.timer[d];
                        return (dagMap[d] || d) + (tv ? ' (' + String(tv).replace('.', ',') + 't)' : '');
                    });
                }
                if (genVal) {
                    dagParts.push('Uspesifisert dag (' + String(genVal).replace('.', ',') + 't)');
                }
                const dagLabel = document.createElement('strong');
                dagLabel.textContent = t('order_days') + ': ';
                descContent.appendChild(dagLabel);
                descContent.appendChild(document.createTextNode(dagParts.join(', ')));
            }

            var hasDagerLine = (order.dager && order.dager.length > 0) || genVal;
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
            // Skip spec-base materials that shouldn't be exported (but not direct meter entries)
            if (cachedMaterialOptions && m.enhet !== 'meter') {
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
                    var expEnhet = normalizeVariant(m.name, m.enhet || '').toLowerCase();
                    if (expEnhet && expEnhet !== 'stk' && expEnhet !== 'meter') {
                        capName += ' ' + expEnhet;
                    }
                }
                const antallNum = parseFloat((m.antall || '').replace(',', '.'));
                const pipeInfo = getRunningMeterInfo(m.name);
                if (pipeInfo && !isNaN(antallNum) && antallNum > 0) {
                    var lm = calculateRunningMeters(pipeInfo, antallNum);
                    var lagMatchExp = capName.match(/^(.+?) \((\d+) lag\)$/);
                    var baseSpecExp = lagMatchExp ? lagMatchExp[1] : capName;
                    var roundsExp = lagMatchExp ? parseInt(lagMatchExp[2], 10) : 1;
                    var nameWithStk = roundsExp > 1
                        ? baseSpecExp + ' (' + (m.antall || '').replace('.', ',') + ' stk \u00d7 ' + roundsExp + ' lag)'
                        : baseSpecExp + ' (' + (m.antall || '').replace('.', ',') + ' stk)';
                    addRow(formatDisplayForBreak(nameWithStk), formatRunningMeters(lm), 'meter', { alignRight: true });
                } else if (m.source === 'kappe-products') {
                    // Kappe-isolasjon på ordreseddel: vis materialforbruk i m² (antall plater × plate-areal).
                    // Plater beholdes på kappeskjemaet der det er montørens praktiske enhet.
                    var plateCount = (typeof calcKappePlateCount === 'function') ? calcKappePlateCount(m) : 0;
                    if (plateCount > 0) {
                        var areaM2 = (typeof calcKappeAreaM2 === 'function') ? calcKappeAreaM2(m, plateCount) : 0;
                        var areaLabel = (typeof formatKappeArea === 'function') ? formatKappeArea(areaM2) : String(areaM2);
                        addRow(capName, areaLabel, 'm²', { alignRight: true });
                    } else if (m.antall) {
                        // Fallback hvis bredde/plate-info mangler
                        var fallbackUnit = m.quantityUnit || getMaterialQuantityUnit(m.name, m.enhet, m.source);
                        addRow(capName, formatRunningMeters(m.antall), fallbackUnit, { alignRight: true });
                    }
                } else {
                    var exportUnit = m.quantityUnit || getMaterialQuantityUnit(m.name, m.enhet, m.source);
                    addRow(capName, formatRunningMeters(m.antall), exportUnit, { alignRight: true });
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
            // «Materiell:»-header vises kun når det finnes løse varer (uten
            // gruppering — typisk standard-produkter som GPG, FSB1). Når
            // alle varer er i sub-grupper (FSC/FSW/Kabelhylse/Isolering) gir
            // headeren ingen mening — sub-headere identifiserer alt.
            var _hasLooseItems = exportGroups.some(function(g) {
                return !g.isSpecGroup && !g.isIsolationGroup && !g.isStiftGroup;
            });
            if (_hasLooseItems) {
                addRow('Materiell:', '', '', { bold: true, alignRight: true });
            }
            exportGroups.forEach(function(group) {
                if (!group.isSpecGroup && !group.isIsolationGroup && !group.isStiftGroup) {
                    group.items.forEach(function(gm) { addExportMatRow(gm); });
                } else {
                    // Group header row (bold base name)
                    var exportGroupTitle = group.displayName || group.baseName;
                    addRow('  ' + exportGroupTitle.charAt(0).toUpperCase() + exportGroupTitle.slice(1) + ':', '', '', { bold: true, alignRight: true });
                    var groupTotalMeter = 0;
                    var groupHasMeter = false;
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
                        // Akkumuler totalt — meter for spec-grupper, plater for kappe-isolasjon.
                        var antallNum = parseFloat(String(gm.antall || '').replace(',', '.'));
                        var pipeInfo = getRunningMeterInfo(gm.name);
                        if (gm.source === 'kappe-products') {
                            var gmPlateCount = (typeof calcKappePlateCount === 'function') ? calcKappePlateCount(gm) : 0;
                            if (gmPlateCount > 0) {
                                groupTotalPlater += gmPlateCount;
                                groupHasPlater = true;
                            }
                        } else if (pipeInfo && !isNaN(antallNum) && antallNum > 0) {
                            groupTotalMeter += calculateRunningMeters(pipeInfo, antallNum);
                            groupHasMeter = true;
                        } else if ((gm.quantityUnit || getMaterialQuantityUnit(gm.name, gm.enhet, gm.source)) === 'meter' && !isNaN(antallNum)) {
                            groupTotalMeter += antallNum;
                            groupHasMeter = true;
                        }
                    });
                    // Totalt-rad: kun for spec-grupper (FSC/FSW/Kabelhylse) der alle rader representerer
                    // samme produkt med ulike spec/runder — der gir summen mening.
                    // For Isolering har hver rad et UNIKT produkt (Fireprotect 20mm vs 22mm vs ...),
                    // så et "totalt" på tvers ville ikke vært meningsfullt.
                    if (groupHasMeter && renderItems.length > 1) {
                        addRow('    Totalt:', formatRunningMeters(groupTotalMeter), 'meter', { bold: true, alignRight: true });
                    }
                }
            });
        }

        // Timer — sum all values (days + _generelt/_total)
        if (order.timer && typeof order.timer === 'object') {
            let orderTotal = 0;
            Object.values(order.timer).forEach(v => {
                const val = parseFloat(String(v || '').replace(',', '.'));
                if (!isNaN(val)) orderTotal += val;
            });
            if (orderTotal > 0) {
                const formatted = orderTotal.toFixed(1).replace('.', ',');
                addRow('Tid:', formatted, 'timer', { alignRight: true });
                totalTimer += orderTotal;
            }
        } else if (typeof order.timer === 'string' && order.timer) {
            const val = parseFloat(order.timer.replace(',', '.'));
            const formatted = isNaN(val) ? order.timer.replace('.', ',') : val.toFixed(1).replace('.', ',');
            addRow('Tid:', formatted, 'timer', { alignRight: true });
            if (!isNaN(val)) totalTimer += val;
        }
    });

    // Total timer (only if there are any). Tom rad over for å skille fra siste bestilling
    // (ellers ser det ut som totalen tilhører forrige seksjon).
    if (totalTimer > 0) {
        addRow('', '', '');
        const formatted = totalTimer.toFixed(1).replace('.', ',');
        addRow('Totalt:', formatted, 'timer', { bold: true, alignRight: true });
    }

    // Ensure minimum rows to fill the page
    const currentRows = container.querySelectorAll('.work-line').length;
    for (let i = currentRows; i < 15; i++) {
        addRow('', '', '');
    }
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
        const card = createOrderCard(order, false);
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
            const cardDayPlans = _getCardDayPlans(card);
            // Hver dag (Ma-Sø): hvis enten timer ELLER etasje er fylt, MÅ
            // begge være fylt. Per-dag-bindingen.
            var pairFail = null;
            for (var di = 0; di < dagOrder.length; di++) {
                var d = dagOrder[di];
                var hasT = !!(cardTimer[d] && String(cardTimer[d]).trim());
                var hasP = !!(cardDayPlans[d] && String(cardDayPlans[d]).trim());
                if (hasT !== hasP) { pairFail = { dag: d, missing: hasT ? 'etasje' : 'timer' }; break; }
            }
            if (pairFail) {
                var dayName = dagNameMap[pairFail.dag] || pairFail.dag;
                var msgKey = pairFail.missing === 'etasje'
                    ? 'validation_day_missing_etasje'
                    : 'validation_day_missing_timer';
                showNotificationModal(t(msgKey, dayName) + ' (' + t('settings_req_beskrivelse') + ' ' + (i + 1) + ')');
                return false;
            }
            // Bestillingen må ha minst ÉN dag med timer (inkl. "Annet") eller
            // etasje. Tom dager-seksjon når den er obligatorisk er ikke OK.
            var anyDayHasContent = dagOrder.some(function(d) {
                return !!(cardTimer[d] && String(cardTimer[d]).trim())
                    || !!(cardDayPlans[d] && String(cardDayPlans[d]).trim());
            });
            var genVal = cardTimer._generelt || cardTimer._total;
            if (!anyDayHasContent && !genVal) {
                showNotificationModal(t('required_field', t('order_days')) + ' (' + t('settings_req_beskrivelse') + ' ' + (i + 1) + ')');
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
        document.getElementById('sent-banner').style.display = 'none';
        var btnFormSent = document.getElementById('btn-form-sent');
        if (btnFormSent) btnFormSent.style.display = '';
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

