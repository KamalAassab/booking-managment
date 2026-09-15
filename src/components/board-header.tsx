"use client";

import { useRef, type RefObject } from "react";

import { Calendar, ChevronLeft, ChevronRight, Close, Plus, Search } from "@/components/icons";
import { SalonSwitcher } from "@/components/salon-switcher";
import {
  formatDateRange,
  formatDayTitle,
  formatMonthYear,
  formatShortDate,
  isValidDateString,
  relativeDayLabel,
  weekDates,
} from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";

export type ViewMode = "day" | "week" | "month";
export type StreamState = "connecting" | "live" | "offline";

type Props = {
  salons: SalonDTO[];
  salon: SalonDTO;
  date: string;
  today: string;
  view: ViewMode;
  stream: StreamState;
  /** One line under the title: the salon and the count for what is shown. */
  subtitle: string;
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
  bookingsByDate: Map<string, BookingDTO[]>;
  onQueryChange: (query: string) => void;
  onNavigate: (date: string) => void;
  onStep: (direction: -1 | 1) => void;
  onViewChange: (view: ViewMode) => void;
  onSelectSalon: (slug: string) => void;
  onPrefetchSalon: (slug: string) => void;
  onCreate: () => void;
};

const VIEWS: readonly [ViewMode, string, string, string][] = [
  ["day", "Jour", "Jour", "1"],
  ["week", "Semaine", "Sem.", "2"],
  ["month", "Mois", "Mois", "3"],
];

const STEP_LABELS: Record<ViewMode, [string, string]> = {
  day: ["Jour précédent", "Jour suivant"],
  week: ["Semaine précédente", "Semaine suivante"],
  month: ["Mois précédent", "Mois suivant"],
};

const WEEKDAY_INITIALS = ["L", "M", "M", "J", "V", "S", "D"];

function titleFor(view: ViewMode, date: string, today: string): string {
  if (view === "day") return formatDayTitle(date, today);
  if (view === "week") {
    const days = weekDates(date);
    return formatDateRange(days[0], days[6]);
  }
  const { month, year } = formatMonthYear(date);
  return `${month} ${year}`;
}

function containsToday(view: ViewMode, date: string, today: string): boolean {
  if (view === "day") return date === today;
  if (view === "week") return weekDates(date).includes(today);
  return date.slice(0, 7) === today.slice(0, 7);
}

/**
 * Where am I, and how do I get somewhere else: the date on screen as the
 * title, the steps to either side of it, the view, the search, and the one
 * primary action. On a phone the same controls stack, the week becomes a
 * strip of seven tappable days, and "new booking" moves under the thumb.
 */
