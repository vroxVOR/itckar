"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthError, authenticate, createSession, tenantsForUser } from "@itckar/db";
import { db } from "@/lib/db";
import { setSessionCookie } from "@/lib/session";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export type LoginState = { error?: string } | undefined;

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Zadajte platný e-mail a heslo." };
  try {
    const user = await authenticate(db(), parsed.data.email, parsed.data.password);
    const tenants = await tenantsForUser(db(), user.id);
    const session = await createSession(db(), user.id, tenants.length === 1 ? tenants[0]!.id : undefined);
    await setSessionCookie(session.id, session.expiresAt);
  } catch (e) {
    if (e instanceof AuthError) return { error: "Nesprávny e-mail alebo heslo." };
    throw e;
  }
  redirect("/app");
}
