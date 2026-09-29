import { createHmac, timingSafeEqual } from "node:crypto";
import type { Assignment } from "@itckar/scheduling";

export interface HoldSelection {
  slug: string;
  serviceIds: string[];
  staffId: string;
  startMs: number;
}
export interface HoldTicket extends HoldSelection {
  tenantId: string;
  holdToken: string;
  expiresAt: number;
  assignments: Assignment[];
}

function signature(body: string, secret: string): string {
  if (secret.length < 16) throw new Error("SESSION_SECRET must be set (>= 16 chars)");
  return createHmac("sha256", secret).update(`booking-hold:v1:${body}`).digest("base64url");
}

/** Signed capability: a browser cannot change the held time, services or resources. */
export function signHold(ticket: HoldTicket, secret: string): string {
  const body = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${body}.${signature(body, secret)}`;
}

export function readHold(raw: unknown, secret: string, now = Date.now()): HoldTicket | null {
  if (typeof raw !== "string" || !raw || raw.length > 32_768) return null;
  const [body, sig, extra] = raw.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = signature(body, secret);
  if (Buffer.byteLength(sig) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const ticket = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as HoldTicket;
    return Number.isFinite(ticket.expiresAt) && ticket.expiresAt > now ? ticket : null;
  } catch { return null; }
}

export function matchesHold(ticket: HoldTicket, tenantId: string, selection: HoldSelection): boolean {
  return ticket.tenantId === tenantId && ticket.slug === selection.slug && ticket.startMs === selection.startMs
    && ticket.staffId === selection.staffId && JSON.stringify(ticket.serviceIds) === JSON.stringify(selection.serviceIds);
}
