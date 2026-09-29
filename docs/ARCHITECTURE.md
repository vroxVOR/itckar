# Architektúra

## Zásady

1. **Databáza je zdroj pravdy pre obsadenosť.** Tabuľka `resource_block` má `tstzrange during`
   a `EXCLUDE USING GIST (tenant_id WITH =, resource_id WITH =, during WITH &&) WHERE (blocking)`.
   Dve súbežné transakcie nikdy nezapíšu prekrývajúci sa blok pre ten istý zdroj – bez ohľadu na
   to, čo si aplikácia myslela o dostupnosti. Engine dáva pekné dôvody, constraint dáva záruku.
2. **Jedna schéma, `tenant_id` všade, RLS.** Aplikácia sa pripája ako rola `itckar_app`
   (`NOBYPASSRLS`) a každá tenantová transakcia nastaví `SET LOCAL app.tenant_id` cez
   `withTenant()`. Bez kontextu neexistujú žiadne riadky. Verejné vstupy (slug, public token)
   idú cez `security definer` funkcie.
3. **Služba = segmenty × požiadavky na zdroje.** Segment má trvanie, druh (`active` /
   `processing`) a zoznam kľúčov požiadaviek, ktoré obsadzuje. Farbenie: nanesenie (staff+chair),
   pôsobenie (chair), úprava (staff+chair) – kaderník je počas pôsobenia voľný, kreslo nie.
   Buffery rozširujú obsadenosť prvého/posledného segmentu, ale nie dĺžku rezervácie.
4. **Čas:** inštancie ako `timestamptz` / epoch ms; rozvrhy ako lokálny čas + IANA zóna
   prevádzky, expandované po dňoch (DST-safe, testované na 2026-03-29 a 2026-10-25).
5. **Bez registrácie klienta.** Klient rezervuje menom a telefónom; správa termínu ide cez
   podpísaný `public_token` v odkaze. Marketingové súhlasy sa zaznamenávajú so zdrojom, verziou
   textu a IP (zákon 480/2004 Sb., §116 zákona 452/2021 Z. z.). Zdravotné poznámky (čl. 9 GDPR)
   sa ukladajú len pri aktívnom súhlase `health_notes`; po jeho odvolaní sa mažú.

## Tok rezervácie

```
/b/{slug}  →  availableSlots()  →  findSlots(engine)  →  klient vyberie slot
          →  bookAction  →  withTenant → createAppointment()
               ├─ purgeExpiredHolds, (releaseHold ak má token)
               ├─ resolveSlot(): checkSlot/findSlots pre presný start → dôvod chyby
               ├─ upsertClient (telefón/e-mail), consent rows
               ├─ appointment + appointment_item + appointment_segment
               ├─ resource_block (zlúčené intervaly per zdroj vrátane bufferov)  ← EXCLUDE
               ├─ audit_log
               └─ job: confirmation + reminder(s) (dedupe_key)
worker  →  claimJobs (FOR UPDATE SKIP LOCKED) → handlers → providers → notification rows
```

## Balíky

- `@itckar/scheduling` – žiadne závislosti okrem luxon; vstupom sú čisté dáta, výstupom sloty
  s priradením zdrojov a segmentmi. `findSlots` (mriežka zarovnaná na lokálnu polnoc),
  `checkSlot` (validácia konkrétneho slotu pred zápisom), `availableIntervals` (rozvrh → intervaly).
- `@itckar/db` – migrácie v SQL (`migrations/*.sql`, migrátor s advisory lockom), Kysely typy
  ručne udržiavané v `schema.ts`, booking servisná vrstva, auth (scrypt, session tabuľka),
  joby, seed.
- `apps/web` – Next.js 16. Server components na čítanie, server actions na zápis (tRPC/REST API
  príde vo fáze M5 pre partnerov a widget). Worker beží ako samostatný proces (`pnpm worker`).

## Prevádzka

- Postgres v EÚ (Neon/Supabase Frankfurt alebo Hetzner), `DATABASE_URL_ADMIN` pre migrácie,
  `DATABASE_URL` (rola `itckar_app`) pre aplikáciu a worker.
- Worker je idempotentný (dedupe_key), viac inštancií je bezpečných (SKIP LOCKED).
- Logy neobsahujú PII okrem console providerov v dev režime.


## Podržanie online termínu