export function BoardHeader(props: Props) {
  const { salons, salon, date, today, view, stream, subtitle, onSelectSalon, onPrefetchSalon } = props;
  const title = titleFor(view, date, today);
  const relative = view === "day" ? relativeDayLabel(date, today) : null;
  // The phone already shows the salon in its switcher right above.
  const phoneDetail = subtitle.startsWith(`${salon.name} · `)
    ? subtitle.slice(salon.name.length + 3)
    : subtitle;

  return (
    <>
      {/* Phone: salon choice scrolls away with the page; the date controls
          below stay pinned. */}
      <div className="flex flex-col gap-2 px-4 pb-1 pt-3 md:hidden">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SalonSwitcher
              salons={salons}
              current={salon.slug}
              onSelect={onSelectSalon}
              onPrefetch={onPrefetchSalon}
            />
          </div>
          <LiveStatus state={stream} compact />
        </div>
        <ViewSwitcher view={view} onChange={props.onViewChange} fill />
      </div>

      <header
        className="sticky top-0 z-[20] border-b px-4 pb-2.5 pt-2.5 md:px-6 md:py-3"
        style={{
          borderColor: "var(--line)",
          background: "color-mix(in srgb, var(--paper) 92%, transparent)",
          backdropFilter: "blur(10px)",
        }}
      >
        {/* ---- md and up ---------------------------------------------- */}
        <div className="hidden items-center gap-x-4 gap-y-2.5 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:[grid-template-areas:'title_actions'_'nav_views'] xl:grid-cols-[auto_minmax(0,1fr)_auto_auto] xl:[grid-template-areas:'nav_title_views_actions']">
          <div className="flex min-w-0 flex-col [grid-area:title]">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="t-title truncate first-letter:uppercase">{title}</h1>
              {relative ? <span className="chip chip-accent shrink-0">{relative}</span> : null}
            </div>
            <p className="t-small truncate" style={{ color: "var(--ink-faint)" }}>
              {subtitle}
            </p>
          </div>

          <div className="[grid-area:nav]">
            <DateStepper {...props} />
          </div>

          <div className="[grid-area:views]">
            <ViewSwitcher view={view} onChange={props.onViewChange} />
          </div>

          <div className="flex items-center justify-end gap-2 [grid-area:actions]">
            <LiveStatus state={stream} />
            {view !== "month" ? <SearchField {...props} /> : null}
            <button
              type="button"
              onClick={props.onCreate}
              className="btn-primary shrink-0"
              title="Nouveau rendez-vous (N)"
            >
              <Plus size={18} />
              <span className="hidden lg:inline">Nouveau rendez-vous</span>
              <span className="lg:hidden">Nouveau</span>
            </button>
          </div>
        </div>

        {/* ---- phone ---------------------------------------------------- */}
        <div className="flex flex-col gap-2.5 md:hidden">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-icon"
              onClick={() => props.onStep(-1)}
              aria-label={STEP_LABELS[view][0]}
            >
              <ChevronLeft size={20} />
            </button>
            <DatePickerLabel date={date} onPick={props.onNavigate}>
              <span className="block truncate text-[16px] font-semibold leading-5 first-letter:uppercase">
                {title}
              </span>
              <span className="block truncate text-[12.5px] leading-4" style={{ color: "var(--ink-faint)" }}>
                {[relative, phoneDetail].filter(Boolean).join(" · ")}
              </span>
            </DatePickerLabel>
            <button
              type="button"
              className="btn-icon"
              onClick={() => props.onStep(1)}
              aria-label={STEP_LABELS[view][1]}
            >
              <ChevronRight size={20} />
            </button>
          </div>

          {view === "day" ? (
            <WeekStrip
              date={date}
              today={today}
              bookingsByDate={props.bookingsByDate}
              onNavigate={props.onNavigate}
            />
          ) : !containsToday(view, date, today) ? (
            <button type="button" className="btn-secondary btn-sm self-start" onClick={() => props.onNavigate(today)}>
              Revenir à aujourd&apos;hui
            </button>
          ) : null}
        </div>
      </header>
    </>
  );
}

function DateStepper({ view, date, today, onStep, onNavigate }: Props) {
  const [prev, next] = STEP_LABELS[view];
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="btn-icon h-10 w-10" onClick={() => onStep(-1)} aria-label={prev} title={`${prev} (←)`}>
        <ChevronLeft size={20} />
      </button>
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={() => onNavigate(today)}
        disabled={containsToday(view, date, today)}
        title="Aujourd'hui (T)"
      >
        Aujourd&apos;hui
      </button>
      <button type="button" className="btn-icon h-10 w-10" onClick={() => onStep(1)} aria-label={next} title={`${next} (→)`}>
        <ChevronRight size={20} />
      </button>
      <DatePickerButton date={date} onPick={onNavigate} />
    </div>
  );
}

/** Opens the browser's own date picker: instant, native, accessible. */
function openPicker(input: HTMLInputElement | null) {
  if (!input) return;
  try {
    input.showPicker();
  } catch {
    input.focus();
    input.click();
  }
}

function HiddenDateInput({
  inputRef,
  date,
  onPick,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  date: string;
  onPick: (date: string) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="date"
      value={date}
      min="2000-01-01"
      max="2100-12-31"
      onChange={(e) => {
        if (isValidDateString(e.target.value)) onPick(e.target.value);
      }}
      className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      tabIndex={-1}
      aria-hidden
    />
  );
}

