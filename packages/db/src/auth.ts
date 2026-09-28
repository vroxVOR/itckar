import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { sql } from "kysely";
import type { Db } from "./db.js";
import { withoutTenant } from "./db.js";
import type { MembershipRole, Tenant, UserAccount } from "./schema.js";

const scrypt = promisify(scryptCb);
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password.normalize("NFKC"), salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !keyB64) return false;
  const key = (await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), 64)) as Buffer;
  const expected = Buffer.from(keyB64, "base64");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export class AuthError extends Error {
  constructor(public readonly code: "email_taken" | "invalid_credentials" | "weak_password" | "slug_taken") {
    super(code);
    this.name = "AuthError";
  }
}

export async function registerUser(
  db: Db,
  u: { email: string; password: string; name: string; locale?: string },
): Promise<UserAccount> {
  if (u.password.length < 8) throw new AuthError("weak_password");
  const password_hash = await hashPassword(u.password);
  return withoutTenant(db, async (tx) => {
    const exists = await tx
      .selectFrom("user_account")
      .select("id")
      .where(sql<boolean>`lower(email) = lower(${u.email})`)
      .executeTakeFirst();
    if (exists) throw new AuthError("email_taken");
    return tx
      .insertInto("user_account")
      .values({ email: u.email.trim(), password_hash, name: u.name.trim(), locale: u.locale ?? "cs" })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}

export async function authenticate(db: Db, email: string, password: string): Promise<UserAccount> {
  const user = await withoutTenant(db, (tx) =>
    tx
      .selectFrom("user_account")
      .selectAll()
      .where(sql<boolean>`lower(email) = lower(${email.trim()})`)
      .executeTakeFirst(),
  );
  if (!user || !(await verifyPassword(password, user.password_hash))) throw new AuthError("invalid_credentials");
  return user;
}

export async function createSession(db: Db, userId: string, tenantId?: string): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const row = await withoutTenant(db, (tx) =>
    tx
      .insertInto("session")
      .values({ user_id: userId, tenant_id: tenantId ?? null, expires_at: expiresAt })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return { id: row.id, expiresAt };
}

export interface SessionInfo {
  sessionId: string;
  user: Pick<UserAccount, "id" | "email" | "name" | "locale">;
  tenant: Tenant | null;
  role: MembershipRole | null;
}

export async function getSession(db: Db, sessionId: string): Promise<SessionInfo | null> {
  return withoutTenant(db, async (tx) => {
    const s = await tx
      .selectFrom("session")
      .innerJoin("user_account", "user_account.id", "session.user_id")
      .select([
        "session.id as sid",
        "session.tenant_id",
        "user_account.id",
        "user_account.email",
        "user_account.name",
        "user_account.locale",
      ])
      .where("session.id", "=", sessionId)
      .where("session.expires_at", ">", new Date().toISOString())
      .executeTakeFirst();
    if (!s) return null;
    let tenant: Tenant | null = null;
    let role: MembershipRole | null = null;
    if (s.tenant_id) {
      const m = await tx
        .selectFrom("membership")
        .select("role")
        .where("user_id", "=", s.id)
        .where("tenant_id", "=", s.tenant_id)
        .executeTakeFirst();
      if (m) {
        role = m.role;
        await sql`select set_config('app.tenant_id', ${s.tenant_id}, true)`.execute(tx);
        tenant = (await tx.selectFrom("tenant").selectAll().where("id", "=", s.tenant_id).executeTakeFirst()) ?? null;
        await sql`select set_config('app.tenant_id', '', true)`.execute(tx);
      }
    }
    return {
      sessionId: s.sid,
      user: { id: s.id, email: s.email, name: s.name, locale: s.locale },
      tenant,
      role,
    };
  });
}

export async function selectTenantForSession(db: Db, sessionId: string, userId: string, tenantId: string): Promise<void> {
  await withoutTenant(db, async (tx) => {
    const m = await tx
      .selectFrom("membership")
      .select("role")
      .where("user_id", "=", userId)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    if (!m) throw new AuthError("invalid_credentials");
    await tx.updateTable("session").set({ tenant_id: tenantId }).where("id", "=", sessionId).execute();
  });
}

export async function destroySession(db: Db, sessionId: string): Promise<void> {
  await withoutTenant(db, (tx) => tx.deleteFrom("session").where("id", "=", sessionId).execute());
}

export async function tenantsForUser(db: Db, userId: string) {
  const r = await sql<{ id: string; slug: string; name: string; role: MembershipRole }>`
    select * from tenants_for_user(${userId})`.execute(db);
  return r.rows;
}

export async function createTenantWithOwner(
  db: Db,
  t: { slug: string; name: string; timezone?: string; locale?: string; currency?: string; country?: string; vertical?: string },
  ownerId: string,
): Promise<string> {
  try {
    const r = await sql<{ id: string }>`select create_tenant_with_owner(
      ${t.slug}, ${t.name}, ${t.timezone ?? "Europe/Prague"}, ${t.locale ?? "cs"},
      ${t.currency ?? "CZK"}, ${t.country ?? "CZ"}, ${t.vertical ?? "hair"}, ${ownerId}) as id`.execute(db);
    return r.rows[0]!.id;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new AuthError("slug_taken");
    throw e;
  }
}

export async function publicTenantBySlug(db: Db, slug: string): Promise<Tenant | null> {
  const r = await sql<Tenant>`select * from public_tenant_by_slug(${slug})`.execute(db);
  return r.rows[0] ?? null;
}

export async function tenantIdForPublicToken(db: Db, token: string): Promise<string | null> {
  const r = await sql<{ id: string | null }>`select tenant_id_for_public_token(${token}) as id`.execute(db);
  return r.rows[0]?.id ?? null;
}
