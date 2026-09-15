import { PageHeader } from "@/components/page-header";
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
    <div className="app-shell">
      <Sidebar role="owner" />

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="page-main">
          <PageHeader
            title="Services et tarifs"
            description="Le catalogue de chaque salon, tel que le personnel le voit en réservant. Touchez un nom, une durée ou un prix pour le modifier : c'est enregistré aussitôt."
          />
          <ServicesTabs data={data} />
        </main>
      </div>
    </div>
  );
}
