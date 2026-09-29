import { describe, expect, it } from "vitest";
import { confirmationEmail, confirmationSms, reminderSms, waitlistMessage } from "./templates";

const input = {
  locale: "sk",
  tenantName: "Salón Demo",
  startIso: "2026-03-23T09:00:00.000Z",
  zone: "Europe/Bratislava",
  services: ["Dámsky strih"],
  staff: ["Anna"],
  manageUrl: "https://itckar.example/r/abc",
  address: "Hlavná 1, Bratislava",
  phone: "+421900000000",
};

describe("notification templates", () => {
  it("renders local time in the tenant zone and the manage link", () => {
    const sms = confirmationSms(input);
    expect(sms).toContain("pondelok 23. 3. 2026 10:00");
    expect(sms).toContain("https://itckar.example/r/abc");
    expect(sms.length).toBeLessThan(200);
  });
  it("localises", () => {
    expect(confirmationSms({ ...input, locale: "cs" })).toContain("rezervace potvrzena");
    expect(confirmationSms({ ...input, locale: "en" })).toContain("booking confirmed");
    expect(reminderSms({ ...input, hoursBefore: 24 })).toMatch(/^Pripomienka/);
  });
  it("email includes staff and address", () => {
    const e = confirmationEmail(input);
    expect(e.subject).toBe("Potvrdenie rezervácie – Salón Demo");
    expect(e.text).toContain("Kto: Anna");
    expect(e.text).toContain("Kde: Hlavná 1");
  });
});

it("waitlist offers explain that the slot is not reserved in each supported locale", () => {
  expect(waitlistMessage(input).text).toContain("Ponuka nie je rezervácia");
  expect(waitlistMessage({ ...input, locale: "cs" }).text).toContain("Nabídka není rezervace");
  expect(waitlistMessage({ ...input, locale: "en" }).text).toContain("This is not a reservation");
  expect(waitlistMessage(input).text).toContain(input.manageUrl);
});
