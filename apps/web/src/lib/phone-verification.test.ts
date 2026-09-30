import { afterEach, expect, it, vi } from "vitest";
import { bookingPhone, phoneDemoMode, phoneHash } from "./phone-verification";
afterEach(() => vi.unstubAllEnvs());
it("normalizes country formats to one phone identity", () => {
  expect(bookingPhone("0900 123 456", "SK")).toBe("+421900123456");
  expect(bookingPhone("777123456", "CZ")).toBe("+420777123456");
  expect(bookingPhone("bad", "SK")).toBeNull();
});
it("separates tenants, tokens and code hashes and requires a secret", () => {
  vi.stubEnv("SESSION_SECRET", "test-phone-secret-12345678");
  const a = phoneHash("tenant", "phone", "+421900123456");
  expect(a).toMatch(/^[a-f0-9]{64}$/);
  expect(a).not.toBe(phoneHash("other", "phone", "+421900123456"));
  expect(a).not.toBe(phoneHash("tenant", "token", "+421900123456"));
  vi.stubEnv("SESSION_SECRET", "");
  expect(() => phoneHash("tenant", "phone", "123")).toThrow();
});
it("permits demo codes only with explicit mode and a loopback APP_URL", () => {
  vi.stubEnv("APP_URL", "http://127.0.0.1:3005");
  vi.stubEnv("PHONE_VERIFICATION_MODE", "required");
  expect(phoneDemoMode()).toBe(false);
  vi.stubEnv("PHONE_VERIFICATION_MODE", "demo");
  expect(phoneDemoMode()).toBe(true);
  vi.stubEnv("APP_URL", "https://example.com");
  expect(phoneDemoMode()).toBe(false);
  vi.stubEnv("APP_URL", "http://127.0.0.1.evil.test");
  expect(phoneDemoMode()).toBe(false);
});
it("binds remembered proof to tenant, phone, expiry and demo mode", async () => {
  const { rememberedPhone, hasRememberedPhone } = await import("./phone-verification");
  vi.stubEnv("SESSION_SECRET", "test-phone-secret-12345678");
  vi.stubEnv("PHONE_VERIFICATION_MODE", "required");
  const key = phoneHash("tenant", "phone", "+421900123456");
  const now = 1000000;
  const cookie = rememberedPhone("tenant", key, now);
  expect(hasRememberedPhone("tenant", key, cookie, now)).toBe(true);
  expect(hasRememberedPhone("other", key, cookie, now)).toBe(false);
  expect(hasRememberedPhone("tenant", "a".repeat(64), cookie, now)).toBe(false);
  expect(hasRememberedPhone("tenant", key, cookie, now + 31 * 86400000)).toBe(false);
  expect(hasRememberedPhone("tenant", key, cookie + "x", now)).toBe(false);
  vi.stubEnv("PHONE_VERIFICATION_MODE", "demo");
  vi.stubEnv("APP_URL", "http://127.0.0.1");
  expect(hasRememberedPhone("tenant", key, cookie, now)).toBe(false);
});

it("does not accept a demo code hash after switching to real SMS mode", () => {
  vi.stubEnv("SESSION_SECRET", "test-phone-secret-12345678");
  vi.stubEnv("APP_URL", "http://127.0.0.1");
  vi.stubEnv("PHONE_VERIFICATION_MODE", "demo");
  const demoHash = phoneHash("tenant", "code", "token:123456");
  vi.stubEnv("PHONE_VERIFICATION_MODE", "required");
  expect(phoneHash("tenant", "code", "token:123456")).not.toBe(demoHash);
});
