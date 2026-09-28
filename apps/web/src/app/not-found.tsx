import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">404</h1>
      <p className="mt-2 text-neutral-600">Stránka neexistuje.</p>
      <Link href="/" className="btn-secondary mt-6">Domov</Link>
    </main>
  );
}
