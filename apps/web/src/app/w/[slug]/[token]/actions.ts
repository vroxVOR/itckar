"use server";

import { revalidatePath } from "next/cache";
import { closeWaitlistEntry, publicTenantBySlug, withTenant } from "@itckar/db";
import { db } from "@/lib/db";

export async function stopWaiting(form: FormData): Promise<void> {
  const slug = String(form.get("slug") ?? "");
  const token = String(form.get("token") ?? "");
  if (!/^[a-f0-9]{48}$/.test(token) || slug.length > 100) return;
  const tenant = await publicTenantBySlug(db(), slug);
  if (!tenant) return;
  await withTenant(db(), tenant.id, (tx) => closeWaitlistEntry(tx, { token }));
  revalidatePath(`/w/${slug}/${token}`);
  revalidatePath("/app/waitlist");
}
