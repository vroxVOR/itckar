"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthError, createSession, registerUser } from "@itckar/db";
import { db } from "@/lib/db";
import { setSessionCookie } from "@/lib/session";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export type RegisterState = { error?: string } | undefined;

export async function registerAction(_prev: RegisterState, form: FormData): Promise<RegisterState> {
  const parsed = schema.safeParse({ name: form.get("name"), email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Vyplňte meno, platný e-mail a heslo (min. 8 znakov)." };
  try {
    const user = await registerUser(db(), parsed.data);
    const session = await createSession(db(), user.id);
    await setSessionCookie(session.id, session.expiresAt);
  } catch (e) {
    if (e instanceof AuthError && e.code === "email_taken") return { error: "Tento e-mail už je zaregistrovaný." };
    throw e;
  }
  redirect("/onboarding");
}
