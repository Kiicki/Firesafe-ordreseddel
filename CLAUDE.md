# Firesafe Ordreseddel - Instruksjoner for Claude

## Prosjektoversikt
Dette er en PWA (Progressive Web App) for å lage og administrere ordresedler for Firesafe AS. Appen bruker Firebase for synkronisering mellom enheter.

## VIKTIG: Firebase-kode som IKKE skal endres

### I `script.js` - Ikke endre disse delene:

1. **Firebase-konfigurasjon (linje 8-15):**
```javascript
const firebaseConfig = {
    apiKey: "...",
    authDomain: "...",
    projectId: "...",
    // etc.
};
```

2. **Firebase-initialisering (linje 17-25):**
```javascript
let db = null;
let auth = null;
let currentUser = null;
firebase.initializeApp(firebaseConfig);
db = firebase.firestore();
auth = firebase.auth();
```

3. **Auth-funksjoner:**
- `updateLoginButton()`
- `handleAuth()`
- `getSavedForms()`
- `getArchivedForms()`
- Auth state listener (`auth.onAuthStateChanged`)

### I `index.html` - Ikke endre disse linjene:

```html
<script src="https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.0/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore-compat.js"></script>
```

Og innloggingsknappen:
```html
<button class="btn-login" id="btn-login" onclick="handleAuth()">Logg inn</button>
```

## Når brukeren ber om endringer

- Hvis brukeren sier "ikke endre Firebase-koden" - hold deg unna alt over
- Ved tvil, spør brukeren før du endrer noe Firebase-relatert
- Endringer i HTML/CSS/design er alltid trygt
- Nye funksjoner kan legges til uten å røre Firebase-koden

## **KRITISK: All ny brukerdata MÅ synces til Firebase**

Appen brukes på flere enheter (PC, mobil, nettbrett) av samme bruker. **Alt som lagres lokalt MÅ også lagres til Firebase** — ellers ser brukeren forskjellige data på forskjellige enheter, noe som er en kritisk bug.

### Krav for ALLE nye lagringsoperasjoner

Når du implementerer en ny funksjon som lagrer data (skjemaer, innstillinger, lister, preferanser), må du **alltid**:

1. **Skrive til localStorage** (cache for offline-bruk)
2. **Skrive til Firestore** (`db.collection('users').doc(currentUser.uid).collection(...)`)
3. **Hente fra Firestore ved innlogging** — legg til i `auth.onAuthStateChanged`-flyten i `script.js`
4. **Refreshe fra Firestore når brukeren åpner listen** (cache-first, deretter background refresh — se `loadServiceTab()` som mønster)
5. **Slette fra localStorage ved bruker-bytte** — legg nøkkelen til opprydningslisten i `auth.onAuthStateChanged`
6. **Slette fra Firestore ved sletting** — ikke bare lokalt

### Mønster å følge (se `saveServiceForm`/`loadServiceTab` som referanse)

**Save (script-ui.js):**
```javascript
safeSetItem(STORAGE_KEY, JSON.stringify(data));  // 1. Lokalt
if (currentUser && db) {                           // 2. Firebase
    _pendingFirestoreOps = _pendingFirestoreOps.then(function() {
        return db.collection('users').doc(currentUser.uid).collection('myCollection').doc(id).set(data);
    }).catch(function(e) { console.error('Save error:', e); });
}
```

**Fetch-funksjon (script.js):**
```javascript
async function getMyData(lastDoc) {
    if (currentUser && db) {
        try {
            var snapshot = await db.collection('users').doc(currentUser.uid).collection('myCollection')
                .orderBy('savedAt', 'desc').limit(50).get();
            return { items: snapshot.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); }) };
        } catch(e) { console.error('getMyData error:', e); }
    }
    return { items: safeParseJSON(STORAGE_KEY, []) };
}
```

**Innstillinger (settings-dokumenter):** bruk hjelperen `_syncKappeSetting` (eller lignende mønster) som skriver til både localStorage og Firebase i én operasjon.

### Sjekkliste før du committer en ny lagringsfunksjon

- [ ] Lagrer til Firebase i save-funksjonen
- [ ] Sletter fra Firebase i delete-funksjonen
- [ ] Henter fra Firebase ved innlogging (`auth.onAuthStateChanged`)
- [ ] Refresher fra Firebase når listen åpnes
- [ ] Inkludert i opprydning ved bruker-bytte
- [ ] Testet ved å lagre på én enhet og åpne på en annen

