import { redirect } from "next/navigation";
import { destroySession } from "@itckar/db";
import { db } from "@/lib/db";
import { clearSessionCookie, currentSession } from "@/lib/session";

export async function POST() {
  const s = await currentSession();
  if (s) await destroySession(db(), s.sessionId);
  await clearSessionCookie();
  redirect("/");
}
