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
- Tastatur-aware toolbar-logikk

**Regel: Ny kode plasseres i filen som matcher kategorien. Ved tvil, bruk `script-ui.js`.**

## GitHub Pages
Nettsiden hostes på: https://kiicki.github.io/Firesafe-ordreseddel/

## Firebase Console
Prosjekt: firesafe-ordreseddler
URL: https://console.firebase.google.com
