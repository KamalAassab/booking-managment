import { logout } from "@/app/actions/auth";
import { OwnerPasswordForms } from "@/components/owner-password-forms";
import type { Booking, Salon } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import { listBookingsForSalons, listSalons } from "@/lib/bookings";
import { setupNoticeFor } from "@/lib/page-errors";
import { formatPhoneForDisplay } from "@/lib/phone";
import { salonWhatsAppNumber } from "@/lib/salon-contact";
import {
  addDays,
  formatLongDate,
  isValidDateString,
  minutesToLabel,
  todayInSalonTz,
} from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function OwnerPage({ searchParams }: PageProps<"/owner">) {
  await requireOwner();

  const params = await searchParams;
  const requested = typeof params.date === "string" ? params.date : "";
  const date =
    requested && isValidDateString(requested) ? requested : todayInSalonTz();

  let salons: Salon[];
  let bookings: Booking[];
  try {
    salons = await listSalons();
    bookings = await listBookingsForSalons(
      salons.map((s) => s.id),
      date,
    );
  } catch (error) {
    const notice = setupNoticeFor(error);
    if (notice) return notice;
    throw error;
  }
  const active = bookings.filter((b) => b.status !== "cancelled");
  const salonWhatsApp = salonWhatsAppNumber();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header
        className="border-b"
        style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="mr-auto flex items-baseline gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">
              Atelier
            </span>
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              Espace propriétaire
            </span>
          </div>
          <a href="/bookings" className="btn-ghost !px-3 !py-1.5 text-xs">
            Planning
          </a>
          <form action={logout}>
            <button type="submit" className="btn-ghost !px-3 !py-1.5 text-xs">
              Déconnexion
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <section className="mb-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                Les trois salons
              </h1>
              <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
                <span className="first-letter:uppercase">
                  {formatLongDate(date)}
                </span>{" "}
                · {active.length} rendez-vous
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`/owner?date=${addDays(date, -1)}`}
                className="btn-ghost !px-3 !py-1.5"
                aria-label="Jour précédent"
              >
                ←
              </a>
              <a href={`/owner?date=${todayInSalonTz()}`} className="btn-ghost !px-3 !py-1.5 text-xs">
                Aujourd&apos;hui
              </a>
              <a
                href={`/owner?date=${addDays(date, 1)}`}
                className="btn-ghost !px-3 !py-1.5"
                aria-label="Jour suivant"
              >
                →
              </a>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {salons.map((salon) => {
              const rows = active
                .filter((b) => b.salonId === salon.id)
                .sort((a, b) => a.startMin - b.startMin);

              return (
                <div key={salon.id} className="panel rounded-xl p-4">
                  <div className="mb-3 flex items-baseline justify-between gap-2">
                    <h2 className="text-sm font-semibold">{salon.name}</h2>
                    <span
                      className="text-xs tabular-nums"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {rows.length}
                    </span>
                  </div>

                  {rows.length === 0 ? (
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                      Aucun rendez-vous.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {rows.map((b) => (
                        <li
                          key={b.id}
                          className="flex items-baseline gap-3 rounded-lg px-2 py-1.5 text-sm"
                          style={{ background: "var(--surface)" }}
                        >
                          <span className="w-11 shrink-0 font-semibold tabular-nums">
                            {minutesToLabel(b.startMin)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {b.clientName}
                            </span>
                            <span
                              className="block truncate text-xs"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {b.service} ·{" "}
                              {formatPhoneForDisplay(b.clientPhone)}
                            </span>
                          </span>
                          {b.status === "done" ? (
                            <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">
                              ✓
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold tracking-tight">
            Numéro WhatsApp du salon
          </h2>
          <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
            Les confirmations partent de ce numéro. Chaque poste du centre
            d&apos;appels doit y être relié comme appareil lié (WhatsApp →
            Réglages → Appareils liés), sinon le lien pré-rempli s&apos;ouvre
            sans compte connecté.
          </p>
          <div className="panel inline-flex items-baseline gap-3 rounded-xl px-4 py-3">
            <span className="text-lg font-semibold tabular-nums">
              {salonWhatsApp.display}
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {salonWhatsApp.e164}
            </span>
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-xl font-semibold tracking-tight">
            Mots de passe
          </h2>
          <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
            Le personnel partage un seul compte. Changez son mot de passe si un
            employé quitte le groupe, puis communiquez-le aux équipes.
          </p>
          <OwnerPasswordForms />
        </section>
      </main>
    </div>
  );
}
