# CLAUDE.md

Kontext pre prácu v tomto repozitári.

- **Čo to je:** multi-vertikálny rezervačný SaaS (salóny, barberi, kozmetika, masáže). Produktové
  rozhodnutia vychádzajú z `reports/Rezervačné systémy pre salóny.md`; nemeň ich bez dôvodu.
- **Monorepo:** pnpm workspaces. `packages/scheduling` (engine), `packages/db` (SQL migrácie +
  Kysely + booking servis), `packages/shared`, `apps/web` (Next.js 16 + worker).
- **Invarianty, ktoré sa nesmú porušiť:**
  - obsadenosť zdrojov je iba v `resource_block`; nikdy nezapisuj bloky mimo `createAppointment` /
    `holdSlot` / `addTimeOff`; exclusion constraint ostáva `WHERE (blocking)`;
  - každá tenantová query ide cez `withTenant()`; platformové tabuľky cez `withoutTenant()`;
  - timestamps z DB sú ISO UTC reťazce (pool.ts); lokálny čas iba cez luxon so zónou tenanta;
  - importy vnútri balíkov sú bez prípony (`./foo`, nie `./foo.js`) – vyžaduje to Turbopack.
- **Migrácie:** nové súbory `packages/db/migrations/NNNN_nazov.sql`, po nich aktualizuj
  `packages/db/src/schema.ts`. Migrátor beží ako vlastník DB; aplikácia ako `itckar_app`.
- **Testy:** `pnpm test` (db testy potrebujú lokálny Postgres, `DATABASE_URL_TEST`), engine má
  property-based testy – pri zmene engine ich nechaj bežať. E2E: `apps/web/e2e/booking-flow.mjs`.
- **Jazyk:** UI reťazce v `apps/web/src/lib/i18n.ts` (cs/sk/en); admin je zatiaľ SK.
- **Commity:** malé, popisné; CI beží typecheck, testy a build.
