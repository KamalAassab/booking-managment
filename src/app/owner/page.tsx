import Link from "next/link";

import { ArrowUpRight, Check, ChevronLeft, ChevronRight, SalonGlyph } from "@/components/icons";
import { OwnerPasswordForms } from "@/components/owner-password-forms";
import { PageHeader } from "@/components/page-header";
import { Sidebar } from "@/components/sidebar";
import type { Booking, Salon } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import { listBookingsForSalons, listSalons } from "@/lib/bookings";
import { bookingPhase, formatDuration, occupancy } from "@/lib/day-layout";
import { setupNoticeFor } from "@/lib/page-errors";
import { formatPhoneForDisplay } from "@/lib/phone";
import { salonColor, shortName } from "@/lib/salon-display";
import { salonWhatsAppNumber } from "@/lib/salon-contact";
import {
  addDays,
  formatDayTitle,
  isValidDateString,
  minutesToLabel,
  nowMinutesInSalonTz,
  relativeDayLabel,
  todayInSalonTz,
} from "@/lib/time";
import { toSalonDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Three salons stack on a phone: each shows its first bookings only. */
const PHONE_ROWS = 6;

export default async function OwnerPage({ searchParams }: PageProps<"/owner">) {
  await requireOwner();

  const params = await searchParams;
  const today = todayInSalonTz();
  const requested = typeof params.date === "string" ? params.date : "";
  const date = requested && isValidDateString(requested) ? requested : today;

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
  const nowMin = nowMinutesInSalonTz();
  const relative = relativeDayLabel(date, today);

  return (
    <div className="app-shell">
      <Sidebar role="owner" salons={salons.map(toSalonDTO)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="page-main">
          <PageHeader
            title={formatDayTitle(date, today)}
            titleClassName="first-letter:uppercase"
            description={
              <>
                {relative ? `${relative} · ` : ""}
                <span data-nums>{active.length}</span> rendez-vous sur les {salons.length} salons
              </>
            }
            actions={
              <nav aria-label="Changer de jour" className="flex items-center gap-1">
                <Link href={`/owner?date=${addDays(date, -1)}`} className="btn-icon" aria-label="Jour précédent">
                  <ChevronLeft size={20} />
                </Link>
                <Link
                  href={`/owner?date=${today}`}
                  className="btn-secondary btn-sm"
                  aria-disabled={date === today || undefined}
                >
                  Aujourd&apos;hui
                </Link>
                <Link href={`/owner?date=${addDays(date, 1)}`} className="btn-icon" aria-label="Jour suivant">
                  <ChevronRight size={20} />
                </Link>
              </nav>
            }
          />

          {/* One column per salon on wide screens; stacked on a phone. */}
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Rendez-vous par salon">
            {salons.map((salon) => {
              const rows = active
                .filter((b) => b.salonId === salon.id)
                .sort((a, b) => a.startMin - b.startMin);
              const load = occupancy(rows, salon);

              return (
                <article key={salon.id} className="card flex flex-col p-0">
                  <div className="flex flex-col gap-2.5 border-b px-4 py-3.5" style={{ borderColor: "var(--line)" }}>
                    <div className="flex items-center gap-2.5">
                      <span className="flex shrink-0" style={{ color: salonColor(salon.slug) }}>
                        <SalonGlyph slug={salon.slug} size={20} />
                      </span>
                      <h2 className="t-heading mr-auto truncate">{shortName(salon.name)}</h2>
                      <span className="chip" data-nums>
                        {rows.length} rdv
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="wk-load flex-1" aria-hidden>
                        <span style={{ width: `${load}%` }} />
                      </span>
                      <span className="text-[12px]" style={{ color: "var(--ink-faint)" }} data-nums>
                        {load} % occupé
                      </span>
                    </div>
                  </div>

                  {rows.length === 0 ? (
                    <p className="t-small px-4 py-4" style={{ color: "var(--ink-faint)" }}>
                      Aucun rendez-vous.
                    </p>
                  ) : (
                    <ol className="flex flex-col gap-1.5 p-2.5">
                      {rows.map((b, index) => {
                        const phase = bookingPhase(b, today, nowMin);
                        return (
                          <li
                            key={b.id}
                            className={`bk flex-row items-center gap-3 py-2 ${index >= PHONE_ROWS ? "hidden md:flex" : ""}`}
                            data-phase={phase}
                          >
                            <span className="w-[44px] shrink-0 text-[13.5px] font-semibold" data-nums>
                              {minutesToLabel(b.startMin)}
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="bk-name text-[14px]">
                                {phase === "done" ? (
                                  <span className="shrink-0" style={{ color: "var(--success)" }}>
                                    <Check size={13} />
                                  </span>
                                ) : null}
                                <span className="truncate">{b.clientName}</span>
                              </span>
                              <span className="bk-line text-[12.5px]" data-nums>
                                {b.service} · {formatPhoneForDisplay(b.clientPhone)}
                              </span>
                            </span>
                            <span className="shrink-0 text-[12px]" style={{ color: "var(--ink-faint)" }} data-nums>
                              {formatDuration(b.durationMin)}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  )}

                  <Link
                    href={`/bookings?salon=${salon.slug}&date=${date}`}
                    className="wk-more mx-2.5 mb-2.5 mt-auto"
                  >
                    {rows.length > PHONE_ROWS ? (
                      <span className="md:hidden" data-nums>
                        Voir les {rows.length - PHONE_ROWS} autres au planning
                      </span>
                    ) : null}
                    <span className={rows.length > PHONE_ROWS ? "hidden md:inline" : undefined}>Ouvrir au planning</span>
                    <ArrowUpRight size={15} />
                  </Link>
                </article>
              );
            })}
          </section>

          <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="card p-4 md:p-5">
              <h2 className="t-heading">Numéro WhatsApp du salon</h2>
              <p className="t-small mt-1" style={{ color: "var(--ink-soft)" }}>
                Les confirmations partent de ce numéro. Chaque poste du centre d&apos;appels doit y
                être relié comme appareil lié (WhatsApp, Réglages, Appareils liés).
              </p>
              <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="t-title" data-nums>
                  {salonWhatsApp.display}
                </span>
                <span className="t-small" style={{ color: "var(--ink-faint)" }} data-nums>
                  {salonWhatsApp.e164}
                </span>
              </p>
            </div>

            <div className="card p-4 md:p-5">
              <h2 className="t-heading">Mots de passe</h2>
              <p className="t-small mb-4 mt-1" style={{ color: "var(--ink-soft)" }}>
                Le personnel partage un seul compte. Changez son mot de passe quand quelqu&apos;un
                quitte le groupe, puis communiquez-le aux équipes.
              </p>
              <OwnerPasswordForms />
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
