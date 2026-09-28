import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "itckar", template: "%s · itckar" },
  description: "Rezervačný systém pre salóny, barbershopy, kozmetiku a masáže.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sk">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