**Det er ikke akseptabelt å implementere ny brukerdata uten Firebase-sync.** Hvis du er i tvil om data tilhører "brukerdata" (synces) eller "midlertidig state" (kun lokal): synces det.

## VIKTIG: Tastatur-håndtering på mobil/nettbrett

Appen brukes mye på mobil og nettbrett. Når brukeren tapper på et input-felt åpnes skjermtastaturet, og dette **må alltid håndteres** for popups, modaler og scrollbare visninger. **Test alltid både uten og med tastatur åpent** før du erklærer en UI-endring som ferdig.

### Sentrale fakta

1. **Viewport-meta:** `index.html` bruker `interactive-widget=resizes-visual`:
   - **Layout viewport** (`window.innerHeight`) forblir full skjerm når tastatur åpnes
   - **Visual viewport** (`window.visualViewport.height`) krymper til området over tastaturet
   - `position: fixed`-element ankres mot **layout viewport** — så de dekker fortsatt hele skjermen, inkludert området bak tastaturet
   - Konsekvens: en sentrert popup vil havne bak tastaturet hvis du ikke aktivt kompenserer

2. **CSS-prosenter er en felle:** `max-height: calc(100% - X)` på `.confirm-modal-content` og lignende løses mot **layout viewport** (full skjerm), IKKE synlig område. En popup kan bli større enn synlig viewport selv med CSS max-height satt. Eneste robuste løsning er **piksel-cap via JS**.

### Unified handler: `applyKeyboardLayout()` i `script-ui.js` (~linje 6245)

Det finnes **ÉN** sentral funksjon som er ENESTE eier av tastatur-respons. Hold den slik — ikke lag konkurrerende handlere i andre filer.

**Hva den gjør (idempotent — trygg å kalle gjentatte ganger):**
1. Justerer aktive views (`view-form`, `service-view`, `kappe-view`) til synlig høyde via `height: vv.offsetTop + vv.height`
2. Reparenterer toolbaren inn i scrollable view (`.toolbar--inflow`-klasse) — så den ikke blokkerer input
3. `body.overflow = 'hidden'` mens tastatur er åpent
4. For ALLE popup-content under aktive backdrops (`.confirm-modal-content`, `.spec-popup-sheet`, `.fakturaadresse-popup-sheet`):
   - Setter eksplisitt **piksel-cap** på `max-height = vv.height - 32` (med `setProperty(..., 'important')` for å overstyre CSS !important)
   - Måler `offsetHeight` post-cap og beregner `transform: translateY(-N)` som ankrer bunnen rett over tastaturet (med 16px margin)
5. Fjerner toolbar-`padding-bottom` på aktive `.confirm-modal`-backdrops

**Triggers (fem mekanismer dekker alle scenarioer, alle rutet gjennom `requestAnimationFrame`-debouncing så maks 1 apply per frame):**
1. `visualViewport.resize` — tastatur åpnes/lukkes, orienterings-endring
2. `visualViewport.scroll` — URL-bar viser/skjuler under scroll
3. **`MutationObserver` på `document.body` (subtree)** — fanger BÅDE class-endringer på eksisterende popup-backdrops OG dynamisk innsatte popups (childList)
4. **`ResizeObserver` per aktiv popup-content** — re-kalkulerer translate når content vokser/krymper (f.eks. tekst-ekspansjon, async-lastet innhold)
5. `focusin`/`focusout` på document — fallback for browsere som fyrer focus før `vv.resize`
6. Initial kjøring ved DOMContentLoaded (sync state ved sidelasting)

### Når du legger til en ny popup eller modal

**99% av tilfellene — gjør INGENTING ekstra:**

Hvis popupen din bruker en av disse strukturene, plukkes den AUTOMATISK opp av `applyKeyboardLayout` og MutationObserveren — du trenger ikke skrive en linje tastatur-kode:
- Backdrop med klasse `.confirm-modal` + content med klasse `.confirm-modal-content`
- Backdrop med klasse `.spec-popup-backdrop` + content med klasse `.spec-popup-sheet`
- Backdrop med klasse `.fakturaadresse-popup-backdrop` + content med klasse `.fakturaadresse-popup-sheet`

Backdropen må toggle `.active`-klassen for å vises (CSS bruker `.active` for `display: flex`).

**Hvis du legger til en HELT ny backdrop-type** (bruker IKKE en av selectorene over):
1. Legg til klassene dine i selectorene i `applyKeyboardLayout` (både i content-loop og MutationObserver-init)
2. Eller: bruk en av eksisterende klasser (anbefalt — minimerer kompleksitet)

