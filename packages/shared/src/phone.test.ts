import { describe, expect, it } from "vitest";
import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("handles national and international formats", () => {
    expect(normalizePhone("0900 123 456", "SK")).toBe("+421900123456");
    expect(normalizePhone("900123456", "SK")).toBe("+421900123456");
    expect(normalizePhone("777 123 456", "CZ")).toBe("+420777123456");
    expect(normalizePhone("+420 777-123-456")).toBe("+420777123456");
    expect(normalizePhone("00421 900 123 456")).toBe("+421900123456");
    expect(normalizePhone("(0)900123456", "SK")).toBe("+421900123456");
  });
  it("rejects garbage", () => {
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("+1")).toBeNull();
  });
});
