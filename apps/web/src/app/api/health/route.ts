import { sql } from "@itckar/db";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await sql`select 1`.execute(db());
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
