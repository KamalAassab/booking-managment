"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { BookingSheet } from "@/components/booking-sheet";
import { DayGrid } from "@/components/day-grid";
import { DayStrip } from "@/components/day-strip";
import { ChevronLeft, ChevronRight, Plus, Power } from "@/components/icons";
import { SalonSwitcher, shortName } from "@/components/salon-switcher";
import { Toast, type ToastMessage } from "@/components/toast";
import { logout } from "@/app/actions/auth";
import {
  readSalonPreference,
  useDeviceMode,
  writeSalonPreference,
  type DeviceMode,
} from "@/lib/device";
import { addDays, formatLongDate, todayInSalonTz } from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";

type Props = {
  salons: SalonDTO[];
  salon: SalonDTO;
  date: string;
  initialBookings: BookingDTO[];
  role: "staff" | "owner";
};

export type DialogState =
  | { kind: "create"; startMin: number }
  | { kind: "edit"; booking: BookingDTO }
  | null;

type StreamState = "connecting" | "live" | "offline";

/**
 * How often the calendar asks whether anything changed. Two seconds is the
 * business requirement ("the slot disappears while the other agent is still
 * talking") met at a cost of roughly 1,800 tiny requests per tab per hour,
 * each one an indexed two-value aggregate.
 */
const POLL_MS = 2000;
/** Hidden tabs check rarely, purely to notice when they become visible. */
const POLL_IDLE_MS = 30_000;
/** Ceiling for the exponential backoff after repeated failures. */
const POLL_MAX_BACKOFF_MS = 30_000;

