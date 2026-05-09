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

Appen brukes mye på mobil og nettbrett. Når brukeren tapper på et input-felt åpnes skjermtastaturet. **Test alltid både uten og med tastatur åpent** før du erklærer en UI-endring som ferdig.

### Arkitektur — to lag

**Lag 1 (PRIMÆR): CSS-drevet via `body.keyboard-open`-klasse**

Dette er hovedmekanismen for views, modal-content, modal-body og toolbar. Alt styres i CSS — JS bare toggler klassen. Når `body.keyboard-open` er satt:
- Alle views (`#view-form`, `#saved-modal`, `#template-modal`, etc.): `position: static; overflow: visible; height: auto; min-height: calc(100dvh - 60px)`
- `.modal-content`/`.modal-body`: `overflow: visible`
- `.toolbar`: `position: static; box-shadow: none` (flyter naturlig på slutten av body)
- `.confirm-modal`: `padding-bottom: 0`
- `body`: `padding-bottom: 0`

Resultat: hele body flyter naturlig som ett dokument. Sticky-headers (`.sticky-header`, `#form-header`) holder seg på toppen via egen `position: sticky`. Toolbar havner på slutten av body's normale flow. Ingen høydejustering, ingen reparenting, ingen overflow-låsing.

**Lag 2: JS-håndtering for popups og fullscreen overlays**

For ting som forblir `position: fixed` (popups, fullscreen overlays) trenger vi JS — de er ikke i body's normale flow:
- **Popups** (`.confirm-modal-content`, `.spec-popup-sheet`, `.fakturaadresse-popup-sheet`): piksel-cap på `max-height = vv.height - 32` + `transform: translateY(-N)` som ankrer bunnen rett over tastaturet
- **Fullscreen-overlays** (`#picker-overlay`, `#unit-picker-overlay`, `#kappe-product-picker-overlay`, `#template-picker-overlay`): krympes til `top: vv.offsetTop` + `height: vv.height` så de ikke strekker seg bak tastaturet (browseren mister touch-events for området bak tastaturet ellers)

### Sentrale fakta

1. **Viewport-meta:** `index.html` bruker `interactive-widget=resizes-visual`:
   - **Layout viewport** (`window.innerHeight`) forblir full skjerm når tastatur åpnes
   - **Visual viewport** (`window.visualViewport.height`) krymper til området over tastaturet
   - `position: fixed`-element ankres mot **layout viewport** — så de dekker fortsatt hele skjermen, inkludert området bak tastaturet
   - Lag-1-løsningen (static via body.keyboard-open) sidesteps dette ved å gjøre views ikke-fixed

2. **CSS-prosenter er en felle:** `max-height: calc(100% - X)` på popup-content løses mot **layout viewport** (full skjerm), IKKE synlig område. En popup kan bli større enn synlig viewport selv med CSS max-height satt. Eneste robuste løsning for popups er **piksel-cap via JS** (`element.style.setProperty('max-height', px + 'px', 'important')`)

### Unified handler: `applyKeyboardLayout()` i `script-ui.js`

ÉN sentral funksjon eier all tastatur-respons. Hold det slik — ikke lag konkurrerende handlere.

**Hva den gjør (idempotent):**
1. Detekter keyboardOpen via `(window.innerHeight - vv.height - vv.offsetTop) > 100` med hysteresis (åpning umiddelbar, lukking forsinket 400ms for å unngå flicker ved kortvarig fokus-mistring under scroll)
2. State-memo via signatur av (keyboardOpen + activeView + aktive popups + aktive overlays). Skip apply hvis logisk state er uendret. URL-bar-bevegelse under scroll blir filtrert bort siden den ikke endrer logisk state — momentum-scroll forstyrres ikke
3. Toggle `body.keyboard-open` (Lag 1)
4. Justere fullscreen-overlays + popup-content (Lag 2)

**Triggers (alle gjennom `requestAnimationFrame`-debouncing — maks 1 apply per frame):**
1. `visualViewport.resize` — tastatur åpnes/lukkes, orienterings-endring
2. **Settle-timer (250ms etter siste resize)** — forced apply som bypasser state-memo, fanger final vv-verdier etter tastatur-animasjon eller URL-bar-settle
3. **`MutationObserver` på `document.body` (subtree)** — fanger BÅDE class-endringer på popup-backdrops OG dynamisk innsatte popups (childList). Filtrert til kun popup-backdrop-mutations for ytelse
4. **`ResizeObserver` per aktiv popup-content** — re-kalkulerer translate når content vokser/krymper (tekst-ekspansjon, dynamisk innhold). Bruker `forceNextApply`-flagg så content-vekst bypasser state-memo
5. `focusin`/`focusout` på document — **filtrert til kun text-inputs/textarea/contenteditable** så scroll-momentum ikke avbrytes når finger lander på checkbox/knapp under scroll
6. Initial kjøring ved DOMContentLoaded

**Bevisst IKKE lyttet til:** `visualViewport.scroll` — fyrer per frame når URL-baren beveger seg under scroll, ville avbryte momentum-scroll om vi reagerte. Final vv-verdier hentes via settle-timer i stedet.

### Når du legger til en ny popup eller modal

**Bruk én av eksisterende strukturer:**
- Backdrop `.confirm-modal` + content `.confirm-modal-content` (sentrert popup)
- Backdrop `.spec-popup-backdrop` + content `.spec-popup-sheet`
- Backdrop `.fakturaadresse-popup-backdrop` + content `.fakturaadresse-popup-sheet`

Da plukkes den AUTOMATISK opp av `applyKeyboardLayout` og MutationObserveren. Backdropen må toggle `.active`-klassen for å vises.

**Ny view (full-skjerm scrollable):** Bruk `.view`-klassen og legg view-IDen til CSS-blokken `body.keyboard-open #din-view.view.active { ... }` så CSS-laget håndterer den.

**Ny fullscreen overlay (som picker):** Legg ID-en til `FULLSCREEN_OVERLAY_IDS` i `script-ui.js` (én linje endring).

### Hva du IKKE skal gjøre

- ❌ Ikke registrer egne `visualViewport.resize`/`scroll`-listenere i popup/view-kode — det skaper konkurrerende handlere
- ❌ Ikke flytt eller reparent toolbar manuelt — CSS via `body.keyboard-open .toolbar` håndterer det
- ❌ Ikke set `view.style.height/bottom/display` manuelt for å håndtere tastatur — bruk CSS-laget
- ❌ Ikke set `transform: translateY(...)` manuelt på popup-content — `applyKeyboardLayout` eier det
- ❌ Ikke stol på CSS `max-height: calc(100% - X)` for å begrense popup-content over tastaturet — det løses mot full skjerm. Bruk JS piksel-cap

### Sjekkliste før du committer en UI-endring

- [ ] Testet uten tastatur (alle elementer synlige, normal scroll)
- [ ] Testet med tastatur åpent på input-felt i den nye/endrede komponenten
- [ ] Tittel og lukke-/lagre-knapper synlige i begge tilstander
- [ ] Popup ikke blokkert av tastaturet
- [ ] Scroll fungerer jevnt (ingen avbrudd midt i momentum)
- [ ] Toolbar oppfører seg riktig (i flow under tastatur-åpent, fixed bottom ellers)

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
