import { DateTime } from "luxon";

export type Locale = "cs" | "sk" | "en";

export interface TemplateInput {
  locale: string;
  tenantName: string;
  startIso: string;
  zone: string;
  services: string[];
  staff?: string[] | undefined;
  manageUrl: string;
  address?: string | null | undefined;
  phone?: string | null | undefined;
}

const L = (l: string): Locale => (l === "sk" || l === "en" ? l : "cs");
const tag = { cs: "cs-CZ", sk: "sk-SK", en: "en-GB" } as const;

function when(i: TemplateInput): string {
  const dt = DateTime.fromISO(i.startIso, { zone: i.zone }).setLocale(tag[L(i.locale)]);
  return `${dt.toFormat("cccc d. L. yyyy")} ${dt.toFormat("HH:mm")}`;
}

export function confirmationSms(i: TemplateInput): string {
  const w = when(i);
  const svc = i.services.join(", ");
  return {
    cs: `${i.tenantName}: rezervace potvrzena – ${w}, ${svc}. Změna/zrušení: ${i.manageUrl}`,
    sk: `${i.tenantName}: rezervácia potvrdená – ${w}, ${svc}. Zmena/zrušenie: ${i.manageUrl}`,
    en: `${i.tenantName}: booking confirmed – ${w}, ${svc}. Manage: ${i.manageUrl}`,
  }[L(i.locale)];
}

export function reminderSms(i: TemplateInput & { hoursBefore: number }): string {
  const w = when(i);
  return {
    cs: `Připomínka: ${i.tenantName} ${w} (${i.services.join(", ")}). Nemůžete dorazit? ${i.manageUrl}`,
    sk: `Pripomienka: ${i.tenantName} ${w} (${i.services.join(", ")}). Nemôžete prísť? ${i.manageUrl}`,
    en: `Reminder: ${i.tenantName} ${w} (${i.services.join(", ")}). Can't make it? ${i.manageUrl}`,
  }[L(i.locale)];
}

export function cancelledSms(i: TemplateInput): string {
  const w = when(i);
  return {
    cs: `${i.tenantName}: rezervace ${w} byla zrušena.`,
    sk: `${i.tenantName}: rezervácia ${w} bola zrušená.`,
    en: `${i.tenantName}: your booking on ${w} was cancelled.`,
  }[L(i.locale)];
}

export function confirmationEmail(i: TemplateInput): { subject: string; text: string } {
  const w = when(i);
  const l = L(i.locale);
  const subject = { cs: `Potvrzení rezervace – ${i.tenantName}`, sk: `Potvrdenie rezervácie – ${i.tenantName}`, en: `Booking confirmed – ${i.tenantName}` }[l];
  const lines = [
    { cs: `Vaše rezervace je potvrzena.`, sk: `Vaša rezervácia je potvrdená.`, en: `Your booking is confirmed.` }[l],
    "",
    `${{ cs: "Kdy", sk: "Kedy", en: "When" }[l]}: ${w}`,
    `${{ cs: "Služby", sk: "Služby", en: "Services" }[l]}: ${i.services.join(", ")}`,
    ...(i.staff?.length ? [`${{ cs: "Kdo", sk: "Kto", en: "With" }[l]}: ${i.staff.join(", ")}`] : []),
    ...(i.address ? [`${{ cs: "Kde", sk: "Kde", en: "Where" }[l]}: ${i.address}`] : []),
    "",
    `${{ cs: "Změna nebo zrušení", sk: "Zmena alebo zrušenie", en: "Manage or cancel" }[l]}: ${i.manageUrl}`,
    ...(i.phone ? [`${{ cs: "Telefon", sk: "Telefón", en: "Phone" }[l]}: ${i.phone}`] : []),
  ];
  return { subject, text: lines.join("\n") };
}

export function reminderEmail(i: TemplateInput & { hoursBefore: number }): { subject: string; text: string } {
  const c = confirmationEmail(i);
  const l = L(i.locale);
  return {
    subject: { cs: `Připomínka termínu – ${i.tenantName}`, sk: `Pripomienka termínu – ${i.tenantName}`, en: `Appointment reminder – ${i.tenantName}` }[l],
    text: c.text.replace(/^[^\n]*\n/, { cs: "Připomínáme váš termín.\n", sk: "Pripomíname váš termín.\n", en: "A reminder of your appointment.\n" }[l]),
  };
}

export function cancelledEmail(i: TemplateInput): { subject: string; text: string } {
  const l = L(i.locale);
  return {
    subject: { cs: `Rezervace zrušena – ${i.tenantName}`, sk: `Rezervácia zrušená – ${i.tenantName}`, en: `Booking cancelled – ${i.tenantName}` }[l],
    text: cancelledSms(i),
  };
}

export function rescheduledSms(i: TemplateInput): string {
  return {
    cs: `${i.tenantName}: nový termín rezervace – ${when(i)}, ${i.services.join(", ")}. Správa: ${i.manageUrl}`,
    sk: `${i.tenantName}: nový termín rezervácie – ${when(i)}, ${i.services.join(", ")}. Správa: ${i.manageUrl}`,
    en: `${i.tenantName}: booking rescheduled to ${when(i)}, ${i.services.join(", ")}. Manage: ${i.manageUrl}`,
  }[L(i.locale)];
}

export function rescheduledEmail(i: TemplateInput): { subject: string; text: string } {
  return {
    subject: { cs: `Změna termínu – ${i.tenantName}`, sk: `Zmena termínu – ${i.tenantName}`, en: `Booking rescheduled – ${i.tenantName}` }[L(i.locale)],
    text: rescheduledSms(i),
  };
}
