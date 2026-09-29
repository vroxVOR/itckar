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
