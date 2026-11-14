# Isover FireProtect — tabellene bak «Brannisolering stål»

Verktøyet *Verktøy → Brannisolering stål* (`script-ui.js`, `FP_*`) gir de samme svarene som
Isovers kalkulator **https://fireprotect.isover.se/**. Firmaet bruker den kalkulatoren som
referanse. Tallene kan ikke beregnes med en formel – de er hentet ut fra siden.

- `FP_MAX` – maks Ap/V per platetykkelse (20–60 mm) for hver R-klasse og kritisk temperatur
- `FP_APV` – Ap/V (avrundet heltall) for hver profil × dimensjon × sidevalg
- `FP_HSQ` – egen tabell for HSQ-bjelke (bunnflens, betong, temperatur → R = mm)

Første uttrekk: **13-11-2026**.

## Ukentlig sjekk (`check.js`)

`.github/workflows/fireprotect-check.yml` kjører `check.js` hver mandag. Den sammenligner et
utvalg mot tallene i `script-ui.js` (nytt utvalg hver uke):

- dimensjons- og temperaturlister
- ca. 230 Ap/V-verdier
- ca. 250 tykkelsesgrenser
- HSQ

Ved avvik eller feil opprettes en GitHub-sak, og eieren får e-post.

- Exit 0 = likt
- Exit 1 = endret
- Exit 2 = kunne ikke sjekke (f.eks. blokkert av Isovers botvern)

Kjøre lokalt (WSL, Chromium fra Playwright-cachen):

```bash
cd tools/fireprotect && npm install
EXE=~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell node check.js
```

(I WSL mangler `libasound.so.2`: `apt-get download libasound2t64`, pakk ut med
`dpkg-deb -x`, og sett `LD_LIBRARY_PATH` til `…/usr/lib/x86_64-linux-gnu`.)

## Full ny avlesning (når sjekken melder endring)

Kjøres fra `tools/fireprotect/update/`. Tar ca. 1 time. Siden er en Blazor Server-app, og
svarene kommer noen ganger forsinket. Derfor leses alt minst to ganger, og avvik leses på nytt
sakte.

1. `node profiles.js` → `profiles.json`: sidevalg, dimensjonslister og temperaturer per profilside
2. **Tykkelsesgrenser**
   - `node extract.js` → `maxtable.json`: binærsøk per (R, temp, tykkelse) via «Self-defined Ap/V»
   - `node verify.js` → `maxtable_verified.json`: sjekker v og v+1 sakte for hver celle og søker på nytt ved feil
   - `node rnd.js`: 160 tilfeldige oppslag mot den verifiserte tabellen. Skal gi `mismatches 0`.
3. **Ap/V**: minst to uavhengige runder, hver til sin logg
   - `node apv.js hea,heb,hem,ipe,ue,upe,upn,li,shs,rhs,chs,l 2> apv_run1.log`
   - samme kommando igjen med `2> apv_run2.log`
   - For lange lister (`l`) kan runden deles opp med `FROM=<indeks>`, med egen logg per del.
4. `node merge.js` → `apv_merged.json` + `disputes.json` (verdier der rundene er uenige)
5. `node resolve.js` → `resolved.json`: leser hver uenighet sakte to ganger
6. **HSQ**: `OUT=hsq_run1.json node hsq.js`, og deretter `OUT=hsq_run2.json node hsq.js`
7. `node gen.js` → `fpdata.js`: erstatt blokken `var FP_MAX … var FP_HSQ …;` i `script-ui.js` med denne
8. Kontroller i appen, og bump cache-versjoner (`script-ui.js?v=`, `CACHE_NAME`)

Har Isover lagt til nye profiltyper eller sidevalg, må `SIDES` (i `gen.js`, `check.js`),
`FP_SIDE_SETS` og `FP_TYPES` i `script-ui.js` oppdateres i tillegg.

Isover bruker Incapsula-botvern. `curl` blir blokkert, mens Chromium (headless) har fungert.
