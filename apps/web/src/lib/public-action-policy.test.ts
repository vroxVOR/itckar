import { expect, it } from "vitest";
import { canonicalClientAddress, publicActionKey } from "./public-action-policy";

it("rejects forwarding chains, invalid addresses, ports and scoped IPv6 values", () => {
  for (const value of [
    null,
    "",
    "unknown",
    "1.2.3.4, 5.6.7.8",
    "1.2.3.4:8000",
    "fe80::1%eth0",
    "[::1]",
    "x".repeat(500),
  ])
    expect(canonicalClientAddress(value)).toBeNull();
});
it("normalizes IPv4-mapped addresses and shares IPv6 privacy addresses within a /64", () => {
  expect(canonicalClientAddress(" 192.0.2.1 ")).toBe("192.0.2.1");
  expect(canonicalClientAddress("::ffff:192.0.2.1")).toBe("192.0.2.1");
  expect(canonicalClientAddress("::ffff:c000:201")).toBe("192.0.2.1");
  expect(canonicalClientAddress("2001:DB8:1:2::1")).toBe(
    canonicalClientAddress("2001:0db8:0001:0002:ffff::9"),
  );
  expect(canonicalClientAddress("2001:db8:1:3::1")).not.toBe(
    canonicalClientAddress("2001:db8:1:2::1"),
  );
});
it("stores only keyed, tenant-separated identifiers and requires a configured secret", () => {
  const secret = "test-rate-limit-secret";
  const key = publicActionKey(secret, "tenant-a", "client:192.0.2.1");
  expect(key).toMatch(/^[a-f0-9]{64}$/);
  expect(key).not.toContain("192.0.2.1");
  expect(publicActionKey(secret, "tenant-b", "client:192.0.2.1")).not.toBe(key);
  expect(publicActionKey(secret + "changed", "tenant-a", "client:192.0.2.1")).not.toBe(key);
  expect(() => publicActionKey("", "tenant-a", "tenant")).toThrow();
});
