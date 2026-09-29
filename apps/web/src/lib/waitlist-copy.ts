const copy = {
  sk: {
    offerExpired: "Ponúknutý termín už uplynul. Vyberte nový termín alebo kontaktujte prevádzku.",
    title: "Uvoľnený termín",
    waiting: "Čakáte na vhodný termín.",
    ended: "Čakanie bolo ukončené.",
    booked: "Vaša rezervácia bola vytvorená.",
    expired: "Obdobie čakania uplynulo.",
    note: "Toto ešte nie je rezervácia. Dostupnosť overíme v ďalšom kroku; počas vypĺňania údajov termín podržíme na päť minút.",
    book: "Overiť a rezervovať termín",
    stop: "Ukončiť čakanie",
    from: "Požadované obdobie",
    other: "Vybrať iný termín",
  },
  cs: {
    offerExpired: "Nabídnutý termín už uplynul. Vyberte nový termín nebo kontaktujte provozovnu.",
    title: "Uvolněný termín",
    waiting: "Čekáte na vhodný termín.",
    ended: "Čekání bylo ukončeno.",
    booked: "Vaše rezervace byla vytvořena.",
    expired: "Období čekání uplynulo.",
    note: "Toto ještě není rezervace. Dostupnost ověříme v dalším kroku; během vyplňování údajů termín podržíme na pět minut.",
    book: "Ověřit a rezervovat termín",
    stop: "Ukončit čekání",
    from: "Požadované období",
    other: "Vybrat jiný termín",
  },
  en: {
    offerExpired:
      "The offered appointment has passed. Choose another appointment or contact the business.",
    title: "An appointment is available",
    waiting: "You are waiting for a suitable appointment.",
    ended: "You have left the waitlist.",
    booked: "Your booking has been created.",
    expired: "Your requested date range has ended.",
    note: "This is not yet a reservation. Availability is checked in the next step; we will hold the appointment for five minutes while you fill in your details.",
    book: "Check and book appointment",
    stop: "Leave the waitlist",
    from: "Requested dates",
    other: "Choose another appointment",
  },
};
export const waitlistCopy = (locale: string) =>
  copy[locale === "sk" || locale === "en" ? locale : "cs"];
