# Roadmapa (podľa reportu, sekcia „Odporúčanie“)

| Fáza | Rozsah | Stav |
|---|---|---|
| **M1–M2 Engine + kalendár** | Postgres s `resource_block` + exclusion constraint + RLS; služby so segmentmi, zdroje, rozvrhy/výnimky/dovolenky, buffery, holdy s TTL; admin kalendár deň/týždeň; hostovaná rezervačná stránka bez registrácie; e-mail + SMS pripomienky; cs/sk/en | ✅ hotové (drag-and-drop v kalendári a zoznam čakateľov ešte nie) |
| **M3 Peniaze + klienti** | Stripe Connect Express, zálohy, karta na súbore (SetupIntent → MIT no-show poplatok), doklad §16, klientská karta s históriou, GDPR export/mazanie, import CSV z Reservio/Bookio/Notino/Fresha | ⏳ |
| **M4 Distribúcia** | Google/Microsoft obojsmerný sync, iCal feedy, widget (iframe/web component), subdomény + CNAME, Google Business Profile link, Instagram bio link | ⏳ |
| **M5 Otvorenosť** | verejné REST API s OpenAPI, webhooky, Reserve with Google (Business Link), WhatsApp utility šablóny, rebooking pri odchode, waitlist | ⏳ |
| **M6 Mobil + reporty** | Expo app pre personál, reporty (obsadenosť, tržby, no-show), účtovné exporty, eKasa (SR) | ⏳ |
| **M7–M9 Rast** | AI recepčná chat → hlas, no-show scoring, marketingové automatizácie so súhlasmi, RwG end-to-end, booth-renter režim, multi-lokalita | ⏳ |

## Najbližšie kroky (M1 dokončenie → M2)

1. Drag-and-drop presun rezervácie v kalendári (`ignoreRef` v engine už presun podporuje).
2. Zoznam čakateľov na zrušené termíny (job `appointment.cancelled` → notifikácia čakateľom).
3. Hold slotu počas vypĺňania formulára (`holdSlot` existuje v db vrstve, UI ho zatiaľ nepoužíva).
4. Rate limiting verejných akcií a overenie telefónu (SMS kód) pri prvej rezervácii.
5. Vlastná doména / white-label branding v platenom pláne.
6. Overenie cenníkov konkurencie a §116 novely na citovaných URL (viď report, „Metodologické obmedzenia“).
