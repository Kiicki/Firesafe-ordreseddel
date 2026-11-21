# Firesafe Ordreseddel - Instruksjoner for Claude

## Prosjektoversikt
Dette er en PWA (Progressive Web App) for å lage og administrere ordresedler for Firesafe AS. Appen bruker Firebase for synkronisering mellom enheter.

## **GRUNNPRINSIPP: Atferds-endringer gjelder HELE nettsiden**

Når vi blir enige om hvordan en interaksjon skal oppføre seg — **tastatur (åpen/lukket), scroll-for-å-lukke, tapp-utenfor-for-å-lukke, popup-låsing av bakgrunn, fokus-håndtering, modal-oppførsel, layout under tastatur**, eller en hvilken som helst annen «slik fungerer appen»-regel — gjelder den oppførselen **konsekvent overalt** i appen. Ikke bare i konteksten vi tilfeldigvis snakket om.

**Dette betyr konkret:**
- Implementer atferden generisk (gate på *typen* situasjon, ikke spesifikke view-IDs/komponenter med mindre det er en bevisst, dokumentert begrensning).
- Når du legger til en ny gate eller et nytt unntak, beskriv hvorfor i kommentaren — ellers er det halvveis arbeid.
- Når brukeren beskriver et problem i én del av siden, anta at oppførselen som forventes (eller det de er enige om) skal være lik i alle andre deler som har samme situasjon (samme type input/scroll/popup/layout).
- Når du foreslår en fiks: nevn eksplisitt hvor ellers i appen samme oppførsel gjelder, og bekreft at fiksen dekker dem alle.
- Brukeren skal IKKE måtte be deg om å «utvide» en oppførsel til andre views/popuper/modaler — det er underforstått at den gjelder hele appen fra start.

**Eksempler på regler som gjelder site-wide (ikke bare ett view):**
- Scroll-for-å-lukke-tastatur → enhver scroll med åpent tastatur i hele appen.
- Tapp-utenfor-input-for-å-lukke-tastatur → enhver tapp på ikke-input i hele appen.
- Popup-bakgrunn er låst → enhver popup overalt, ikke bare den vi nettopp så på.
- Tastaturet skal aldri dekke fokusert input → gjelder skjemaer, popuper, modaler, picker-overlays — alle steder.
- `body.kbd-editing`-styrt static-layout → alle form-views, ikke bare ett.

**Hvis du i unntakstilfelle MÅ scope smalt** (fordi en spesifikk komponent har genuint annerledes oppførsel): dokumenter det i koden OG nevn det eksplisitt i svaret ditt, slik at brukeren kan godkjenne unntaket. Aldri scope smalt uten å si fra.

## **KONSISTENS: Diff BEGGE implementasjonene i koden før du endrer**

Når brukeren ber om at noe skal være **konsistent / likt** mellom to steder (f.eks. ordreseddel-lista vs. servicebil-lista, to kort, to popuper), er det IKKE nok å matche ett og ett attributt eller gjette ut fra et skjermbilde. Da bommer du på detaljene (mellomrom, separatorer, marginer, vekt, størrelse) og brukeren må rapportere samme problem flere ganger.

**Fremgangsmåte (obligatorisk ved konsistens-krav):**
1. **Finn og les den FAKTISKE koden** som bygger begge variantene — både HTML/JS-markup (hvordan strengen settes sammen, inkl. mellomrom rundt separatorer) OG CSS-en som treffer dem (grep etter klassene, sjekk base-regler + eventuelle scoped overrides).
2. **Sammenlign dem side ved side** og finn ALLE forskjellene (ikke bare den ene du la merke til): markup, separator-tegn, mellomrom, font-størrelse/-vekt/-farge, marginer/padding, gap.
3. **Gjør dem identiske** (helst ved å dele samme markup/CSS), og **bekreft i svaret** at du har sammenlignet kilde + CSS på begge sider og at de nå er like.

Ikke si «jeg tar det med videre» — det betyr ingenting. Verifiser i koden hver gang.

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

## **KRITISK: Ingenting skal mangle etter oppdatering (refresh)**

