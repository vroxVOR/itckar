import Link from "next/link";
import { Brand } from "@/components/brand";
import { Clock3, CalendarDays, Users, Scissors, UserRound, Settings, ExternalLink } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { t } from "@/lib/i18n";
import { NavLink } from "@/components/nav-link";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireTenant();
  const l = s.tenant.locale;
  const nav = [
    { href: "/app/calendar", label: t(l, "calendar"), icon: CalendarDays },
    { href: "/app/waitlist", label: "Čakatelia", icon: Clock3 },
    { href: "/app/clients", label: t(l, "clients"), icon: Users },
    { href: "/app/services", label: t(l, "services"), icon: Scissors },
    { href: "/app/staff", label: t(l, "staff"), icon: UserRound },
    { href: "/app/settings", label: t(l, "settings"), icon: Settings },
  ];
  return (
    <div className="app-shell flex min-h-screen">
      <aside className="app-sidebar hidden w-60 shrink-0 flex-col border-r border-neutral-200 bg-white p-4 md:flex">
        <Link href="/app" className="mb-6 px-3" aria-label="itckar"><Brand /></Link>
        <div className="tenant-switcher mb-4 px-3">
          <div className="truncate text-sm font-medium">{s.tenant.name}</div>
          <Link href={`/b/${s.tenant.slug}`} target="_blank" className="flex items-center gap-1 text-xs text-neutral-500 hover:underline">
            /b/{s.tenant.slug} <ExternalLink size={12} />
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((n) => (
            <NavLink key={n.href} href={n.href}>
              <n.icon size={16} /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="account-panel mt-4 border-t border-neutral-100 pt-4 text-sm">
          <div className="truncate px-3 text-neutral-700">{s.user.name}</div>
          <div className="flex items-center justify-between px-3">
            <Link href="/onboarding" className="text-xs text-neutral-500 hover:underline">Prevádzky</Link>
            <form action="/logout" method="post">
              <button className="text-xs text-neutral-500 hover:underline">{t(l, "logout")}</button>
            </form>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2 md:hidden">
          <Link href="/app" className="shrink-0" aria-label="itckar"><Brand compact /></Link>
          <nav className="mobile-nav ml-auto flex gap-1">
            {nav.map((n) => (
              <NavLink key={n.href} href={n.href} title={n.label}>
                <n.icon size={18} />
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="app-content flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