**Hvis popup-content er HØY** (mange rader, lange lister): ikke noe ekstra trengs. Piksel-cap'en i `applyKeyboardLayout` håndterer dette automatisk.

### Hva du IKKE skal gjøre

- ❌ Ikke registrer egne `visualViewport.resize`/`scroll`-listenere i popup-spesifikk kode — det skaper konkurrerende handlere som kjemper om samme inline-styles
- ❌ Ikke set `padding-top`/`padding-bottom` manuelt på backdrops i popup-kode — `applyKeyboardLayout` eier dette
- ❌ Ikke bruk `transform: translateY(...)` manuelt på popup-content — `applyKeyboardLayout` eier dette
- ❌ Ikke bruk CSS `body.<noe>-keyboard-open`-klasser med utgangspunkt i tastaturstate — bruk `applyKeyboardLayout` i stedet
- ❌ Ikke stol på CSS `max-height: calc(100% - X)` for å begrense popup over tastaturet — det løses mot full skjerm

### Sjekkliste før du committer en UI-endring

- [ ] Testet uten tastatur åpent (alle elementer synlige, normal scroll fungerer)
- [ ] Testet med tastatur åpent på input-felt i den nye/endrede komponenten
- [ ] Tittel og lukke-/lagre-knapper synlige i begge tilstander
- [ ] Popup ikke blokkert av tastaturet
- [ ] Lange popups: scroll inni popup fungerer over tastaturet
- [ ] Hvis det er et scrollbart område: fokuserte input scroller til synlig posisjon
- [ ] Inline styles ryddes opp når tastaturet lukkes / komponenten lukkes (`applyKeyboardLayout` håndterer dette automatisk for popups som bruker standardklassene)

## VIKTIG: Cache-versjon ved hver endring

Brukeren tester appen som PWA på mobil — service worker cacher filer aggressivt. **ALLTID** bump cache-versjoner ved hver kode-endring slik at brukeren får siste versjon:

1. **`service-worker.js`** — øk `CACHE_NAME` (f.eks. `firesafe-v327` → `firesafe-v328`)
2. **`index.html`** — øk versjons-query på alle relevante filer:
   - `<link rel="stylesheet" href="styles.css?v=216">` → `?v=217`
   - `<script src="lang.js?v=118">` → `?v=119`
   - `<script src="script.js?v=148">` → `?v=149`
   - `<script src="script-ui.js?v=183">` → `?v=184`

Bump kun versjonen på filene som faktisk ble endret + service-worker.js.


## Filstruktur

```
/Firesafe-ordreseddel/
├── index.html    - HTML-struktur + Firebase SDK
├── styles.css    - All CSS-styling
├── script.js     - Kjerne-JavaScript + Firebase-integrasjon
├── script-ui.js  - UI-funksjoner, innstillinger, eksport
├── lang.js       - Språkfiler (oversettelser)
├── manifest.json - PWA-manifest
└── CLAUDE.md     - Denne filen
```

## JavaScript-filsplitt (script.js / script-ui.js)

Begge filer deler globalt scope. Ny kode skal plasseres i riktig fil basert på kategori.

**`script.js`** — Kjerne-logikk (lastes først):
- Firebase config, init, auth (IKKE ENDRE)
- Språk/i18n-system (`t()`, `applyTranslations`)
- Modal- og notifikasjonsfunksjoner
- Teksteditor (fullskjerm)
- Hjelpefunksjoner (`formatDate`, `isMobile`, `autoResizeTextarea`)
- Ordrekort-UI og material/enhet-pickers
- Ordrehåndtering (legg til/fjern/toggle/sync)
- `getFormData()` / `setFormData()`
- `validateRequiredFields()`
- `saveForm()`

**`script-ui.js`** — UI-funksjoner (lastes etter script.js):
- Last/administrer lagrede skjemaer
- Sletting, duplisering, eksterne skjemaer
- Maler (templates)
- Innstillinger (ordrenummer, materialer, enheter, standardverdier)
- Eksport/PDF/JPG-funksjoner
- DOMContentLoaded event listeners og sideinit

**Regel: Ny kode plasseres i filen som matcher kategorien. Ved tvil, bruk `script-ui.js`.**

## GitHub Pages
Nettsiden hostes på: https://kiicki.github.io/Firesafe-ordreseddel/

## Firebase Console
Prosjekt: firesafe-ordreseddler
URL: https://console.firebase.google.com