Bruker 18-11-2026: «ting skal ikke mangle etter refresh … dette gjelder alt på nettsiden». Ved oppdatering tegnes siden med en gang fra lokal cache, FØR Firebase-innloggingen er klar (`currentUser` er null de første ~1–2 s). Derfor:
- **`!currentUser` betyr «ikke klar ennå», ALDRI «lokal test»/«tom».** Lokal test = `currentUser.uid === 'dev-local'`. Vis cachen (eller «Henter …»), aldri «tom»/«finnes ikke» før data faktisk er hentet.
- **`refreshActiveView()` (script-ui.js) laster den ÅPNE siden på nytt** når innloggingen er klar — kalles fra `_accEnforce` (første gang tilgang/firma er kjent) og etter full synk i `auth.onAuthStateChanged`. **Ny side/view med Firestore-data → legg til en gren der** (gate på view-ID).
- Adresser som peker på én ting (mappe, fil, sjekkliste) åpnet før data er hentet: husk adressen og åpne den når data kommer (mønster: `_docsPendingHash`, `_sjPendingOpenId`) — ikke fall tilbake til roten.

## VIKTIG: Montørforslag og «Til godkjenning» skal alltid stemme

Felles registre (prosjekter, materialer, isolasjon, festemidler, personer) eies av admin. Når en **montør** legger til noe nytt, blir det montørens eget (brukes med en gang) **og** sendes som forslag til admin (`firms/{firma}/projectSuggestions`, felt `kind`). Admin godkjenner/retter/slår sammen/avviser i **Admin › Til godkjenning**, og fanen **«Hva sendes hit»** viser reglene for admin.

**Gjeldende regler:**
- **Sendes til godkjenning:** prosjekter, materialer (også nye enheter), isolasjonsprodukter, festemiddelprodukter, personer («Annen person» i Arbeidstid).
- **Sendes IKKE:** tykkelser/lengder og plate «Annen» (gjelder bare den ene linjen — hurtigvalg, ikke register), etasjer/valglister (montørens egne verdier gjelder bare skjemaet; bare admin legger inn i lista).
- **Montør og admin har tilgang til det SAMME i selve appen** — forskjellen er bare Innstillinger › Admin. Ingen velger/liste i skjemaene skal ha «bare admin kan legge til»: finnes ikke verdien, skal alle kunne skrive/legge til sin egen (gjelder skjemaet/linjen eller blir forslag etter reglene over). Grep etter `isAdmin` når du lager en ny velger.
- Ingen av/på-brytere: montøren skal aldri stå fast, og admin skal aldri ha egne ting hos montører som aldri blir sett.

**Når noe nytt skal kunne legges til av montør (eller reglene over endres), oppdater ALT dette i samme endring:**
- [ ] Innsending (eget + forslag) etter samme mønster som `_projSubmit` / `_matSubmit` / `_pplSubmit` (script-ui.js), med ny `kind`
- [ ] Montørens synk av admins avgjørelse (som `_matSync` / `_pplSync`)
- [ ] Innboksen: ny gruppe i `renderAdminInbox` + godkjenningsvindu med ALL informasjon (admin skal ikke måtte gå til en annen side etterpå)
- [ ] Tallet/banneret: `_sugBannerTexts` (Hjem-banner) teller den nye `kind`
- [ ] **Fanen «Hva sendes hit»: `_renderInboxRules` + `inbox_r_*`-tekstene i lang.js** — legg til/flytt linjen under «Sendes til godkjenning» eller «Sendes ikke»
- [ ] Denne seksjonen i CLAUDE.md
- [ ] Firestore-regler bare hvis ny samling (forslag bruker `projectSuggestions` — da trengs ingen nye regler)

## VIKTIG: Tastatur-håndtering på mobil/nettbrett

Appen brukes mye på mobil og nettbrett. Når brukeren tapper på et input-felt åpnes skjermtastaturet. **Test alltid både uten og med tastatur åpent** før du erklærer en UI-endring som ferdig.

### Arkitektur — to lag

**Lag 1: CSS-drevet via `body.keyboard-open`-klasse (form-views)**

For form-views (`#view-form`, `#service-view`, `#kappe-view`) styres tastatur-respons i CSS. JS bare toggler klassen. Når `body.keyboard-open` er satt:
- Form-views: `position: static; overflow: visible; height: auto; min-height: calc(100dvh - 60px)`
- `.toolbar`: `position: static; box-shadow: none` (flyter naturlig på slutten av body)
- `.confirm-modal`: `padding-bottom: 0`
- `body`: `padding-bottom: 0`

Resultat for form-views: body flyter naturlig som ett dokument. Sticky-headers (`#form-header`, `#service-header`) holder seg på toppen via egen `position: sticky`. Toolbar havner på slutten av body's normale flow.

