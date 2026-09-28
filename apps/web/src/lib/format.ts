import { DateTime } from "luxon";

export function money(cents: number, currency: string, locale: string, from = false): string {
  const s = new Intl.NumberFormat(localeTag(locale), { style: "currency", currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
  return from ? `${localeWord(locale, "from")} ${s}` : s;
}

export function localeTag(locale: string): string {
  return { cs: "cs-CZ", sk: "sk-SK", en: "en-GB", de: "de-DE", pl: "pl-PL" }[locale] ?? locale;
}

function localeWord(locale: string, w: "from"): string {
  return ({ cs: { from: "od" }, sk: { from: "od" }, en: { from: "from" }, de: { from: "ab" }, pl: { from: "od" } } as Record<string, Record<string, string>>)[locale]?.[w] ?? w;
}

export function fmtTime(ms: number | string, zone: string, locale: string): string {
  return toDT(ms, zone).setLocale(localeTag(locale)).toFormat("HH:mm");
}

export function fmtDate(ms: number | string, zone: string, locale: string, style: "short" | "long" = "long"): string {
  const dt = toDT(ms, zone).setLocale(localeTag(locale));
  return style === "long" ? dt.toFormat("cccc d. LLLL yyyy") : dt.toFormat("d. L. yyyy");
}

export function fmtDateTime(ms: number | string, zone: string, locale: string): string {
  return `${fmtDate(ms, zone, locale, "short")} ${fmtTime(ms, zone, locale)}`;
}

export function toDT(ms: number | string, zone: string): DateTime {
  return typeof ms === "number" ? DateTime.fromMillis(ms, { zone }) : DateTime.fromISO(ms, { zone });
}

export function minutes(n: number, locale: string): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  const hour = { cs: "h", sk: "h", en: "h", de: "Std", pl: "h" }[locale] ?? "h";
  return m ? `${h} ${hour} ${m} min` : `${h} ${hour}`;
}

/** Parse "YYYY-MM-DD" in zone to local midnight ms, or today when invalid. */
export function dayFromParam(param: string | undefined, zone: string): DateTime {
  const dt = param ? DateTime.fromISO(param, { zone }) : DateTime.invalid("none");
  return (dt.isValid ? dt : DateTime.now().setZone(zone)).startOf("day");
}
