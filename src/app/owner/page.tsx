import { logout } from "@/app/actions/auth";
import { ChevronLeft, ChevronRight, Check, Power } from "@/components/icons";
import { OwnerPasswordForms } from "@/components/owner-password-forms";
import { salonColor, shortName } from "@/components/salon-switcher";
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
    <div className="flex min-h-dvh flex-col">
      <header
        className="sticky top-0 z-20 border-b"
        style={{
          borderColor: "var(--line)",
          background: "color-mix(in srgb, var(--surface) 94%, transparent)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="mx-auto flex max-w-[1180px] items-center gap-3 px-4 py-3 md:px-6">
          <div className="mr-auto">
            <p className="t-title">Atelier</p>
            <p className="t-small" style={{ color: "var(--ink-faint)" }}>
              Espace propriétaire
            </p>
          </div>
          <a
            href="/bookings"
            className="t-small rounded-[8px] px-2.5 py-2 transition-colors duration-[120ms] hover:bg-[color:var(--surface-sunk)]"
            style={{ color: "var(--ink-soft)" }}
          >
            Planning
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

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-6 md:px-6 md:py-8">
        {/* ---- The three salons -------------------------------------- */}
        <section className="mb-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="t-title">
                <span className="first-letter:uppercase">
                  {formatLongDate(date)}
                </span>
              </h1>
              <p className="t-small" style={{ color: "var(--ink-faint)" }}>
                <span data-nums>{active.length}</span> rendez-vous sur les trois
                salons
              </p>
            </div>
            <div className="flex items-center gap-0.5">
              <a
                href={`/owner?date=${addDays(date, -1)}`}
                className="flex h-9 w-9 items-center justify-center rounded-[8px] transition-colors duration-[120ms] hover:bg-[color:var(--surface-sunk)]"
                style={{ color: "var(--ink-soft)" }}
                aria-label="Jour précédent"
              >
                <ChevronLeft size={18} />
              </a>
              <a
                href={`/owner?date=${todayInSalonTz()}`}
                className="t-small rounded-[8px] px-2.5 py-1.5 transition-colors duration-[120ms] hover:bg-[color:var(--surface-sunk)]"
                style={{ color: "var(--ink-soft)" }}
              >
                Aujourd&apos;hui
              </a>
              <a
                href={`/owner?date=${addDays(date, 1)}`}
                className="flex h-9 w-9 items-center justify-center rounded-[8px] transition-colors duration-[120ms] hover:bg-[color:var(--surface-sunk)]"
                style={{ color: "var(--ink-soft)" }}
                aria-label="Jour suivant"
              >
                <ChevronRight size={18} />
              </a>
            </div>
          </div>

          {/* One column per salon at xl; a single stack below, which is what
              a phone can actually show. */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {salons.map((salon) => {
              const rows = active
                .filter((b) => b.salonId === salon.id)
                .sort((a, b) => a.startMin - b.startMin);

              return (
                <section key={salon.id} className="card p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className="block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: salonColor(salon.slug) }}
                      aria-hidden
                    />
                    <h2 className="t-heading mr-auto truncate">
                      {shortName(salon.name)}
                    </h2>
                    <span
                      className="t-small"
                      style={{ color: "var(--ink-faint)" }}
                      data-nums
                    >
                      {rows.length}
                    </span>
                  </div>

                  {rows.length === 0 ? (
                    <p className="t-small" style={{ color: "var(--ink-faint)" }}>
                      Aucun rendez-vous.
                    </p>
                  ) : (
                    <ul className="flex flex-col">
                      {rows.map((b, i) => (
                        <li
                          key={b.id}
                          className="flex items-baseline gap-3 py-2"
                          style={{
                            borderTop:
                              i === 0 ? "none" : "1px solid var(--line)",
                          }}
                        >
                          <time
                            className="w-11 shrink-0 font-semibold"
                            style={{
                              color:
                                b.status === "done"
                                  ? "var(--ink-faint)"
                                  : "var(--ink)",
                            }}
                          >
                            {minutesToLabel(b.startMin)}
                          </time>
                          <span className="min-w-0 flex-1">
                            <span
                              className="flex items-center gap-1.5 truncate font-semibold"
                              style={{
                                color:
                                  b.status === "done"
                                    ? "var(--ink-soft)"
                                    : "var(--ink)",
                              }}
                            >
                              {b.status === "done" ? (
                                <span style={{ color: "var(--ink-faint)" }}>
                                  <Check size={14} />
                                </span>
                              ) : null}
                              {b.clientName}
                            </span>
                            <span
                              className="t-small block truncate"
                              style={{ color: "var(--ink-faint)" }}
                            >
                              {b.service} ·{" "}
                              <span data-nums>
                                {formatPhoneForDisplay(b.clientPhone)}
                              </span>
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </section>

        {/* ---- WhatsApp number --------------------------------------- */}
        <section className="mb-10">
          <h2 className="t-heading mb-1">Numéro WhatsApp du salon</h2>
          <p className="t-small mb-3" style={{ color: "var(--ink-soft)" }}>
            Les confirmations partent de ce numéro. Chaque poste du centre
            d&apos;appels doit y être relié comme appareil lié (WhatsApp →
            Réglages → Appareils liés).
          </p>
          <div className="card inline-flex items-baseline gap-3 px-4 py-3">
            <span className="t-heading" data-nums>
              {salonWhatsApp.display}
            </span>
            <span
              className="t-small"
              style={{ color: "var(--ink-faint)" }}
              data-nums
            >
              {salonWhatsApp.e164}
            </span>
          </div>
        </section>

        {/* ---- Passwords -------------------------------------------- */}
        <section>
          <h2 className="t-heading mb-1">Mots de passe</h2>
          <p className="t-small mb-4" style={{ color: "var(--ink-soft)" }}>
            Le personnel partage un seul compte. Changez son mot de passe quand
            quelqu&apos;un quitte le groupe, puis communiquez-le aux équipes.
          </p>
          <OwnerPasswordForms />
        </section>
      </main>
    </div>
  );
}