**Lag 2: JS-håndtering for elementer som ikke kan flyte naturlig**

- **Modal-views** (`#saved-modal`, `#template-modal`, `#settings-modal`):
  Beholder `position: fixed`. JS krymper til synlig viewport (`top: vv.offsetTop; height: vv.height; min-height: 0; bottom: auto`). Toolbar reparentes til AKTIV `.modal-body` (med `--inflow`-klasse) så den scroller med listeitems. Sticky-header forblir låst på toppen. En MutationObserver-vakt re-appender toolbar hvis innerHTML-replacements i listen ødelegger den.
- **Fullscreen-overlays** (`#picker-overlay`, `#unit-picker-overlay`, `#kappe-product-picker-overlay`, `#template-picker-overlay`): krympes til `top: vv.offsetTop` + `height: vv.height` så de ikke strekker seg bak tastaturet (browseren mister touch-events for området bak tastaturet ellers).
- **Popups** (`.confirm-modal-content`, `.spec-popup-sheet`, `.fakturaadresse-popup-sheet`): piksel-cap på `max-height = vv.height - 32` + `transform: translateY(-N)` som ankrer bunnen rett over tastaturet.

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
1. Detekter keyboardOpen via målinger, ikke tidsbaserte workarounds: først `visualViewport`, deretter `window.innerHeight` mot baseline fra før fokus. Fokus på text-input brukes bare som fallback før en målemetode har bekreftet at den fungerer på enheten.
2. State-memo via signatur av (keyboardOpen + keyboard-focus + activeView + aktive popups + aktive overlays). Skip apply hvis logisk state er uendret. URL-bar-bevegelse under scroll blir filtrert bort siden den ikke endrer logisk state — momentum-scroll forstyrres ikke
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

**Felt + knapp som hører sammen** (f.eks. AI-feltet + «Spør»): sett `data-kbd-reveal` på beholderen — da løfter `ensureKeyboardTargetVisible` hele beholderen over tastaturet, ikke bare feltet.

**Ikke gi en innholdsboks `overflow-y: auto` uten fast høyde** (f.eks. arvet `.modal-body` i en view som ruller som dokument): da «ruller» tastatur-logikken boksen i stedet for siden. `_findScrollableAncestor` hopper nå over slike (høyere enn skjermen uten eget overløp), men sett `overflow-y: visible` i CSS også.

**Ny fullscreen overlay (som picker):** Legg ID-en til `FULLSCREEN_OVERLAY_IDS` i `script-ui.js` (én linje endring).

### Hva du IKKE skal gjøre

- ❌ Ikke registrer egne `visualViewport.resize`/`scroll`-listenere i popup/view-kode — det skaper konkurrerende handlere
- ❌ Ikke flytt eller reparent toolbar manuelt — `applyKeyboardLayout` eier toolbar-plassering (CSS for form-views, JS reparent for modal-views)
- ❌ Ikke set `view.style.height/bottom/display` manuelt for å håndtere tastatur — `applyKeyboardLayout` eier det
- ❌ Ikke set `transform: translateY(...)` manuelt på popup-content — `applyKeyboardLayout` eier det
- ❌ Ikke stol på CSS `max-height: calc(100% - X)` for å begrense popup-content over tastaturet — det løses mot full skjerm. Bruk JS piksel-cap

### Tab-switch i modal-views

Tab-switch (f.eks. `switchHentTab`) endrer modal-body via inline `style.display`, ikke class. MutationObserveren overvåker class-endringer, ikke style — så tab-switch fanges ikke automatisk. Hvis du legger til ny tab-switch-funksjon i en modal-view, kall `window.applyKeyboardLayout()` på slutten så toolbar flyttes til den nye aktive modal-body.

### Sjekkliste før du committer en UI-endring

- [ ] Testet uten tastatur (alle elementer synlige, normal scroll)
- [ ] Testet med tastatur åpent på input-felt i den nye/endrede komponenten
- [ ] Tittel og lukke-/lagre-knapper synlige i begge tilstander
- [ ] Popup ikke blokkert av tastaturet
- [ ] Scroll fungerer jevnt (ingen avbrudd midt i momentum)
- [ ] Toolbar oppfører seg riktig (i flow under tastatur-åpent, fixed bottom ellers)

## **DESIGNSTANDARD: Én stil på ALLE sider (ikke et lotteri)**