Otvorenie posledného kroku spustí klientsku server action (POST) `acquireHoldAction`.
Samotné vykreslenie alebo prefetch stránky nezapisuje do databázy. `holdSlot`
vytvorí bloky na päť minút. Podpísaný token viaže tenant, poradie služieb,
čas, vybraného pracovníka a konkrétne priradené zdroje. `bookAction` tieto údaje
porovná s formulárom a odošle `holdToken` a pôvodné priradenia do `createAppointment`.
Databázový zámok chráni jednorazové spotrebovanie podržania; kontroluje sa aj expirácia.

Token sa uchováva v sessionStorage danej karty prehliadača. Obnovenie stránky
ho overí proti databáze a nemení jeho pôvodnú expiráciu. Pri vypnutej storage
funguje token v pamäti; obnovenie môže vyžadovať počkať na vypršanie pôvodného
podržania. Tlačidlo Späť ho uvoľní, zatvorenie karty ponechá päťminútovú expiráciu.
Obnova po vypršaní zachová vyplnené kontaktné údaje. Odpočet zohľadňuje rozdiel
medzi časom servera a zariadenia. Token nie je v URL a neobsahuje kontaktné údaje.

Cielený E2E test `apps/web/e2e/hold-flow.mjs` vyžaduje lokálnu, jednorazovú,
seedovanú databázu a bežiacu aplikáciu. Overí dva prehliadače, refresh, uvoľnenie,
expiráciu, obnovu a potvrdenie. Verejný rate limiting a overenie telefónu zostávajú
samostatným krokom roadmapy.


## Presun rezervácie

Admin presúva budúcu čakajúcu alebo potvrdenú rezerváciu v detaile alebo potiahnutím v kalendári s potvrdením. Presun nemení personál ani zdroje. Zachová uložené položky a ceny, posunie uložené segmenty aj bloky vrátane bufferov (neprepočítava historickú rezerváciu podľa dnešného cenníka). Overí aktuálne rozvrhy, výnimky, blokácie a aktívne holdy.

`rescheduleAppointment` v jednej tenantovej transakcii zamkne rezerváciu, overí pôvodný čas proti zastaranému formuláru, nahradí bloky chránené exclusion constraintom a zapíše audit. Zrušenie a zmena stavu používajú rovnaký riadkový zámok. Staré čakajúce pripomienky sa zrušia a nové dostanú jedinečné kľúče; worker odmietne úlohu so zastaraným časom. Rozbehnuté odoslanie externému poskytovateľovi nemožno vziať späť. Nový worker musí byť nasadený spolu s webom, aby spracoval `appointment.rescheduled`.

Čas sa interpretuje v pásme prevádzky. Formulár odmieta neexistujúce alebo dvojznačné miestne časy pri zmene letného času. Pri touch zariadeniach a klávesnici slúži formulár v detaile. Overenie: databázové testy plus `apps/web/e2e/reschedule-flow.mjs` proti lokálnej, jednorazovej databáze bez notifikačného workera.


## Čakatelia (M2, prvá verzia)

`waitlist_entry` je tenantová tabuľka s RLS a zloženými FK na klienta, personál a vytvorenú rezerváciu. Žiadosť vytvorí prihlásený personál po potvrdení, že klient požiadal o upozornenie. Vyberie existujúceho klienta, 1–6 online služieb, voliteľný personál, rozsah celých dní v pásme prevádzky a jeden kanál (e-mail alebo SMS). Presná aktívna duplicita je blokovaná unikátnym indexom. Verejné prihlasovanie zatiaľ nie je implementované.

Zrušenie rezervácie transakčne vytvorí samostatný job `waitlist.match`, nezávislý od doručenia správy o zrušení. Matcher v dávkach po 25 overí aktuálnu dostupnosť cez engine vrátane otváracích hodín, holdov, zdrojov a online pravidiel. Ponúkne len celý balík služieb, ktorý sa zmestí do uvoľneného intervalu a využíva niektorý z uvoľnených zdrojov. Zvyšné žiadosti spracuje pokračovací job. Riadkové zámky a verzie ponuky bránia dvojitému vytvoreniu notifikačných jobov.

`waitlist.notify` opäť preverí dostupnosť tesne pred odoslaním. Ak termín už nie je voľný, žiadosť vráti do stavu `waiting` a správu označí ako preskočenú. Pri dočasnom zlyhaní poskytovateľa sa opakuje existujúci job; úspešne zaznamenaná správa sa pri opakovaní neposiela znova. Ako pri ostatných notifikáciách, zlyhanie procesu medzi odoslaním poskytovateľovi a zápisom do DB môže viesť k duplicitnej správe; rozbehnuté odoslanie nemožno odvolať.

