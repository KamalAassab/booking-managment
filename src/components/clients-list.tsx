"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { ArrowUpRight, Check, ChevronRight, Close, Plus, Search, WhatsApp } from "@/components/icons";
import { SelectDropdown } from "@/components/ui/select";
import type { ClientSummary } from "@/lib/clients";
import { formatDuration } from "@/lib/day-layout";
import { waDigits } from "@/lib/phone";
import { minutesToLabel } from "@/lib/time";

type Props = {
  initialClients: ClientSummary[];
  today: string;
};

type SortBy = "bookings" | "recent" | "name";
type Loyalty = "all" | "frequent" | "upcoming";

/** Rows drawn at a time: 706 cards at once took seconds to paint. */
const PAGE = 60;

const DATE_FMT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const DATE_YEAR_FMT = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function shortDate(date: string, today: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const value = new Date(Date.UTC(y, m - 1, d));
  return (date.slice(0, 4) === today.slice(0, 4) ? DATE_FMT : DATE_YEAR_FMT).format(value);
}

const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** A plain chat, no pre-filled message: this is not a booking confirmation. */
function chatLink(phone: string): string {
  return `https://api.whatsapp.com/send?phone=${waDigits(phone)}`;
}

/**
 * Everyone who has booked, one dense row each: who, how to reach them, when
 * they last came and when they come next. Search takes names, services and
 * phone numbers in the way people say them ("0612", accents optional); a row
 * opens the client's history.
 */
export function ClientsList({ initialClients, today }: Props) {
  const [search, setSearch] = useState("");
  const [salon, setSalon] = useState("all");
  const [loyalty, setLoyalty] = useState<Loyalty>("all");
  const [sortBy, setSortBy] = useState<SortBy>("recent");
  const [limit, setLimit] = useState(PAGE);
  const [openClient, setOpenClient] = useState<ClientSummary | null>(null);

  const allSalons = useMemo(() => {
    const set = new Set<string>();
    for (const c of initialClients) for (const s of c.salonsVisited) set.add(s);
    return Array.from(set).sort();
  }, [initialClients]);

  const stats = useMemo(() => {
    let frequent = 0;
    let upcoming = 0;
    for (const c of initialClients) {
      if (c.totalBookings >= 2) frequent += 1;
      if (c.nextBooking) upcoming += 1;
    }
    return { total: initialClients.length, frequent, upcoming };
  }, [initialClients]);

  const filtered = useMemo(() => {
    const text = fold(search.trim());
    const digits = search.replace(/\D/g, "");
    return initialClients
      .filter((c) => {
        if (text) {
          const phoneDigits = c.clientPhone.replace(/\D/g, "");
          const national = phoneDigits.startsWith("212") ? `0${phoneDigits.slice(3)}` : phoneDigits;
          const byText = fold(c.clientName).includes(text) || fold(c.lastService).includes(text);
          const byPhone = digits.length >= 2 && (phoneDigits.includes(digits) || national.includes(digits));
          if (!byText && !byPhone) return false;
        }
        if (salon !== "all" && !c.salonsVisited.includes(salon)) return false;
        if (loyalty === "frequent" && c.totalBookings < 2) return false;
        if (loyalty === "upcoming" && !c.nextBooking) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "bookings") {
          return b.totalBookings - a.totalBookings || b.lastBookingDate.localeCompare(a.lastBookingDate);
        }
        if (sortBy === "recent") {
          return b.lastBookingDate.localeCompare(a.lastBookingDate) || b.totalBookings - a.totalBookings;
        }
        return a.clientName.localeCompare(b.clientName, "fr");
      });
  }, [initialClients, search, salon, loyalty, sortBy]);

  const shown = filtered.slice(0, limit);
  const resetPaging = () => setLimit(PAGE);

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar: search first, it is what this page is for. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <label className="search-field w-full md:max-w-[420px]">
          <span className="shrink-0" style={{ color: "var(--ink-faint)" }}>
            <Search size={16} />
          </span>
          <input
            type="search"
            placeholder="Nom, téléphone ou service"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPaging();
            }}
            aria-label="Rechercher un client"
            autoComplete="off"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px]"
              style={{ color: "var(--ink-soft)" }}
              aria-label="Effacer la recherche"
            >
              <Close size={14} />
            </button>
          ) : null}
        </label>

        <div className="flex items-center gap-2 md:ml-auto">
          {allSalons.length > 1 ? (
            <div className="min-w-0 flex-1 md:w-[180px] md:flex-none">
              <SelectDropdown<string>
                value={salon}
                onChange={(value) => {
                  setSalon(value);
                  resetPaging();
                }}
                options={[
                  { value: "all", label: "Tous les salons" },
                  ...allSalons.map((s) => ({ value: s, label: s })),
                ]}
              />
            </div>
          ) : null}
          <div className="min-w-0 flex-1 md:w-[200px] md:flex-none">
            <SelectDropdown<SortBy>
              value={sortBy}
              onChange={setSortBy}
              options={[
                { value: "recent", label: "Récents" },
                { value: "bookings", label: "Plus de rdv" },
                { value: "name", label: "De A à Z" },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="radiogroup" aria-label="Filtrer les clients">
        {(
          [
            ["all", "Tous", stats.total],
            ["upcoming", "Rendez-vous à venir", stats.upcoming],
            ["frequent", "Fidèles", stats.frequent],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={loyalty === value}
            onClick={() => {
              setLoyalty(value);
              resetPaging();
            }}
            className="filter-chip"
          >
            {label}
            <span data-nums>{count}</span>
          </button>
        ))}
      </div>

      <p className="t-small" style={{ color: "var(--ink-faint)" }} aria-live="polite" data-nums>
        {filtered.length === initialClients.length
          ? `${filtered.length} clients`
          : `${filtered.length} sur ${initialClients.length} clients`}
      </p>

      {filtered.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-12 text-center">
          <p className="t-heading">Aucun client trouvé</p>
          <p className="t-small mt-1" style={{ color: "var(--ink-faint)" }}>
            {initialClients.length === 0
              ? "Les clients apparaissent ici dès leur premier rendez-vous."
              : "Essayez un autre nom, un numéro ou retirez un filtre."}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div
            className="hidden border-b px-4 py-2.5 text-[12px] font-semibold lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_120px_150px_70px_96px] lg:gap-4"
            style={{ borderColor: "var(--line)", color: "var(--ink-soft)", background: "var(--surface-hover)" }}
          >
            <span>Client</span>
            <span>Dernière prestation</span>
            <span>Dernière visite</span>
            <span>Prochain rendez-vous</span>
            <span className="text-right">Total</span>
            <span />
          </div>
          <ul>
            {shown.map((client) => (
              <ClientRow
                key={`${client.clientPhone}-${client.clientName}`}
                client={client}
                today={today}
                onOpen={() => setOpenClient(client)}
              />
            ))}
          </ul>
        </div>
      )}

      {filtered.length > shown.length ? (
        <button type="button" className="btn-secondary self-center" onClick={() => setLimit((n) => n + PAGE)}>
          Afficher {Math.min(PAGE, filtered.length - shown.length)} clients de plus
          <span style={{ color: "var(--ink-faint)" }} data-nums>
            ({shown.length} sur {filtered.length})
          </span>
        </button>
      ) : null}

      {openClient ? (
        <ClientSheet client={openClient} today={today} onClose={() => setOpenClient(null)} />
      ) : null}
    </div>
  );
}

