import type { ReactNode } from "react";

export function PageHeading({ title, description, icon }: { title: string; description: string; icon: ReactNode }) {
  return <div className="page-heading">
    <span className="page-heading-icon" aria-hidden="true">{icon}</span>
    <div><h1 className="text-xl font-semibold">{title}</h1><p>{description}</p></div>
  </div>;
}
