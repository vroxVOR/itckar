/**
 * Normalise a phone number typed by a client into E.164 for CZ/SK-first markets.
 * Returns null when the input cannot be a phone number.
 */
export function normalizePhone(raw: string, defaultCountry: "CZ" | "SK" | "PL" | "DE" | "AT" = "SK"): string | null {
  let s = raw.trim().replace(/[\s().-]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  const prefixes: Record<string, string> = { CZ: "+420", SK: "+421", PL: "+48", DE: "+49", AT: "+43" };
  if (!s.startsWith("+")) {
    // national formats: CZ/SK 9 digits (e.g. 900123456), possibly with a leading 0 elsewhere
    s = s.replace(/^0/, "");
    s = `${prefixes[defaultCountry]}${s}`;
  }
  if (!/^\+[1-9]\d{6,14}$/.test(s)) return null;
  return s;
}
