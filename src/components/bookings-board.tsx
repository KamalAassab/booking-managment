"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { BookingDialog } from "@/components/booking-dialog";
import { DayGrid } from "@/components/day-grid";
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
  // The page remounts this component on every salon/day change (see the
  // `key` in bookings/page.tsx), so the server render is always the starting
  // point and there is no stale-props effect to keep in sync.
  const [bookings, setBookings] = useState(initialBookings);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [mode, setDeviceMode] = useDeviceMode();
  const [stream, setStream] = useState<StreamState>("connecting");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const today = todayInSalonTz();

  // ── Device preferences ────────────────────────────────────────────────
  useEffect(() => {
    // A front desk always opens on its own salon. Only redirect when the URL
    // was not asked for explicitly, which the server guarantees by always
    // writing ?salon= — so we compare against the remembered value and only
    // act on the very first load of the session.
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
    // Intentionally first-mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = useCallback(
    (nextSalon: string, nextDate: string) => {
      if (nextSalon !== salon.slug) writeSalonPreference(nextSalon);
      router.push(`/bookings?salon=${nextSalon}&date=${nextDate}`);
    },
    [router, salon.slug],
  );

  // ── Live updates ──────────────────────────────────────────────────────
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
      // The stream will catch us up; a failed manual refetch is not worth a
      // message to a user who is mid-call.
    }
  }, [salon.slug, date, router]);

  useEffect(() => {
    // Poll a two-number change watermark and refetch the day only when it
    // moves. This replaced a Server-Sent Events stream: see the comment in
    // src/app/api/bookings/watermark/route.ts for why that design could not
    // survive on Vercel. Perceived latency is unchanged — the stream polled
    // the same query server-side, once a second, per connection.
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
      // Nobody is looking; do not spend a request or wake the database.
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
        // Back off rather than hammering a database that is already
        // struggling; capped so recovery is still quick once it returns.
        schedule(Math.min(POLL_MS * 2 ** consecutiveFailures, POLL_MAX_BACKOFF_MS));
      }
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        setStream("offline");
        return;
      }
      // Coming back to the tab: catch up straight away rather than waiting
      // out whatever remained of the interval.
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

  // Same-browser tabs (screen A and a second window) update instantly rather
  // than waiting up to a second for the stream to notice.
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

  const activeBookings = useMemo(
    () => bookings.filter((b) => b.status !== "cancelled"),
    [bookings],
  );

  const bookedCount = activeBookings.length;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header
        className="sticky top-0 z-20 border-b backdrop-blur"
        style={{
          background: "color-mix(in srgb, var(--panel) 92%, transparent)",
          borderColor: "var(--panel-border)",
        }}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
          <div className="mr-auto flex items-baseline gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">
              Atelier
            </span>
            <span
              className="text-xs font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Planning
            </span>
          </div>

          <StreamBadge state={stream} />

          <ModeSwitch mode={mode} onChange={setDeviceMode} />

          {role === "owner" ? (
            <a href="/owner" className="btn-ghost !px-3 !py-1.5 text-xs">
              Espace propriétaire
            </a>
          ) : null}

          <form action={logout}>
            <button type="submit" className="btn-ghost !px-3 !py-1.5 text-xs">
              Déconnexion
            </button>
          </form>
        </div>

        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-3 px-4 pb-3">
          <nav
            className="flex flex-wrap gap-1 rounded-xl p-1"
            style={{ background: "var(--surface)" }}
            aria-label="Salon"
          >
            {salons.map((s) => (
              <button
                key={s.slug}
                type="button"
                onClick={() => navigate(s.slug, date)}
                aria-current={s.slug === salon.slug ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  s.slug === salon.slug
                    ? "bg-brand-600 text-white shadow-sm"
                    : "hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                {s.name.replace(/^L'Atelier /, "")}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(salon.slug, addDays(date, -1))}
              className="btn-ghost !px-3 !py-1.5"
              aria-label="Jour précédent"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => navigate(salon.slug, today)}
              className="btn-ghost !px-3 !py-1.5 text-xs"
              disabled={date === today}
            >
              Aujourd&apos;hui
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value) navigate(salon.slug, e.target.value);
              }}
              className="field !w-auto !py-1.5 text-sm"
              aria-label="Date"
            />
            <button
              type="button"
              onClick={() => navigate(salon.slug, addDays(date, 1))}
              className="btn-ghost !px-3 !py-1.5"
              aria-label="Jour suivant"
            >
              →
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {salon.name}
            </h1>
            <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
              <span className="first-letter:uppercase">
                {formatLongDate(date)}
              </span>
              {date === today ? " · aujourd'hui" : ""}
            </p>
          </div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            <span className="font-semibold" style={{ color: "var(--text)" }}>
              {bookedCount}
            </span>{" "}
            rendez-vous
          </p>
        </div>

        <DayGrid
          salon={salon}
          date={date}
          today={today}
          bookings={bookings}
          onSelectSlot={(startMin) => setDialog({ kind: "create", startMin })}
          onSelectBooking={(booking) => setDialog({ kind: "edit", booking })}
        />
      </main>

      {dialog ? (
        <BookingDialog
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

function StreamBadge({ state }: { state: StreamState }) {
  const map = {
    live: { label: "En direct", color: "bg-emerald-500" },
    connecting: { label: "Connexion…", color: "bg-amber-500" },
    offline: { label: "Hors ligne", color: "bg-ink-400" },
  } as const;
  const { label, color } = map[state];

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium"
      style={{ color: "var(--text-muted)" }}
      aria-live="polite"
    >
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />
      {label}
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
      className="flex gap-0.5 rounded-lg p-0.5 text-xs"
      style={{ background: "var(--surface)" }}
      role="radiogroup"
      aria-label="Type de poste"
      title="Un poste centre d'appels ouvre WhatsApp pré-rempli après chaque réservation."
    >
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
          className={`rounded-md px-2.5 py-1 font-semibold transition ${
            mode === value
              ? "bg-brand-600 text-white"
              : "hover:bg-black/5 dark:hover:bg-white/5"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
