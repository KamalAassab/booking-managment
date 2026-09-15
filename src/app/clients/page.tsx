import { ClientsList } from "@/components/clients-list";
import { PageHeader } from "@/components/page-header";
import { Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/auth";
import { listAllClients } from "@/lib/clients";
import { setupNoticeFor } from "@/lib/page-errors";
import { todayInSalonTz } from "@/lib/time";

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
    <div className="app-shell">
      <Sidebar role={session.role} />

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="page-main">
          <PageHeader
            title="Clients"
            description="Coordonnées, historique et prochains rendez-vous de chaque client."
          />
          <ClientsList initialClients={clients} today={todayInSalonTz()} />
        </main>
      </div>
    </div>
  );
}
