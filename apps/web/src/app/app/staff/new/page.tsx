import { ResourceForm } from "../form";

export default function NewResourcePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Pridať člena tímu alebo zdroj</h1>
      <ResourceForm initial={{ name: "", kind: "staff", color: "", bookableOnline: true, rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "17:00" })) }} />
    </div>
  );
}
