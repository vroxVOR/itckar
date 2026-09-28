"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children, title }: { href: string; children: React.ReactNode; title?: string }) {
  const path = usePathname();
  const active = path === href || path.startsWith(href + "/");
  return (
    <Link href={href} className="nav-link" aria-current={active ? "page" : undefined} title={title}>
      {children}
    </Link>
  );
}