function ClientRow({
  client,
  today,
  onOpen,
}: {
  client: ClientSummary;
  today: string;
  onOpen: () => void;
}) {
  const next = client.nextBooking;
  return (
    <li className="client-row">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_120px_150px_70px] lg:gap-4"
        aria-label={`${client.clientName}, ${client.totalBookings} rendez-vous. Ouvrir l'historique`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="avatar" aria-hidden>
            {initialsOf(client.clientName)}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[14.5px] font-semibold" style={{ color: "var(--ink)" }}>
              {client.clientName}
            </span>
            <span className="truncate text-[13px]" style={{ color: "var(--ink-soft)" }} data-nums>
              {client.formattedPhone}
            </span>
            {/* Narrower screens fold the date columns into one line. */}
            {next || client.lastVisitDate ? (
              <span className="truncate text-[12.5px] lg:hidden" data-nums>
                {next ? (
                  <span className="font-semibold" style={{ color: "var(--accent-ink)" }}>
                    Prochain {shortDate(next.bookingDate, today)} à {minutesToLabel(next.startMin)}
                  </span>
                ) : (
                  <span style={{ color: "var(--ink-faint)" }}>
                    Venu le {shortDate(client.lastVisitDate ?? today, today)}
                  </span>
                )}
              </span>
            ) : null}
          </span>
        </span>

        <span className="hidden truncate text-[13.5px] lg:block" style={{ color: "var(--ink-soft)" }}>
          {client.lastService || "Aucune"}
        </span>
        <span className="hidden text-[13.5px] lg:block" style={{ color: "var(--ink-soft)" }} data-nums>
          {client.lastVisitDate ? shortDate(client.lastVisitDate, today) : "Jamais venu"}
        </span>
        <span className="hidden text-[13.5px] lg:block" data-nums>
          {next ? (
            <span className="font-semibold" style={{ color: "var(--accent-ink)" }}>
              {shortDate(next.bookingDate, today)} · {minutesToLabel(next.startMin)}
            </span>
          ) : (
            <span style={{ color: "var(--ink-faint)" }}>Aucun</span>
          )}
        </span>
        <span className="ml-auto shrink-0 text-right lg:ml-0">
          <span className={client.totalBookings >= 2 ? "chip chip-accent" : "chip"} data-nums>
            {client.totalBookings} rdv
          </span>
        </span>
      </button>

      <span className="flex shrink-0 items-center pr-2 lg:w-[96px] lg:justify-end lg:gap-1">
        {client.clientPhone ? (
          <a
            href={chatLink(client.clientPhone)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-icon"
            style={{ color: "var(--whatsapp)" }}
            aria-label={`Écrire à ${client.clientName} sur WhatsApp`}
            title="Écrire sur WhatsApp"
          >
            <WhatsApp size={20} />
          </a>
        ) : null}
        <span className="hidden lg:inline-flex" style={{ color: "var(--ink-faint)" }} aria-hidden>
          <ChevronRight size={18} />
        </span>
      </span>
    </li>
  );
}

const STATUS_WORDS = {
  done: "Terminé",
  cancelled: "Annulé",
  confirmed: "Confirmé",
} as const;

function ClientSheet({
  client,
  today,
  onClose,
}: {
  client: ClientSummary;
  today: string;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  });

  useEffect(() => {
    const returnFocusTo = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const listener = (e: KeyboardEvent) => onKeyDown(e);
    document.addEventListener("keydown", listener);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", listener);
      document.body.style.overflow = previousOverflow;
      returnFocusTo?.focus?.();
    };
  }, []);

  const salonSlug = client.nextBooking
    ? client.recentBookings.find((b) => b.bookingDate === client.nextBooking?.bookingDate)?.salonSlug
    : client.recentBookings[0]?.salonSlug;

  return (
    <div
      className="sheet-backdrop anim-fade md:items-center md:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-title"
        tabIndex={-1}
        className="anim-sheet flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-[20px] outline-none md:max-w-[560px] md:rounded-[20px]"
        style={{ background: "var(--surface)", boxShadow: "var(--shadow-sheet)" }}
      >
        <div className="flex justify-center pt-2 md:hidden" aria-hidden>
          <span className="block h-1 w-9 rounded-full" style={{ background: "var(--line-strong)" }} />
        </div>

        <div className="flex items-start gap-3 border-b px-5 pb-4 pt-3 md:pt-5" style={{ borderColor: "var(--line)" }}>
          <span className="avatar avatar-lg" aria-hidden>
            {initialsOf(client.clientName)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="client-title" className="t-title truncate">
              {client.clientName}
            </h2>
            <p className="t-small" style={{ color: "var(--ink-soft)" }} data-nums>
              {client.formattedPhone}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-icon -mr-2 -mt-1" aria-label="Fermer">
            <Close size={20} />
          </button>
        </div>

        <dl className="grid grid-cols-3 gap-2 px-5 pt-4 text-center">
          {(
            [
              ["Rendez-vous", client.totalBookings],
              ["Terminés", client.doneBookings],
              ["Annulés", client.cancelledBookings],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex flex-col-reverse rounded-[10px] py-2.5" style={{ background: "var(--surface-sunk)" }}>
              <dt className="text-[12px]" style={{ color: "var(--ink-soft)" }}>
                {label}
              </dt>
              <dd className="text-[18px] font-semibold leading-6" data-nums>
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <h3 className="mb-2 text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
            Derniers rendez-vous
          </h3>
          <ol className="flex flex-col gap-1.5">
            {client.recentBookings.map((b) => (
              <li
                key={b.id}
                className="flex items-center gap-3 rounded-[10px] border px-3 py-2.5"
                style={{
                  borderColor: "var(--line)",
                  background: b.status === "cancelled" ? "var(--surface-sunk)" : "var(--surface)",
                }}
              >
                <span className="w-[74px] shrink-0" data-nums>
                  <span className="block text-[13px] font-semibold">{shortDate(b.bookingDate, today)}</span>
                  <span className="block text-[12px]" style={{ color: "var(--ink-faint)" }}>
                    {minutesToLabel(b.startMin)}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-[13.5px] font-medium"
                    style={{
                      color: b.status === "cancelled" ? "var(--ink-faint)" : "var(--ink)",
                      textDecoration: b.status === "cancelled" ? "line-through" : undefined,
                    }}
                  >
                    {b.service}
                  </span>
                  <span className="block truncate text-[12px]" style={{ color: "var(--ink-faint)" }} data-nums>
                    {b.salonName} · {formatDuration(b.durationMin)}
                  </span>
                </span>
                <span
                  className={b.status === "done" ? "chip chip-success" : b.status === "confirmed" && b.bookingDate >= today ? "chip chip-accent" : "chip"}
                >
                  {b.status === "done" ? <Check size={12} /> : null}
                  {b.status === "confirmed" && b.bookingDate < today ? "Passé" : STATUS_WORDS[b.status]}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div
          className="flex gap-2 border-t px-5 pt-3"
          style={{ borderColor: "var(--line)", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
        >
          {client.clientPhone ? (
            <a
              href={chatLink(client.clientPhone)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary flex-1"
            >
              <span style={{ color: "var(--whatsapp)" }}>
                <WhatsApp size={18} />
              </span>
              WhatsApp
            </a>
          ) : null}
          <Link
            href={`/bookings?salon=${salonSlug ?? "vip"}&date=${client.nextBooking?.bookingDate ?? today}`}
            className="btn-primary flex-1"
            onClick={onClose}
          >
            {client.nextBooking ? <ArrowUpRight size={18} /> : <Plus size={18} />}
            {client.nextBooking ? "Voir au planning" : "Réserver"}
          </Link>
        </div>
      </div>
    </div>
  );
}
