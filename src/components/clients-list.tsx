"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import {
  Calendar,
  Check,
  ChevronRight,
  Clock,
  Close,
  Phone,
  Plus,
  Search,
  User,
  WhatsApp,
} from "@/components/icons";
import type { ClientSummary } from "@/lib/clients";
import { formatLongDate, minutesToLabel } from "@/lib/time";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { SelectDropdown } from "@/components/ui/select";

type Props = {
  initialClients: ClientSummary[];
};

type FilterSalon = "all" | string;
type SortBy = "bookings" | "recent" | "name";

export function ClientsList({ initialClients }: Props) {
  const [search, setSearch] = useState("");
  const [selectedSalon, setSelectedSalon] = useState<FilterSalon>("all");
  const [minBookingsFilter, setMinBookingsFilter] = useState<"all" | "frequent">("all");
  const [sortBy, setSortBy] = useState<SortBy>("bookings");
  const [activeClientHistory, setActiveClientHistory] = useState<ClientSummary | null>(null);

  // Extract list of all unique salons
  const allSalons = useMemo(() => {
    const set = new Set<string>();
    for (const c of initialClients) {
      for (const s of c.salonsVisited) set.add(s);
    }
    return Array.from(set);
  }, [initialClients]);

  // Filter and sort clients
  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();

    return initialClients
      .filter((c) => {
        // Search filter
        if (q) {
          const matchName = c.clientName.toLowerCase().includes(q);
          const matchPhone = c.clientPhone.includes(q) || c.formattedPhone.includes(q);
          const matchService = c.lastService.toLowerCase().includes(q);
          if (!matchName && !matchPhone && !matchService) return false;
        }

        // Salon filter
        if (selectedSalon !== "all" && !c.salonsVisited.includes(selectedSalon)) {
          return false;
        }

        // Min bookings filter (Frequent >= 2 bookings)
        if (minBookingsFilter === "frequent" && c.totalBookings < 2) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === "bookings") {
          return b.totalBookings - a.totalBookings || b.lastBookingDate.localeCompare(a.lastBookingDate);
        }
        if (sortBy === "recent") {
          return b.lastBookingDate.localeCompare(a.lastBookingDate) || b.totalBookings - a.totalBookings;
        }
        if (sortBy === "name") {
          return a.clientName.localeCompare(b.clientName);
        }
        return 0;
      });
  }, [initialClients, search, selectedSalon, minBookingsFilter, sortBy]);

  // Overall statistics
  const stats = useMemo(() => {
    const totalClients = initialClients.length;
    const totalBookingsCount = initialClients.reduce((acc, c) => acc + c.totalBookings, 0);
    const frequentCount = initialClients.filter((c) => c.totalBookings >= 2).length;
    return { totalClients, totalBookingsCount, frequentCount };
  }, [initialClients]);

  return (
    <div className="flex flex-col gap-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:gap-4">
        <div
          className="card flex flex-col justify-between p-4"
          style={{ background: "var(--surface)" }}
        >
          <span className="t-small" style={{ color: "var(--ink-faint)" }}>
            Clients uniques
          </span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="t-display text-[26px]" style={{ color: "var(--ink)" }} data-nums>
              {stats.totalClients}
            </span>
            <span className="t-micro rounded-full px-2 py-0.5" style={{ background: "var(--surface-sunk)", color: "var(--ink-soft)" }}>
              Répertoire
            </span>
          </div>
        </div>

        <div
          className="card flex flex-col justify-between p-4"
          style={{ background: "var(--surface)" }}
        >
          <span className="t-small" style={{ color: "var(--ink-faint)" }}>
            Clients fidèles (≥ 2 visites)
          </span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="t-display text-[26px]" style={{ color: "var(--accent)" }} data-nums>
              {stats.frequentCount}
            </span>
            <span className="t-micro rounded-full px-2 py-0.5" style={{ background: "var(--accent-tint)", color: "var(--accent-hover)" }}>
              {stats.totalClients > 0 ? `${Math.round((stats.frequentCount / stats.totalClients) * 100)}%` : "0%"}
            </span>
          </div>
        </div>

        <div
          className="card flex flex-col justify-between p-4"
          style={{ background: "var(--surface)" }}
        >
          <span className="t-small" style={{ color: "var(--ink-faint)" }}>
            Total réservations enregistrées
          </span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="t-display text-[26px]" style={{ color: "var(--ink)" }} data-nums>
              {stats.totalBookingsCount}
            </span>
            <span className="t-micro rounded-full px-2 py-0.5" style={{ background: "var(--surface-sunk)", color: "var(--ink-soft)" }}>
              Cumul
            </span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Search */}
          <div className="relative flex-1">
            <span
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: "var(--ink-faint)" }}
            >
              <Search size={16} />
            </span>
            <input
              type="search"
              placeholder="Rechercher par nom, téléphone, prestation…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9"
              style={{ width: "100%" }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1"
                style={{ color: "var(--ink-faint)" }}
                aria-label="Effacer la recherche"
              >
                <Close size={14} />
              </button>
            )}
          </div>

          {/* Sort selection */}
          <div className="flex items-center gap-2 min-w-[220px]">
            <span className="t-small shrink-0" style={{ color: "var(--ink-faint)" }}>
              Trier par :
            </span>
            <div className="flex-1">
              <SelectDropdown<SortBy>
                value={sortBy}
                onChange={setSortBy}
                options={[
                  { value: "bookings", label: "Plus de visites (Fidélité)" },
                  { value: "recent", label: "Dernière visite" },
                  { value: "name", label: "Nom (A — Z)" },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "var(--line)" }}>
          <span className="t-micro uppercase tracking-wider" style={{ color: "var(--ink-faint)" }}>
            Filtres :
          </span>

          <button
            type="button"
            onClick={() => setMinBookingsFilter("all")}
            className="t-small rounded-full px-3 py-1 text-[12px] transition-colors"
            style={{
              background: minBookingsFilter === "all" ? "var(--ink)" : "var(--surface-sunk)",
              color: minBookingsFilter === "all" ? "var(--surface)" : "var(--ink-soft)",
            }}
          >
            Tous les clients
          </button>

          <button
            type="button"
            onClick={() => setMinBookingsFilter("frequent")}
            className="t-small rounded-full px-3 py-1 text-[12px] transition-colors"
            style={{
              background: minBookingsFilter === "frequent" ? "var(--accent)" : "var(--surface-sunk)",
              color: minBookingsFilter === "frequent" ? "#ffffff" : "var(--ink-soft)",
            }}
          >
            ⭐ Clients réguliers (≥ 2)
          </button>

          {allSalons.length > 1 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="t-small text-[12px] shrink-0" style={{ color: "var(--ink-faint)" }}>
                Salon :
              </span>
              <div className="w-[180px]">
                <SelectDropdown<FilterSalon>
                  value={selectedSalon}
                  onChange={setSelectedSalon}
                  options={[
                    { value: "all", label: "Tous les salons" },
                    ...allSalons.map((s) => ({ value: s, label: s })),
                  ]}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Clients Grid / Table */}
      {filteredClients.length === 0 ? (
        <div className="card flex flex-col items-center justify-center p-12 text-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full mb-3"
            style={{ background: "var(--surface-sunk)", color: "var(--ink-faint)" }}
          >
            <User size={24} />
          </div>
          <p className="t-title text-[16px]">Aucun client trouvé</p>
          <p className="t-small mt-1" style={{ color: "var(--ink-faint)" }}>
            Modifiez votre recherche ou vos filtres pour voir les résultats.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filteredClients.map((client) => {
            const waLink = buildWhatsAppLink({
              clientName: client.clientName,
              clientPhone: client.clientPhone,
              salonName: "L'Atelier",
              bookingDate: client.lastBookingDate,
              startMin: 0,
              service: client.lastService,
            });

            const initials = client.clientName
              .split(" ")
              .filter(Boolean)
              .map((n) => n[0])
              .slice(0, 2)
              .join("")
              .toUpperCase();

            return (
              <div
                key={`${client.clientPhone}-${client.clientName}`}
                className="card group flex flex-col justify-between p-4 transition-all duration-150 hover:shadow-md"
                style={{ background: "var(--surface)" }}
              >
                {/* Header info */}
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-semibold text-[14px]"
                        style={{
                          background: "var(--accent-tint)",
                          color: "var(--accent-hover)",
                          border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
                        }}
                      >
                        {initials || <User size={18} />}
                      </div>

                      <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
                          {client.clientName}
                        </h3>
                        <p className="t-small truncate text-[12px]" style={{ color: "var(--ink-soft)" }} data-nums>
                          {client.formattedPhone}
                        </p>
                      </div>
                    </div>

                    <span
                      className="t-small shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                      style={{
                        background: client.totalBookings > 2 ? "var(--accent)" : "var(--surface-sunk)",
                        color: client.totalBookings > 2 ? "#ffffff" : "var(--ink-soft)",
                      }}
                      data-nums
                    >
                      {client.totalBookings} rdv
                    </span>
                  </div>

                  {/* Visit Stats */}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
                    {client.doneBookings > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5" style={{ background: "var(--surface-sunk)" }}>
                        <Check size={11} className="text-emerald-600" />
                        <span>{client.doneBookings} effectué{client.doneBookings > 1 ? "s" : ""}</span>
                      </span>
                    )}
                    {client.confirmedBookings > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5" style={{ background: "var(--surface-sunk)" }}>
                        <Clock size={11} className="text-amber-600" />
                        <span>{client.confirmedBookings} à venir</span>
                      </span>
                    )}
                    {client.cancelledBookings > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5" style={{ background: "var(--surface-sunk)" }}>
                        <Close size={11} className="text-rose-500" />
                        <span>{client.cancelledBookings} annulé{client.cancelledBookings > 1 ? "s" : ""}</span>
                      </span>
                    )}
                  </div>

                  {/* Last visit & service */}
                  <div className="mt-3 border-t pt-2.5 text-[12px]" style={{ borderColor: "var(--line)" }}>
                    <div className="flex items-center justify-between text-[11.5px]">
                      <span style={{ color: "var(--ink-faint)" }}>Dernière prestation :</span>
                      <span className="font-medium truncate max-w-[160px]" style={{ color: "var(--ink)" }}>
                        {client.lastService || "—"}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center justify-between text-[11.5px]">
                      <span style={{ color: "var(--ink-faint)" }}>Dernier passage :</span>
                      <span style={{ color: "var(--ink-soft)" }} data-nums>
                        {formatLongDate(client.lastBookingDate)}
                      </span>
                    </div>

                    {client.salonsVisited.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {client.salonsVisited.map((salonName) => (
                          <span
                            key={salonName}
                            className="t-micro rounded px-1.5 py-0.5 text-[10px]"
                            style={{ background: "var(--surface-sunk)", color: "var(--ink-faint)" }}
                          >
                            {salonName}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Actions */}
                <div className="mt-4 flex items-center gap-2 border-t pt-3" style={{ borderColor: "var(--line)" }}>
                  {client.clientPhone && (
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary btn-sm flex-1 justify-center gap-1 text-[12px]"
                      title="Contacter sur WhatsApp"
                    >
                      <WhatsApp size={13} className="text-emerald-600" />
                      WhatsApp
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => setActiveClientHistory(client)}
                    className="btn-secondary btn-sm flex-1 justify-center gap-1 text-[12px]"
                  >
                    <Calendar size={13} />
                    Historique
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* History Detail Drawer / Modal */}
      {activeClientHistory && (
        <div
          className="anim-fade fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0, 0, 0, 0.45)", backdropFilter: "blur(4px)" }}
          onClick={() => setActiveClientHistory(null)}
        >
          <div
            className="card relative flex max-h-[85vh] w-full max-w-[540px] flex-col overflow-hidden p-5 shadow-2xl animate-in zoom-in-95 duration-150"
            style={{ background: "var(--surface)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b pb-4" style={{ borderColor: "var(--line)" }}>
              <div>
                <span className="t-micro uppercase tracking-wider" style={{ color: "var(--accent)" }}>
                  Fiche Client
                </span>
                <h2 className="t-display text-[20px] mt-0.5" style={{ color: "var(--ink)" }}>
                  {activeClientHistory.clientName}
                </h2>
                <p className="t-small mt-0.5" style={{ color: "var(--ink-soft)" }} data-nums>
                  {activeClientHistory.formattedPhone} • {activeClientHistory.totalBookings} réservation{activeClientHistory.totalBookings > 1 ? "s" : ""}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setActiveClientHistory(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[color:var(--surface-sunk)]"
                style={{ color: "var(--ink-soft)" }}
                aria-label="Fermer"
              >
                <Close size={18} />
              </button>
            </div>

            {/* Modal Body: Bookings timeline */}
            <div className="mt-4 flex-1 overflow-y-auto pr-1">
              <h4 className="text-[13px] font-semibold mb-3" style={{ color: "var(--ink)" }}>
                Historique des rendez-vous
              </h4>

              <div className="flex flex-col gap-2.5">
                {activeClientHistory.recentBookings.map((b) => {
                  const isDone = b.status === "done";
                  const isCancelled = b.status === "cancelled";

                  return (
                    <div
                      key={b.id}
                      className="flex items-center justify-between rounded-[10px] border p-3"
                      style={{
                        background: "var(--surface-sunk)",
                        borderColor: "var(--line)",
                        opacity: isCancelled ? 0.6 : 1,
                      }}
                    >
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
                            {b.service}
                          </span>
                          <span
                            className="t-micro rounded px-1.5 py-0.2"
                            style={{
                              background: isDone
                                ? "rgba(16, 185, 129, 0.15)"
                                : isCancelled
                                ? "rgba(244, 63, 94, 0.15)"
                                : "var(--accent-tint)",
                              color: isDone
                                ? "#059669"
                                : isCancelled
                                ? "#e11d48"
                                : "var(--accent-hover)",
                            }}
                          >
                            {isDone ? "Terminé" : isCancelled ? "Annulé" : "Confirmé"}
                          </span>
                        </div>

                        <span className="t-small mt-0.5 text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
                          {b.salonName} • {b.durationMin} min
                        </span>
                      </div>

                      <div className="text-right" data-nums>
                        <span className="block text-[12px] font-semibold" style={{ color: "var(--ink)" }}>
                          {formatLongDate(b.bookingDate)}
                        </span>
                        <span className="t-small text-[11px]" style={{ color: "var(--ink-soft)" }}>
                          {minutesToLabel(b.startMin)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="mt-5 flex items-center justify-between border-t pt-3" style={{ borderColor: "var(--line)" }}>
              <Link
                href={`/bookings?salon=${activeClientHistory.recentBookings[0]?.salonSlug || "vip"}`}
                className="btn-primary btn-sm flex items-center gap-1.5"
                onClick={() => setActiveClientHistory(null)}
              >
                <Plus size={15} />
                Nouvelle réservation
              </Link>

              <button
                type="button"
                onClick={() => setActiveClientHistory(null)}
                className="btn-secondary btn-sm"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