function DatePickerButton({ date, onPick }: { date: string; onPick: (date: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className="btn-icon h-10 w-10"
        onClick={() => openPicker(ref.current)}
        aria-label="Aller à une date"
        title="Aller à une date"
      >
        <Calendar size={19} />
      </button>
      <HiddenDateInput inputRef={ref} date={date} onPick={onPick} />
    </span>
  );
}

function DatePickerLabel({
  date,
  onPick,
  children,
}: {
  date: string;
  onPick: (date: string) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="relative flex min-w-0 flex-1">
      <button
        type="button"
        onClick={() => openPicker(ref.current)}
        className="min-h-[44px] min-w-0 flex-1 rounded-[10px] px-1 text-center"
        aria-label="Aller à une date"
      >
        {children}
      </button>
      <HiddenDateInput inputRef={ref} date={date} onPick={onPick} />
    </span>
  );
}

function ViewSwitcher({
  view,
  onChange,
  short = false,
  fill = false,
}: {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
  short?: boolean;
  /** Full width, equal segments: the phone's version. */
  fill?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Vue du calendrier"
      className={`segmented ${fill ? "seg-fill flex w-full" : "shrink-0"} ${short ? "seg-short" : ""}`}
    >
      {VIEWS.map(([value, label, shortLabel, key]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={view === value}
          onClick={() => onChange(value)}
          title={`${label} (${key})`}
          aria-label={label}
        >
          {short ? shortLabel : label}
        </button>
      ))}
    </div>
  );
}

function SearchField({ query, onQueryChange, searchRef }: Props) {
  return (
    <label className="search-field">
      <span className="shrink-0" style={{ color: "var(--ink-faint)" }}>
        <Search size={16} />
      </span>
      <input
        ref={searchRef}
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query) {
            e.preventDefault();
            onQueryChange("");
          }
        }}
        placeholder="Client, service, téléphone"
        aria-label="Rechercher un rendez-vous"
        autoComplete="off"
        spellCheck={false}
      />
      {query ? (
        <button
          type="button"
          onClick={() => onQueryChange("")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]"
          style={{ color: "var(--ink-soft)" }}
          aria-label="Effacer la recherche"
        >
          <Close size={14} />
        </button>
      ) : (
        <kbd className="kbd hidden xl:inline-flex">/</kbd>
      )}
    </label>
  );
}

function WeekStrip({
  date,
  today,
  bookingsByDate,
  onNavigate,
}: {
  date: string;
  today: string;
  bookingsByDate: Map<string, BookingDTO[]>;
  onNavigate: (date: string) => void;
}) {
  return (
    <div className="grid grid-cols-7 gap-1" role="group" aria-label="Jours de la semaine">
      {weekDates(date).map((d, i) => {
        const count = bookingsByDate.get(d)?.length ?? 0;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onNavigate(d)}
            className="strip-day"
            aria-pressed={d === date}
            data-today={d === today ? "" : undefined}
            data-past={d < today ? "" : undefined}
            aria-label={`${formatShortDate(d)}, ${count} rendez-vous`}
          >
            <span className="text-[11px] font-medium leading-3">{WEEKDAY_INITIALS[i]}</span>
            <span className="text-[16px] font-semibold leading-5" data-nums>
              {Number(d.slice(8))}
            </span>
            <span className="strip-count" data-nums>
              {count > 0 ? count : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function LiveStatus({ state, compact = false }: { state: StreamState; compact?: boolean }) {
  const map = {
    live: { label: "En direct", color: "var(--success)" },
    connecting: { label: "Connexion", color: "var(--ink-ghost)" },
    offline: { label: "Hors ligne", color: "var(--danger)" },
  } as const;
  const { label, color } = map[state];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium"
      style={{ color: state === "offline" ? "var(--danger)" : "var(--ink-faint)" }}
      title={state === "offline" ? "Hors ligne : les changements des autres postes arriveront à la reconnexion" : label}
      role="status"
    >
      <span className="block h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
      <span className={compact ? "sr-only" : "hidden 2xl:inline"}>{label}</span>
    </span>
  );
}
