import Link from "next/link";

import { logout } from "@/app/actions/auth";
import { Power } from "@/components/icons";
import { ClientsList } from "@/components/clients-list";
import { Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/auth";
import { listAllClients } from "@/lib/clients";
import { setupNoticeFor } from "@/lib/page-errors";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const session = await requireSession();

  let clients: Awaited<ReturnType<typeof listAllClients>> = [];
  try {
    clients = await listAllClients();
  } catch (error) {
    const notice = setupNoticeFor(error);
    if (notice) return notice;
    throw error;
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row" style={{ background: "var(--paper)" }}>
      <Sidebar role={session.role} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile Header */}
        <header
          className="sticky top-0 z-20 border-b md:hidden"
          style={{
            borderColor: "var(--line)",
            background: "color-mix(in srgb, var(--surface) 94%, transparent)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <Link href="/bookings" className="mr-auto" title="L'Atelier Groupe">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-transparent.webp"
                alt="L'Atelier Groupe"
                className="h-7 w-auto max-w-[120px] object-contain"
              />
            </Link>
            <form action={logout}>
              <button
                type="submit"
                className="flex h-9 w-9 items-center justify-center rounded-[8px] transition-colors duration-[120ms] hover:bg-[color:var(--surface-sunk)]"
                style={{ color: "var(--ink-soft)" }}
                aria-label="Déconnexion"
              >
                <Power size={18} />
              </button>
            </form>
          </div>
        </header>

        {/* Main Content */}
        <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-6 px-4 py-6 md:px-6 lg:px-8 lg:py-8">
          <div>
            <span className="t-micro uppercase tracking-wider" style={{ color: "var(--accent)" }}>
              Clients & Réservations
            </span>
            <h1 className="t-display mt-1 text-[26px]">Fiches Clients</h1>
            <p className="t-small mt-1" style={{ color: "var(--ink-soft)" }}>
              Consultez les coordonnées, le nombre de réservations et l'historique complet de vos clients.
            </p>
          </div>

          <ClientsList initialClients={clients} />
        </main>
      </div>
    </div>
  );
}
