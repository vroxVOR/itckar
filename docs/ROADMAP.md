# Roadmapa (podľa reportu, sekcia „Odporúčanie“)

| Fáza | Rozsah | Stav |
|---|---|---|
| **M1–M2 Engine + kalendár** | Postgres s `resource_block` + exclusion constraint + RLS; služby so segmentmi, zdroje, rozvrhy/výnimky/dovolenky, buffery, holdy s TTL; admin kalendár deň/týždeň; hostovaná rezervačná stránka bez registrácie; e-mail + SMS pripomienky; cs/sk/en | ✅ hotové (čakatelia: prvá verzia spravovaná prevádzkou) |
| **M3 Peniaze + klienti** | Stripe Connect Express, zálohy, karta na súbore (SetupIntent → MIT no-show poplatok), doklad §16, klientská karta s históriou, GDPR export/mazanie, import CSV z Reservio/Bookio/Notino/Fresha | ⏳ |
| **M4 Distribúcia** | Google/Microsoft obojsmerný sync, iCal feedy, widget (iframe/web component), subdomény + CNAME, Google Business Profile link, Instagram bio link | ⏳ |
| **M5 Otvorenosť** | verejné REST API s OpenAPI, webhooky, Reserve with Google (Business Link), WhatsApp utility šablóny, rebooking pri odchode, waitlist | ⏳ |
| **M6 Mobil + reporty** | Expo app pre personál, reporty (obsadenosť, tržby, no-show), účtovné exporty, eKasa (SR) | ⏳ |
| **M7–M9 Rast** | AI recepčná chat → hlas, no-show scoring, marketingové automatizácie so súhlasmi, RwG end-to-end, booth-renter režim, multi-lokalita | ⏳ |

## Najbližšie kroky (M1 dokončenie → M2)

1. ✅ Presun rezervácie potiahnutím v kalendári a formulárom v detaile. Zachová personál, služby a cenu; preverí dostupnosť, preplánuje pripomienky a oznámi nový čas. Zmena personálu ostáva samostatným budúcim rozšírením.
2. ✅ Čakatelia: pridanie prevádzkou na žiadosť klienta, služby/personál/obdobie, overenie uvoľneného termínu, e-mail alebo SMS, odkaz na rezerváciu a ukončenie čakania. Verejné samoobslužné prihlásenie a časové preferencie v rámci dňa sú ďalšie rozšírenia.
3. ✅ Päťminútové podržanie termínu počas vypĺňania formulára: odpočet, opätovné overenie po vypršaní, uvoľnenie cez Späť a podpísané naviazanie na výber.
4. ✅ Databázové limity nových holdov, potvrdení rezervácie a verejného rušenia; tenantový strop + klientsky limit pri dôveryhodnej proxy. ⏳ Overenie telefónu SMS kódom pri prvej rezervácii.
5. Vlastná doména / white-label branding v platenom pláne.
6. Overenie cenníkov konkurencie a §116 novely na citovaných URL (viď report, „Metodologické obmedzenia“).