Hver side i appen skal se ut som den hører til samme app. Standarden er **Meny-stilen (kort-stil)**, og den ligger som variabler + felles klasser i `styles.css` (blokken «DESIGNSTANDARD», helt nederst). **Bruk dem — aldri egne farger, rammer, hjørner eller skygger på en ny side/komponent.**

**Variabler (`:root`):** `--page-bg` (#f2f2f5), `--card-bg` (#fff), `--card-radius` (14px), `--card-shadow`, `--divider`, `--inset-bg`, `--text`, `--text-2`, `--press-bg`.

**Regler:**
1. **Sidebakgrunn = `--page-bg` overalt** — alle views (også skjemaene og Timebok), og samme grå i margen på PC. Ingen hvite sider, ingen «søyle-skygge» rundt 800 px-innholdet.
2. **Innhold ligger i hvite kort:** `background: var(--card-bg); border-radius: var(--card-radius); box-shadow: var(--card-shadow)` — INGEN ramme (`border`). Klasse: `.set-card`.
3. **Lister/menyer = ÉN gruppert kort-liste** (ikke ett kort per rad): rader `.set-row` (15px/500 tittel `.set-title`, 12.5px grå undertekst `.set-desc`, ikon `.set-ico` 30px med farget bakgrunn), skillestrek `--divider` mellom radene. Lagret-/sjekkliste-lister: samme kort (første/siste rad avrundet).
4. **Seksjonstitler:** *over* en gruppe kort/liste → `.set-section-title`-stil (12px, 600, store bokstaver, grå). *Inni* skjemakort → **ingen tittel** (bruker 16-11-2026: «plassering, hullet, mål … tar bare plass») — kortene skiller seksjonene, etikettene forklarer feltene. Var tittelen eneste forklaring på et felt, bruk en vanlig feltetikett (`.mobile-section-title--label` / `<label>`). Titler over kortlister (Bestillinger, Kappeliste, Prosjekter) beholdes («Lukk alle»). Timebok-oppsummeringskort (Dagens totaler, Ukesammendrag) har liten grå tittel. Aldri kort i kort: en seksjon hvis innhold selv er kort har ingen ytre boks, bare gruppetittel over.
4a. **Skjemaer — spørsmålet bærer siden, ikke boksene** (lært av brukerens gamle sjekkliste-app, 16-11-2026): etikett = spørsmålet, mørk 14/600 (`--label-size`). Valgknapper og felt er roligere: høyde `--control-h` (36px), 14px tekst på knapper (felt beholder 16px mot iOS-zoom), hjørner `--control-radius` (6px), lys ramme (`--control-border` på knapper, `--field-border` på felt). Bare det VALGTE er oransje. Systemskrift (`-apple-system, Segoe UI, Roboto …`) i hele appen; eksport/forhåndsvisning beholder Arial.
4b. **Sammenleggbare kort** (Bestilling, Servicebil-prosjekt, Kappe-gruppe, Timebok-prosjekt): samme kort som over — hvitt korthode, skillestrek under hodet når åpent, oransje pil. Ingen farget hode eller venstrestripe.
4c. **Flate-veksling:** grå side → hvite kort; hvit flate (popup/kort) → grått innfelt felt (`--inset-bg`). Samme komponent kan derfor være hvit på siden og grå i en popup (f.eks. kappegruppen) — scope fargen til konteksten, aldri hvit-på-hvit.
5. **«Legg til»-knapper (+ …):** `.add-btn` — hvit, 1px `#e4e4e9`-ramme, radius 12, oransje tekst 500. **Aldri stiplet ramme.** «+»-brikker i brikkelister: heltrukket oransje kant.
5b. **Slett-symboler (én regel):** **søppelkasse (rød)** = slette en HEL ting (lagret skjema, bestilling, prosjektkort i Ordreseddel/Servicebil/Timebok, gruppe som GPG-gruppe/utsparing/kappegruppe, oppføring i en register-liste i Meny). **× (rød, liten)** = fjerne en LINJE inni et kort (tabellrader i Kappeskjema/Isolering/Festemidler/Sjekkliste/Lysåpning, tilleggskoder i Timebok, materiallinjer i velgeren, avstander i Satser). **× (grå)** = lukke popup / tømme felt. Aldri grå slett-knapp. CSS: blokken «SLETT-SYMBOLER» i styles.css.
6. **Fanebryter / modusvalg:** `.tb-seg` + `.tb-seg-btn` (grå bane, aktivt valg hvitt med oransje tekst). Ikke understrek-faner, ikke oransje fylte knapper.
7. **Tekstvekt:** kun overskrifter fet (600–700); radtitler 500; knapper/felt 400–500 (se «mindre fet»).
8. **Tittel i headeren = navnet på knappen som åpner siden** (toolbar: Hjem, Verktøy, Timebok, Meny).
9. **PC: appen står i en innrammet kolonne (800 px)** — kolonnen = `--page-bg` med svak skygge (`--column-shadow`), området utenfor = litt mørkere `--gutter-bg`. Header og toolbar = kolonnens bredde; kortene har samme sideluft inne i kolonnen som på mobil. Prøvd og avvist: full-bredde-striper («ser bare rart ut»), og kort helt ut til kanten uten ramme («stort og tomt»). Ny view: legg den til i «PC: appen står i en INNRAMMET kolonne»-blokken i styles.css.

**Bevisste unntak (dokumentert):** innloggingssiden (mørk merkevare-side), Firesafe-logoen øverst på Hjem, Timebok-periodestripen (lys oransje = inneværende periode), popuper/overlays (egen konvensjon, se «Popup-størrelse»).

**Når du lager en ny side eller komponent:**
- [ ] Bruker variablene/klassene over — ingen nye hex-farger for bakgrunn/kort/ramme
- [ ] Sjekket ved siden av en eksisterende side (f.eks. Meny) på mobil (360/412) OG PC
- [ ] Ny view-ID lagt til i bakgrunnsreglene i DESIGNSTANDARD-blokken (og i PC-dokumentflyt-lista om den er en `.modal`-view)
- [ ] Endrer du standarden: oppdater variabelen/klassen (ikke én side), og denne seksjonen

## Popup-størrelse (konvensjon)

Apple-prinsipp: **toppen av popupen står fast** mens den er åpen; boksen følger innholdet (ingen tomrom, ingen toggle-hopp).

1. **Innholds-tilpasset som standard.** Popuper får størrelse fra innholdet, `max-height: 80vh` + intern scroll. Ingen hardkodede pikselhøyder. De fleste popuper har ingen interne modus/tab-bytter og er uberørt av punkt 2-3.

2. **Topp-forankret + innholds-adaptiv for fler-modus-popuper.** En sentrert popup som endrer høyde ved modus-bytte re-sentreres → toppen (og toggle-knappene) hopper. Løsning: **forankre toppen** på Y der den HØYESTE modusen ville vært sentrert, og la høyden følge innholdet. Toppen/toggle står fast; boksen krymper/vokser nedenfra; ingen tomrom i sparsom modus. Bruk delt helper **`_applyPopupTopAnchor(popupId, tallestH)`** + **`_clearPopupTopAnchor(popupId)`** (script-ui.js). Mål høyeste modus ved åpning (og ved innholds-endring, f.eks. add/remove rad) via synkron force-tallest-layout + `sheet.offsetHeight`, og send som `tallestH`. Helperen setter scoped klasse `.popup-top-anchored` (CSS: `.spec-popup-backdrop.popup-top-anchored{align-items:flex-start}`) + beregnet `margin-top` (offset ≥ 16px). Dekket: spec-popup (`_anchorSpecPopupTop`), iso-kort (`_anchorIsoCardTop`). Nye fler-modus-popuper SKAL bruke disse helperne. Ingen magiske tall — alt målt fra innhold.

3. **Tastatur-headroom.** Offset clampes til ≥16px (aldri helt øverst). `applyKeyboardLayout` måler `getBoundingClientRect()` live og bruker `maxTranslate = rect.top − margin` til å løfte popupen over tastaturet — `rect.top` ≈ offset må derfor være > margin. Kall `applyKeyboardLayout()` eksplisitt etter modus-bytte (høyden endres; ikke vent på ResizeObserver).

4. **Aldri innhold utenfor skjermen — intern scroll.** Vokser innholdet > `max-height: 80vh` skal det scrolle internt (fast header/knapper, scrollbart innholds-/listeområde). Mønster: `#iso-card-rows { max-height:…vh; overflow-y:auto }`. Offsetet er ≥16px så liten skjerm/svært høy modus clampes trygt; innhold scroller.

Unntak: produkt-undervelger (`#kappe-product-picker-overlay`) er en liste-popup uten sparsom-modus-problem og beholder ratchet-låsen `_lockPopupSheetHeight`/`_unlockPopupSheetHeight`. Animert størrelsesendring er bevisst valgt bort (CSS kan ikke animere `height:auto`; JS-måling er høy risiko mot `applyKeyboardLayout`).

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

## Dokumenter + AI-svar (serverfunksjon)

- **Dokumenter** (toolbar): arkiv med mapper/undermapper, Bibliotek + Prosjekter, bare admin endrer. Fulltekstsøk: tekst pr. side i `firms/{f}/documents/{id}/text/p*`. Kode: blokkene «DOKUMENTER» i script-ui.js.
- **«Spør AI»** (Hjem-raden + Dokumenter; «Spør dette dokumentet» i fil-menyen) går via serverfunksjonene `askAppStream` (strømmet svar — teksten vises mens den skrives; appen bruker denne) og `askDocs` (vanlig kall, reserve) i mappa **`C:\Users\Igor\Desktop\Firesafe-functions`** (IKKE i denne repoen — publiseres med `FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --only functions` fra den mappa, se README.txt der). Modell: Sonnet 5.5, effort low.
- **Regel (bruker, 18-11-2026): AI-en svarer KUN ut fra appen** — aldri internett (ingen web_search/web_fetch), aldri egen kunnskap, alltid kilde. Alt hentes på serveren fra Firestore, ikke fra appen.
- **AI-en søker i HELE appen, men ser NØYAKTIG det brukeren ser i appen (aldri mer):** veiledningen (`functions/app-guide.md`), Dokumenter, egne skjemaer/timebok/innstillinger (`users/{egen uid}`), firmaets prosjekter/materialer/valglister/sjekklister — og BARE for admin: Admin-sidenes data (brukere/tilgang, satser, forslag). «Veldig viktig at montører ikke får opp admin info.» Andres private data leses aldri. Deler som er skrudd av (userAccess.modules) tas ikke med. Hvitelisten står i `korpus()`/`lastFirma()`/`MINE` i index.js.
- **Lesing av filer = på SERVEREN** (`functions/les.js`): `readDocOnUpload` (Storage-trigger, us-east1 = bøttas region) leser hver opplastet fil — tekstlaget i PDF ordrett + AI (Sonnet 5.5) leser ALLE sider og bilder (tabeller som markdown, tekst i bilder, beskrivelse av hver figur) → `text/p*` (samme format) + `figs/f0` (figurliste pr. side, grunnlag for å vise figuren senere). Status på dokumentet: `readStatus`/`aiAt`/`readError`. `readDocNow` (callable, admin) = etterfylling av eldre filer + automatisk nytt forsøk på feilet lesing (høyst 3, ≥ 1 t imellom) fra admins app. Ingen «Les på nytt»/«Bytt fil» i menyen (bruker: «den blir lest en gang så holder ikke det?» / «ny versjon = ny fil»). Bruker: «viktig at den kan også lese bilde … tabell i en pdf». Appen leser bare selv i lokal test.
- **Alle filtyper kan lastes opp (20-11-2026, bruker: «det blir for dumt å ikke kunne laste opp txt, doc, excel osv.»):** serveren leser PDF, bilder (+ HEIC via heic-convert), DOCX (mammoth, bildene til AI-en), DOC (word-extractor), XLSX/XLS/ODS/CSV (SheetJS 0.20.3 fra cdn.sheetjs.com), PPTX/ODT/ODP (jszip), RTF, tekst — `functions/filtyper.js`. «Sider» heter `pageWord` (side/del/lysbilde). Ukjente typer (zip, dwg) → `readNote:'filtype'` = «Ikke søkbar», ikke i admin-varselet. Appen: `_docsKind`/`_docsIcoHtml` (ikon pr. type), `_docsShowOther` (Excel-tabell, Word-HTML renset med `_docsSanitize`, tekst, ellers serverens tekst + «Åpne i annen app»). Storage-regelen `isDoc` tillater alle typer (ny regel må limes inn i konsollen). **«Åpne i annen app» på Android** = dele-arket med selve fila (`_docsShare`) — valgt av bruker 21-11-2026. Intent-lenke (VIEW + filtype) ble prøvd og forkastet: Android tar bare med apper som åpner PDF fra nettlenke (ofte bare Googles visning) → ingen velger, Xodo o.l. aldri med. iPhone/PC: nettleseren.
- **AI-en kjenner HELE arkivet og leser hele filer (bruker 20-11-2026: «jeg liker ikke at den bare leser biter … den burde kjenne alle filer»):** hver fil får et **innholdskort** (`kort`/`kortAt`/`kortVer` på dokumentet; `lagKort`/`kortAlle` i les.js — lages når fila er ferdig lest, eldre filer etterfylles fra admins app via `_docsCardsBackfill` → `readDocNow({kortAlle})`). ALLE kortene står i «ARKIVET» i instruksen ved hvert spørsmål (bufret). Verktøy: `read_document` (hele fila / sideintervall, maks 160k tegn pr. kall, 600k pr. spørsmål), `search_app` (veiledning, egne data, enkeltdetaljer), `list_documents` (fasit for hvilke/hvor mange filer). Søketreff maks 3 sider pr. dokument. Samtalen mellomlagres (flyttende cache-markør).
- **AI-en leser ALT, uansett størrelse (bruker 20-11-2026: «uakseptabelt … AI skal lese alt som er på app … uansett størrelse og filtype»):** ingen terskler som utelater innhold. Innholdskort for alle filer med tekst (≤ 1500 tegn = hele teksten er kortet; store filer kortlegges i deler à 600k tegn og slås sammen). Regneark kuttes ikke. Alle bilder i Word/PowerPoint/OpenDocument til AI-en (bare < 1 kB hoppes over). Lesing pr. spørsmål opptil 2M tegn, 8 runder; «Spør dette dokumentet» sender hele dokumentet opptil 600k tegn. **Feieren `readDocSweep`** (hver 30. min, us-east1 — samme region som bøtta og readDocOnUpload) fullfører partial/pending/feilet lesing og manglende kort (`kortTodo`, høyst 3 forsøk), og kjører `kortAlle` én gang pr. `KORT_VER` (markør i `serverState/feier`) så eldre filer får kort uten at admin åpner appen; kjører :08 og :38, logg «Feiing» {lest, kort, omlest, hoppet} — opplasting setter `readStatus:'pending'`. «Ikke søkbar» = ikke lest (0 tegn, eller < 50 tegn i PDF/bilde uten AI-lesing), aldri «lite tekst». Diagrammer (Excel/Word/PowerPoint/OpenDocument) leses fra fila selv (tittel, type, verdiene som tabell — `diagramTekst` i filtyper.js); bilder i Excel og gamle .doc/.xls hentes ut (CFB-strømmene via SheetJS, hele JPEG/PNG; i .doc/.xls samlet til slutt). `FIL_VER` (les.js) = versjon av fil-leserne: ny versjon → feieren leser ferdige Office-filer på nytt én gang (markør `firms/{f}/serverState/feier`). Kjente grenser: WMF/EMF-tegninger i gamle Office-filer; ZIP/DWG har ingen tekst. Serverbibliotek: pdfjs-dist 6 (ES-modul → `import()`, lukkes med `task.destroy()`), sharp 0.35 — `npm audit` = 0 (20-11-2026).
- **Alle brukere** har AI; montører maks 50 spørsmål/dag (`aiUsage/{uid}_{dato}`), admin uten grense. Brukerens private API-kreditt; nøkkelen i Google Secret Manager (`ANTHROPIC_API_KEY`), aldri i appen.
- **Ny funksjon / ny side / endret oppførsel i appen → oppdater `app-guide.md`** (seksjon `## Tittel {#slug}`, `[admin]` på admin-seksjoner, valgfri `Åpne: #hash`) og publiser funksjonen. **Ny samling med brukerdata eller firmadata → legg den inn i `MINE` / `lastFirma()`** med riktig rolle (admin-data → `out.admin`).

## Ny versjon av nettsiden — ingen dra-ned-for-å-oppdatere (21-11-2026)

- **Dra-ned-for-å-oppdatere er AV i hele appen** (`overscroll-behavior-y: contain` på html/body i styles.css). Bruker: et uhell kastet ulagret arbeid i skjemaer/Timebok. Ikke slå det på igjen, og ikke lag en egen dra-ned-funksjon.
- I stedet ser appen selv etter ny versjon (script-ui.js, blokken **«NY VERSJON AV NETTSIDEN»**): henter `index.html` og sammenligner `?v=`-numrene med filene som kjører. Derfor er det ekstra viktig å bumpe `?v=` ved hver endring (se «Cache-versjon»).
  - Sjekkes når appen hentes fram fra bakgrunnen og hvert 15. min mens den er åpen.
  - Borte ≥ 5 min + står på Hjem/liste/Meny (ikke skjema), ingen popup, ikke trykket ennå → **stille omlasting**. Ellers banneret «Ny versjon er klar — Oppdater» (`#upd-banner`). Aldri automatisk omlasting midt i arbeid; «Oppdater» med ulagrede endringer → vanlig ulagret-varsel.
  - Meny › «Se etter oppdatering» (`updCheckNow`) viser versjonsnummeret (script-ui-nummeret, + APK-versjon i appen).

## Android-appen (Capacitor-skall, 21-11-2026 — bare Android, ikke iPhone)

- Mappa **`C:\Users\Igor\Desktop\Firesafe-app`** (IKKE i denne repoen; se README.txt der). Appen laster nettsiden fra GitHub Pages (`server.url`) → alt som publiseres her kommer i appen også. Ny APK bare når skallet endres.
- **Én kode:** app-forskjellene står i script-ui.js, blokken **«APP (Android-skall)»** (`_IN_APP`). Utenfor appen gjør den ingenting. Inni appen: `navigator.share`/`canShare` erstattes (dele-arket via native `Filer.share`), `<a download>` med blob:/data: fanges (også `a.click()` og jsPDF sin `dispatchEvent`) → Nedlastinger, «Åpne i annen app» = Androids «Åpne med» (`Filer.open`, med «Alltid»), Google/Microsoft-innlogging via telefonen (`_appSignIn`, kalles først i `signInWithGoogle`/`signInWithMicrosoft` i script.js; Microsoft byttes til innloggingstoken hos serverfunksjonen `appLogin`).
- **Ny kode som deler/laster ned:** bruk vanlig `navigator.share` / `<a download>` — da virker den automatisk i appen. Ikke bruk `window.open` på blob-adresser (virker ikke i appen).
- Tastatur: skallet (MainActivity.java) gir WebView samme oppførsel som Chrome med `interactive-widget=resizes-visual` (visualViewport krymper, siden beholder høyden) på WebView ≥ 139; eldre WebView = siden krymper. Statuslinje oransje, navigasjonslinje grå.
- Signeringsnøkkelen `firesafe-release.jks` + `keystore.properties` må aldri mistes (da kan appen ikke oppdateres).
- **Oppdateringer — nettside vs. APK (bruker 21-11-2026: «jeg ønsker at jeg blir informert når ny APK må installeres»):**
  - Endringer i denne repoen (HTML/CSS/JS/lang, pushet til GitHub) og i serverfunksjonene kommer **automatisk** i appen — ingen ny APK. Som i PWA-en kan appen måtte lukkes og åpnes igjen (service worker-cachen).
  - **Ny APK trengs BARE når skallet i `Desktop\Firesafe-app` endres:** native kode (MainActivity/FilerPlugin), AndroidManifest (tillatelser), Capacitor-plugins/-versjon, `capacitor.config.json`, ikon/navn/oppstartsbilde, `google-services.json`, signering.
  - **Plikt:** når en endring krever ny APK, si det TYDELIG i svaret (egen linje: «⚠ Krever ny APK»), øk `versionCode` (+1) / `versionName` i `android/app/build.gradle` og kjør `./bygg-apk.sh` i Firesafe-app. Skriptet legger APK-en i `app/Ordreseddel-<nr>.apk` + `app/version.json` i DENNE repoen (og `Firesafe-Ordreseddel.apk` i Firesafe-app). Når brukeren pusher, får appene **«Oppdater?»** neste gang de åpnes (`_appCheckUpdate` i APP-blokken → native `Filer.install` → Androids installasjonsboks; fra versjon 2 / 1.1 — eldre må installeres manuelt). Krever endringen IKKE ny APK, trenger det ikke nevnes.
  - Mappa `app/` (APK + version.json) skal ligge i repoen og publiseres — ikke slett den. Bare én APK der om gangen (skriptet fjerner gamle).
  - Ny web-kode som trenger en native funksjon som ikke finnes i den installerte APK-en: sjekk at funksjonen finnes før bruk (eldre APK skal ikke krasje), og si fra at ny APK trengs.

## GitHub Pages
Nettsiden hostes på: https://kiicki.github.io/Firesafe-ordreseddel/

## Firebase Console
Prosjekt: firesafe-ordreseddler
URL: https://console.firebase.google.com
