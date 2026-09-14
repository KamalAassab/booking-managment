import { logout } from "@/app/actions/auth";
import { Power } from "@/components/icons";
import { ServicesTabs } from "@/components/services-tabs";
import { Sidebar } from "@/components/sidebar";
import { requireOwner } from "@/lib/auth";
import {
  listAllServicesGroupedBySalon,
  seedServicesIfEmpty,
} from "@/lib/services";
import { setupNoticeFor } from "@/lib/page-errors";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  await requireOwner();

  let data: Awaited<ReturnType<typeof listAllServicesGroupedBySalon>>;
  try {
    data = await listAllServicesGroupedBySalon();

    // Auto-seed any salon whose table is empty on first visit
    await Promise.all(
      data.map((tab) => seedServicesIfEmpty(tab.salonId, tab.salonSlug)),
    );

    // Re-fetch after seeding so the UI shows the pre-populated rows
    data = await listAllServicesGroupedBySalon();
  } catch (error) {
    const notice = setupNoticeFor(error);
    if (notice) return notice;
    throw error;
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row" style={{ background: "var(--paper)" }}>
      <Sidebar role="owner" />

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
            <a href="/bookings" className="mr-auto" title="L'Atelier Groupe">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-transparent.webp"
                alt="L'Atelier Groupe"
                className="h-7 w-auto max-w-[120px] object-contain"
              />
            </a>
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

        <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-6 md:px-6 lg:px-8 lg:py-8">
          <div className="mb-6">
            <span className="t-micro uppercase tracking-wider" style={{ color: "var(--accent)" }}>
              Prestations & Tarifs
            </span>
            <h1 className="t-display mt-1 text-[26px]">Catalogue des Services</h1>
            <p className="t-small mt-1" style={{ color: "var(--ink-soft)" }}>
              Liste complète des services par salon. Cliquez sur n'importe quelle cellule pour modifier
              le nom, la durée ou le prix — la sauvegarde est instantanée et synchronisée.
            </p>
          </div>

          <ServicesTabs data={data} />
        </main>
      </div>
    </div>
  );
}