Odkaz `/w/{slug}/{token}` používa náhodný 192-bitový token, neobsahuje osobné údaje a GET nemá vedľajšie účinky. Klient môže čakanie ukončiť cez POST alebo pokračovať do existujúcej rezervácie s päťminútovým holdom. Ponuka sama termín neblokuje a môže ju dostať viac čakateľov. Úspešná rezervácia presného výberu označí žiadosť ako `booked` v rovnakej transakcii. Jedna žiadosť dostane najviac jednu úspešne odoslanú ponuku; ďalšie čakanie si vyžaduje novú žiadosť. Uplynulé obdobia sa v admin prehľade zobrazujú v histórii.

Nasadenie: najprv migrácia `0003_waitlist.sql`, potom web aj worker s podporou nových jobov. Ak nový worker ešte nie je nasadený, nové joby nesmie spracúvať stará verzia. Testovanie: `packages/db/src/waitlist.test.ts` a lokálny `apps/web/e2e/waitlist-flow.mts` (používa iba falošných poskytovateľov, nič externe neposiela).


## Limity verejných rezervačných akcií

Migrácia `0004_public_action_limits.sql` pridáva tenantovú tabuľku s RLS. Atomický upsert zdieľa počítadlá medzi procesmi aj replikami a používa hodiny PostgreSQL. Limity sa zapisujú v samostatnej transakcii pred rezervačnou operáciou; neúspešná alebo konfliktná rezervácia preto pokus nevráti. Prekročenie nemení koniec okna, počítadlo je zastropované a odpoveď obsahuje počet sekúnd do ďalšieho pokusu v cs/sk/en.

| Akcia | Klient | Prevádzka | Okno |
|---|---:|---:|---|
| Nový hold | 12 | 300 | 5 minút |
| Potvrdenie rezervácie | 8 | 120 | 10 minút |
| Verejné zrušenie | 20 | 120 | 10 minút |

Klientsky limit je podmienený dôveryhodnou konfiguráciou `RATE_LIMIT_IP_HEADER`. Nastavte ho až za proxy, ktorá hlavičku **prepíše**, odstráni hodnoty od klienta a zabráni priamemu prístupu na origin. Ak hostiteľ neposkytuje takúto záruku, ponechajte nastavenie prázdne. Aplikácia automaticky neverí `X-Forwarded-For`; zoznamy adries, porty a neplatné hodnoty odmietne. Bez overiteľnej adresy platí tenantový strop. IPv4-mapped IPv6 sa normalizuje na IPv4; IPv6 adresy sa zoskupujú podľa /64. Zdieľané siete sa delia o klientsky rozpočet.

Databáza uchováva iba HMAC identifikátor oddelený podľa tenanta (kľúč `SESSION_SECRET`), nie surové IP adresy. Rotácia tajomstva vytvorí nové rozpočty. Po prekročení tenantového stropu sa nové klientské počítadlá nevytvárajú; zablokovaný klient naopak nemíňa tenantový rozpočet. Expirácie staršie než deň sa priebežne mažú v obmedzených dávkach pri povolených požiadavkách tenanta. Neaktívnym tenantom sa záznamy odstránia pri ďalšej prevádzke alebo odstránení tenanta.

Opätovné použitie platného podpísaného holdu nie je nový hold a limit nemíňa. Uvoľnenie podpísaného holdu ani ukončenie čakania cez tajný odkaz neblokujeme; obe sú idempotentné a nemajú vytvárať ďalšiu záťaž alebo notifikácie. Táto vrstva chráni rezervácie, nie všeobecné čítania, prihlasovanie či registráciu. V produkcii dopĺňa limity na proxy, nenahrádza ochranu pred sieťovým DDoS. SMS overenie telefónu je samostatný nasledujúci krok.

Nasadenie: najprv migrácia 0004, potom web. `SESSION_SECRET` musí byť rovnaký na všetkých replikách. Limity sa pri výpadku DB neobchádzajú. E2E test `apps/web/e2e/public-limits-flow.mts` používa samostatnú lokálnu DB a server s testovacou hlavičkou `RATE_LIMIT_IP_HEADER=x-test-client-ip`; nie je určený pre produkčný server.
