import { describe, expect, it } from "vitest";
import { matchesHold, readHold, signHold, type HoldTicket } from "./booking-hold";
const secret = "test-only-session-secret-12345";
const ticket: HoldTicket = {
  slug: "salon", tenantId: "tenant-a", serviceIds: ["cut", "color"], staffId: "anna", startMs: 1000,
  holdToken: "private-hold-token", expiresAt: 5000, assignments: [],
};
describe("booking hold capability", () => {
  it("accepts only the original signed payload before expiry", () => {
    const raw = signHold(ticket, secret);
    expect(readHold(raw, secret, 4999)).toEqual(ticket);
    expect(readHold(raw, secret, 5000)).toBeNull();
    expect(readHold(raw, "another-secret-value", 1000)).toBeNull();
    const [, signature] = raw.split(".");
    const changed = Buffer.from(JSON.stringify({ ...ticket, startMs: 9999 })).toString("base64url");
    expect(readHold(`${changed}.${signature}`, secret, 1000)).toBeNull();
  });
  it("rejects malformed and multibyte signatures without throwing", () => {
    const [body] = signHold(ticket, secret).split(".");
    for (const raw of [null, {}, 123, "", "x", "x.y.z", `${body}.${"é".repeat(43)}`, "x".repeat(33000)]) {
      expect(readHold(raw, secret, 1000)).toBeNull();
    }
  });
  it("binds the capability to tenant, ordered services, staff and exact time", () => {
    expect(matchesHold(ticket, "tenant-a", ticket)).toBe(true);
    expect(matchesHold(ticket, "tenant-b", ticket)).toBe(false);
    for (const change of [{ slug: "other" }, { serviceIds: ["color", "cut"] }, { staffId: "eva" }, { startMs: 1001 }]) {
      expect(matchesHold(ticket, "tenant-a", { ...ticket, ...change })).toBe(false);
    }
  });
});