export function BookingsBoard({
  salons,
  salon,
  date,
  initialBookings,
  role,
}: Props) {
  const router = useRouter();
  const [bookings, setBookings] = useState(initialBookings);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [mode, setDeviceMode] = useDeviceMode();
  const [stream, setStream] = useState<StreamState>("connecting");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const today = todayInSalonTz();

  useEffect(() => {
    const remembered = readSalonPreference();
    if (
      remembered &&
      remembered !== salon.slug &&
      salons.some((s) => s.slug === remembered) &&
      !window.sessionStorage.getItem("atelier.salon.applied")
    ) {
      window.sessionStorage.setItem("atelier.salon.applied", "1");
      router.replace(`/bookings?salon=${remembered}&date=${date}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = useCallback(
    (nextSalon: string, nextDate: string) => {
      if (nextSalon !== salon.slug) writeSalonPreference(nextSalon);
      router.push(`/bookings?salon=${nextSalon}&date=${nextDate}`);
    },
    [router, salon.slug],
  );

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/bookings?salon=${encodeURIComponent(salon.slug)}&date=${date}`,
        { cache: "no-store" },
      );
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { bookings: BookingDTO[] };
      setBookings(data.bookings);
    } catch {
      // The next poll catches us up; a failed manual refetch is not worth a
      // message to someone who is mid-call.
    }
  }, [salon.slug, date, router]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastWatermark: string | null = null;
    let consecutiveFailures = 0;

    const schedule = (ms: number) => {
      if (cancelled) return;
      timer = setTimeout(poll, ms);
    };

    const poll = async () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return schedule(POLL_IDLE_MS);

      try {
        const res = await fetch(
          `/api/bookings/watermark?salon=${encodeURIComponent(salon.slug)}&date=${date}`,
          { cache: "no-store" },
        );
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));

        const { watermark } = (await res.json()) as { watermark: string };
        consecutiveFailures = 0;
        setStream("live");

        if (lastWatermark !== null && watermark !== lastWatermark) {
          await refetch();
        }
        lastWatermark = watermark;
        schedule(POLL_MS);
      } catch {
        consecutiveFailures += 1;
        if (consecutiveFailures >= 2) setStream("offline");
        schedule(
          Math.min(POLL_MS * 2 ** consecutiveFailures, POLL_MAX_BACKOFF_MS),
        );
      }
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        setStream("offline");
        return;
      }
      if (timer) clearTimeout(timer);
      consecutiveFailures = 0;
      void refetch();
      void poll();
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [salon.slug, date, refetch, router]);

  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("atelier.bookings");
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent) => {
      const msg = event.data as { salon: string; date: string };
      if (msg?.salon === salon.slug && msg?.date === date) void refetch();
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [salon.slug, date, refetch]);

  const announceChange = useCallback(() => {
    channelRef.current?.postMessage({ salon: salon.slug, date });
    void refetch();
  }, [salon.slug, date, refetch]);

  const activeCount = useMemo(
    () => bookings.filter((b) => b.status !== "cancelled").length,
    [bookings],
  );

  /** The first free slot, so the primary action always has somewhere to go. */
  const firstFreeSlot = useMemo(() => {
    const taken = new Set<number>();
    for (const b of bookings) {
      if (b.status === "cancelled") continue;
      for (
        let t = b.startMin;
        t < b.startMin + b.durationMin;
        t += salon.slotMin
      ) {
        taken.add(t);
      }
    }
    for (let t = salon.opensAtMin; t < salon.closesAtMin; t += salon.slotMin) {
      if (!taken.has(t)) return t;
    }
    return salon.opensAtMin;
  }, [bookings, salon]);

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* ---- Sidebar: desktop only ------------------------------------ */}
      <aside
        className="hidden w-[200px] shrink-0 flex-col gap-6 border-r p-5 lg:sticky lg:top-0 lg:flex lg:h-dvh"
        style={{ borderColor: "var(--line)", background: "var(--surface)" }}
      >
        <div>
          <p className="t-title">Atelier</p>
          <p className="t-small" style={{ color: "var(--ink-faint)" }}>
            Planning
          </p>
        </div>

        <SalonSwitcher
          salons={salons}
          current={salon.slug}
          onSelect={(slug) => navigate(slug, date)}
          variant="list"
        />

        <div className="mt-auto flex flex-col gap-1">
          <ModeSwitch mode={mode} onChange={setDeviceMode} />
          {role === "owner" ? (
            <a
              href="/owner"
              className="rounded-[10px] px-3 py-2.5 text-[13px] transition-colors duration-[120ms] hover:bg-[color:var(--surface-sunk)]"
              style={{ color: "var(--ink-soft)" }}
            >
              Espace propriétaire
            </a>
          ) : null}
          <form action={logout}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2.5 text-left text-[13px] transition-colors duration-[120ms] hover:bg-[color:var(--surface-sunk)]"
              style={{ color: "var(--ink-soft)" }}
            >
              <Power size={16} />
              Déconnexion
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---- Header ------------------------------------------------- */}
        <header
          className="sticky top-0 z-20 border-b px-4 pt-3 md:px-6 lg:px-8"
          style={{
            borderColor: "var(--line)",
            background: "color-mix(in srgb, var(--surface) 94%, transparent)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div className="mx-auto flex max-w-[720px] flex-col gap-3">
            <div className="flex items-center gap-3 lg:hidden">
              <p className="t-title mr-auto">Atelier</p>
              <LiveDot state={stream} />
              <form action={logout}>
                <button
                  type="submit"
                  className="flex h-9 w-9 items-center justify-center rounded-[10px]"
                  style={{ color: "var(--ink-soft)" }}
                  aria-label="Déconnexion"
                >
                  <Power size={18} />
                </button>
              </form>
            </div>

            <div className="lg:hidden">
              <SalonSwitcher
                salons={salons}
                current={salon.slug}
                onSelect={(slug) => navigate(slug, date)}
              />
            </div>

            <div className="flex items-baseline gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="t-title">
                  <span className="first-letter:uppercase">
                    {formatLongDate(date)}
                  </span>
                </h1>
                <p className="t-small" style={{ color: "var(--ink-faint)" }}>
                  <span className="hidden lg:inline">
                    {shortName(salon.name)} ·{" "}
                  </span>
                  <span data-nums>{activeCount}</span> rendez-vous
                  {date === today ? " · aujourd'hui" : ""}
                </p>
              </div>

              <div className="hidden items-center gap-1 lg:flex">
                <LiveDot state={stream} />
              </div>

              {/* The arrows are desktop-only: on a phone the day strip below
                  already moves between days, and duplicating it here was what
                  squeezed the date into "mardi 8 septem…". */}
              <div className="hidden items-center gap-0.5 lg:flex">
                <IconButton
                  label="Jour précédent"
                  onClick={() => navigate(salon.slug, addDays(date, -1))}
                >
                  <ChevronLeft size={18} />
                </IconButton>
                <IconButton
                  label="Jour suivant"
                  onClick={() => navigate(salon.slug, addDays(date, 1))}
                >
                  <ChevronRight size={18} />
                </IconButton>
              </div>

              {/* Only offered when it would do something. */}
              {date !== today ? (
                <button
                  type="button"
                  onClick={() => navigate(salon.slug, today)}
                  className="t-small shrink-0 rounded-[8px] px-2.5 py-1.5 transition-colors duration-[120ms] hover:bg-[color:var(--surface-sunk)]"
                  style={{ color: "var(--brass)" }}
                >
                  Aujourd&apos;hui
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-3 pb-3">
              <div className="min-w-0 flex-1">
                <DayStrip
                  date={date}
                  today={today}
                  onSelect={(d) => navigate(salon.slug, d)}
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  setDialog({ kind: "create", startMin: firstFreeSlot })
                }
                className="btn-primary btn-sm hidden shrink-0 lg:inline-flex"
              >
                <Plus size={16} />
                Nouveau
              </button>
            </div>
          </div>
        </header>

        {/* ---- Grid --------------------------------------------------- */}
        <main className="flex-1 px-4 pb-28 pt-4 md:px-6 lg:px-8 lg:pb-10">
          <div className="mx-auto max-w-[720px]">
            <DayGrid
              salon={salon}
              date={date}
              today={today}
              bookings={bookings}
              onSelectSlot={(startMin) => setDialog({ kind: "create", startMin })}
              onSelectBooking={(booking) => setDialog({ kind: "edit", booking })}
            />

            {activeCount === 0 ? (
              <p
                className="t-small mt-4 text-center"
                style={{ color: "var(--ink-faint)" }}
              >
                Aucun rendez-vous. Touchez un créneau pour en ajouter un.
              </p>
            ) : null}
          </div>

          {/* Live changes arriving from another device are announced rather
              than appearing silently. */}
          <p aria-live="polite" className="sr-only">
            {activeCount} rendez-vous ce jour.
          </p>
        </main>
      </div>

      {/* ---- Action bar: mobile, under the thumb ---------------------- */}
      <div
        className="fixed inset-x-0 bottom-0 z-20 border-t px-4 py-3 lg:hidden"
        style={{
          borderColor: "var(--line)",
          background: "color-mix(in srgb, var(--surface) 94%, transparent)",
          backdropFilter: "blur(8px)",
          paddingBottom: "max(12px, env(safe-area-inset-bottom))",
        }}
      >
        <button
          type="button"
          onClick={() => setDialog({ kind: "create", startMin: firstFreeSlot })}
          className="btn-primary w-full"
        >
          <Plus size={18} />
          Nouveau rendez-vous
        </button>
      </div>

      {dialog ? (
        <BookingSheet
          state={dialog}
          salon={salon}
          date={date}
          bookings={bookings}
          mode={mode}
          onClose={() => setDialog(null)}
          onChanged={announceChange}
          onToast={setToast}
        />
      ) : null}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-[8px] transition-colors duration-[120ms] hover:bg-[color:var(--surface-sunk)]"
      style={{ color: "var(--ink-soft)" }}
    >
      {children}
    </button>
  );
}

function LiveDot({ state }: { state: StreamState }) {
  const map = {
    live: { label: "En direct", color: "var(--brass)" },
    connecting: { label: "Connexion", color: "var(--ink-faint)" },
    offline: { label: "Hors ligne", color: "var(--ink-faint)" },
  } as const;
  const { label, color } = map[state];

  return (
    <span
      className="t-small inline-flex items-center gap-1.5"
      style={{ color: "var(--ink-faint)" }}
      title={label}
    >
      <span
        className="block h-1.5 w-1.5 rounded-full"
        style={{ background: color, opacity: state === "live" ? 1 : 0.5 }}
        aria-hidden
      />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: DeviceMode;
  onChange: (mode: DeviceMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Type de poste"
      className="mb-2 flex flex-col gap-0.5"
    >
      <span className="label mb-1.5">Poste</span>
      {(
        [
          ["front_desk", "Réception"],
          ["call_center", "Centre d'appels"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          onClick={() => onChange(value)}
          className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-left text-[13px] transition-colors duration-[120ms]"
          style={{
            background: mode === value ? "var(--surface-sunk)" : "transparent",
            color: mode === value ? "var(--ink)" : "var(--ink-soft)",
            fontWeight: mode === value ? 600 : 400,
          }}
        >
          <span
            className="block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{
              background: mode === value ? "var(--brass)" : "var(--line-strong)",
            }}
            aria-hidden
          />
          {label}
        </button>
      ))}
    </div>
  );
}
