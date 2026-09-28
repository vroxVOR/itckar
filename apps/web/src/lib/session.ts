import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSession, type SessionInfo, type Tenant } from "@itckar/db";
import { db } from "./db";

const COOKIE = "itckar_session";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set (>= 16 chars)");
  return s;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function encodeSessionCookie(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

export function decodeSessionCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf(".");
  if (idx <= 0) return null;
  const id = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = sign(id);
  if (sig.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null;
}

export async function setSessionCookie(sessionId: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, encodeSessionCookie(sessionId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function currentSession(): Promise<SessionInfo | null> {
  const jar = await cookies();
  const id = decodeSessionCookie(jar.get(COOKIE)?.value);
  if (!id) return null;
  return getSession(db(), id);
}

export async function requireUser(): Promise<SessionInfo> {
  const s = await currentSession();
  if (!s) redirect("/login");
  return s;
}

export interface TenantSession extends SessionInfo {
  tenant: Tenant;
  role: NonNullable<SessionInfo["role"]>;
}

/** Logged in AND a tenant selected; otherwise go to the tenant chooser / onboarding. */
export async function requireTenant(): Promise<TenantSession> {
  const s = await requireUser();
  if (!s.tenant || !s.role) redirect("/onboarding");
  return s as TenantSession;
}
