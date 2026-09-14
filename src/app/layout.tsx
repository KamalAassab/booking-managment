import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Atelier Planning",
  description: "Gestion des réservations — L'Atelier Groupe",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Staff must be able to zoom a phone screen in a bright salon.
  maximumScale: 5,
  // One fixed dark theme now (see globals.css) — both entries point at the
  // same colour so the browser chrome matches regardless of OS setting.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0d1220" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1220" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className="h-full">
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
