import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Atelier Planning",
  description: "Gestion des réservations de L'Atelier Groupe",
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Staff must be able to zoom a phone screen in a bright salon.
  maximumScale: 5,
  // One fixed light theme (see globals.css). Both entries use the page's own
  // ground so a phone's browser chrome continues the app instead of
  // framing it in a colour from an older theme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F4EF" },
    { media: "(prefers-color-scheme: dark)", color: "#F7F4EF" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className="h-full">
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
