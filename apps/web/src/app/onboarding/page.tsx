import { Brand } from "@/components/brand";
import { tenantsForUser } from "@itckar/db";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { OnboardingForm } from "./form";
import { switchTenantAction } from "./actions";

export default async function OnboardingPage() {
  const s = await requireUser();
  const tenants = await tenantsForUser(db(), s.user.id);
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-10">
      <span className="mb-8"><Brand /></span>
      {tenants.length > 0 && (
        <section className="card mb-8">
          <h2 className="font-medium">Vaše prevádzky</h2>
          <ul className="mt-3 divide-y divide-neutral-100">
            {tenants.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-neutral-500">/b/{t.slug} · {t.role}</div>
                </div>
                <form action={switchTenantAction}>
                  <input type="hidden" name="tenantId" value={t.id} />
                  <button className="btn-secondary">Otvoriť</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
      <h1 className="text-2xl font-semibold">{tenants.length ? "Pridať ďalšiu prevádzku" : "Založte svoju prevádzku"}</h1>
      <p className="mt-1 text-sm text-neutral-600">Trvá to minútu. Všetko sa dá neskôr zmeniť v nastaveniach.</p>
      <OnboardingForm />
    </main>
  );
}
