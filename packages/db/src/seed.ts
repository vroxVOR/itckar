import type { Db } from "./db.js";
import { withTenant } from "./db.js";
import { createTenantWithOwner, registerUser } from "./auth.js";

export interface SeedResult {
  tenantId: string;
  ownerId: string;
  resources: Record<string, string>;
  services: Record<string, string>;
}

/**
 * Creates a demo hair salon with 2 stylists, 2 chairs, a massage room and services that
 * exercise every engine feature (processing gap, buffers, resources).
 */
export async function seedDemoSalon(
  db: Db,
  opts: { slug?: string; ownerEmail?: string; ownerPassword?: string } = {},
): Promise<SeedResult> {
  const owner = await registerUser(db, {
    email: opts.ownerEmail ?? "demo@itckar.local",
    password: opts.ownerPassword ?? "demo1234",
    name: "Demo Majiteľ",
  });
  const tenantId = await createTenantWithOwner(
    db,
    { slug: opts.slug ?? "salon-demo", name: "Salón Demo", timezone: "Europe/Prague", locale: "sk", currency: "EUR", country: "SK" },
    owner.id,
  );

  return withTenant(db, tenantId, async (tx) => {
    const location = await tx.selectFrom("location").select("id").where("is_default", "=", true).executeTakeFirstOrThrow();
    const mk = async (kind: "staff" | "chair" | "room", name: string, color: string | null, sort: number) =>
      (
        await tx
          .insertInto("resource")
          .values({ tenant_id: tenantId, location_id: location.id, kind, name, color, sort_order: sort })
          .returning("id")
          .executeTakeFirstOrThrow()
      ).id;
    const anna = await mk("staff", "Anna", "#e11d48", 0);
    const bob = await mk("staff", "Boris", "#2563eb", 1);
    const chair1 = await mk("chair", "Kreslo 1", null, 10);
    const chair2 = await mk("chair", "Kreslo 2", null, 11);
    const room1 = await mk("room", "Masážna miestnosť", null, 20);

    const rules = (rid: string, days: number[], start: string, end: string) =>
      days.map((weekday) => ({ tenant_id: tenantId, resource_id: rid, weekday, start_time: start, end_time: end }));
    await tx
      .insertInto("availability_rule")
      .values([...rules(anna, [1, 2, 3, 4, 5], "09:00", "17:00"), ...rules(bob, [1, 2, 3, 4, 5], "12:00", "20:00"), ...rules(bob, [6], "09:00", "14:00")])
      .execute();

    const cat = async (name: string, sort: number) =>
      (await tx.insertInto("service_category").values({ tenant_id: tenantId, name, sort_order: sort }).returning("id").executeTakeFirstOrThrow()).id;
    const catHair = await cat("Vlasy", 0);
    const catMassage = await cat("Masáže", 1);

    const svc = async (s: {
      name: string;
      category: string;
      price: number;
      bufferAfter?: number;
      requirements: { key: string; kind: "staff" | "chair" | "room"; candidates: string[] }[];
      segments: { name?: string; duration: number; kind: "active" | "processing"; occupies: string[] }[];
      description?: string;
    }) => {
      const id = (
        await tx
          .insertInto("service")
          .values({
            tenant_id: tenantId,
            category_id: s.category,
            name: s.name,
            description: s.description ?? null,
            price_cents: s.price,
            buffer_after_min: s.bufferAfter ?? 0,
            color: null,
          })
          .returning("id")
          .executeTakeFirstOrThrow()
      ).id;
      for (const [i, r] of s.requirements.entries()) {
        const rid = (
          await tx
            .insertInto("service_requirement")
            .values({ tenant_id: tenantId, service_id: id, key: r.key, kind: r.kind, sort_order: i })
            .returning("id")
            .executeTakeFirstOrThrow()
        ).id;
        await tx
          .insertInto("service_requirement_candidate")
          .values(r.candidates.map((c) => ({ requirement_id: rid, resource_id: c, tenant_id: tenantId })))
          .execute();
      }
      await tx
        .insertInto("service_segment")
        .values(
          s.segments.map((seg, i) => ({
            tenant_id: tenantId,
            service_id: id,
            position: i,
            name: seg.name ?? null,
            duration_min: seg.duration,
            kind: seg.kind,
            occupies: seg.occupies,
          })),
        )
        .execute();
      return id;
    };

    const staffChair = [
      { key: "staff", kind: "staff" as const, candidates: [anna, bob] },
      { key: "chair", kind: "chair" as const, candidates: [chair1, chair2] },
    ];
    const haircut = await svc({
      name: "Dámsky strih",
      category: catHair,
      price: 2500,
      requirements: staffChair,
      segments: [{ duration: 45, kind: "active", occupies: ["staff", "chair"] }],
    });
    const mensCut = await svc({
      name: "Pánsky strih",
      category: catHair,
      price: 1800,
      requirements: staffChair,
      segments: [{ duration: 30, kind: "active", occupies: ["staff", "chair"] }],
    });
    const colour = await svc({
      name: "Farbenie",
      category: catHair,
      price: 6500,
      description: "Nanesenie farby, pôsobenie a záverečná úprava.",
      requirements: staffChair,
      segments: [
        { name: "Nanesenie", duration: 30, kind: "active", occupies: ["staff", "chair"] },
        { name: "Pôsobenie", duration: 45, kind: "processing", occupies: ["chair"] },
        { name: "Úprava", duration: 30, kind: "active", occupies: ["staff", "chair"] },
      ],
    });
    const massage = await svc({
      name: "Klasická masáž 60 min",
      category: catMassage,
      price: 4000,
      bufferAfter: 15,
      requirements: [
        { key: "staff", kind: "staff", candidates: [anna] },
        { key: "room", kind: "room", candidates: [room1] },
      ],
      segments: [{ duration: 60, kind: "active", occupies: ["staff", "room"] }],
    });

    return {
      tenantId,
      ownerId: owner.id,
      resources: { anna, bob, chair1, chair2, room1 },
      services: { haircut, mensCut, colour, massage },
    };
  });
}
