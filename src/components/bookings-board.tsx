"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { BookingSheet } from "@/components/booking-sheet";
import { DayGrid } from "@/components/day-grid";
import { Bell, Plus, Power, Search } from "@/components/icons";
import { MonthCalendar } from "@/components/month-calendar";
import { ScheduledPanel } from "@/components/scheduled-panel";
import { SalonSwitcher, shortName } from "@/components/salon-switcher";
import { Sidebar } from "@/components/sidebar";
import { Toast, type ToastMessage } from "@/components/toast";
import { WeekGrid } from "@/components/week-grid";
import { logout } from "@/app/actions/auth";
import {
  readSalonPreference,
  useDeviceMode,
  writeSalonPreference,
} from "@/lib/device";
import {
  addMonths,
  formatLongDate,
  isValidDateString,
  monthMatrix,
  nowMinutesInSalonTz,
  startOfMonth,
  todayInSalonTz,
} from "@/lib/time";
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
type ViewMode = "day" | "week" | "month";

/**
 * How often the calendar asks whether anything changed. Two seconds is the
 * business requirement ("the slot disappears while the other agent is still
 * talking") met at a cost of roughly 1,800 tiny requests per tab per hour,
 * each one an indexed two-value aggregate.
 */
/**
 * Accelerated polling for 5 concurrent users:
 * 750ms when tab is focused and visible to guarantee sub-second real-time sync.
 */
const POLL_MS = 750;
/** Hidden tabs check rarely, purely to notice when they become visible. */
const POLL_IDLE_MS = 5000;
/** Ceiling for the exponential backoff after repeated failures. */
const POLL_MAX_BACKOFF_MS = 10_000;

export function BookingsBoard({
  salons,
  salon: initialSalon,
  date: initialDate,
  initialBookings,
  role,
}: Props) {
  const router = useRouter();

  // Active salon and date managed in client state for 0s instantaneous transitions
  const [currentSalonSlug, setCurrentSalonSlug] = useState(initialSalon.slug);
  const [currentDate, setCurrentDate] = useState(initialDate);

  const salon = useMemo(
    () => salons.find((s) => s.slug === currentSalonSlug) ?? initialSalon,
    [salons, currentSalonSlug, initialSalon],
  );
  const date = currentDate;

  const [bookings, setBookings] = useState(initialBookings);
  const [monthBookings, setMonthBookings] = useState<BookingDTO[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [mode, setDeviceMode] = useDeviceMode();
  const [stream, setStream] = useState<StreamState>("connecting");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("day");
  const today = todayInSalonTz();

  // In-memory caches for 0s instant switching
  const bookingsCacheRef = useRef<Map<string, BookingDTO[]>>(new Map());
  const monthCacheRef = useRef<Map<string, BookingDTO[]>>(new Map());

  // Seed cache on mount or when initial props change
  useEffect(() => {
    bookingsCacheRef.current.set(
      `${initialSalon.slug}:${initialDate}`,
      initialBookings,
    );
  }, [initialSalon.slug, initialDate, initialBookings]);

  useEffect(() => {
    const remembered = readSalonPreference();
    if (
      remembered &&
      remembered !== salon.slug &&
      salons.some((s) => s.slug === remembered) &&
      !window.sessionStorage.getItem("atelier.salon.applied")
    ) {
      window.sessionStorage.setItem("atelier.salon.applied", "1");
      setCurrentSalonSlug(remembered);
      const nextUrl = `/bookings?salon=${encodeURIComponent(remembered)}&date=${encodeURIComponent(date)}`;
      window.history.replaceState({ salon: remembered, date }, "", nextUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchDay = useCallback(
    async (salonSlug: string, targetDate: string) => {
      try {
        const res = await fetch(
          `/api/bookings?salon=${encodeURIComponent(salonSlug)}&date=${encodeURIComponent(targetDate)}`,
          { cache: "no-store" },
        );
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { bookings: BookingDTO[] };
        bookingsCacheRef.current.set(`${salonSlug}:${targetDate}`, data.bookings);
        if (currentSalonSlug === salonSlug && currentDate === targetDate) {
          setBookings(data.bookings);
        }
      } catch {
        // Best effort
      }
    },
    [currentSalonSlug, currentDate, router],
  );

  /**
   * 0s Instant Navigation:
   * 1. Updates state synchronously (0ms)
   * 2. Immediately loads from in-memory cache if present (0ms)
   * 3. Syncs browser URL via pushState with NO server roundtrip
   * 4. SWR revalidates in the background
   */
  const navigate = useCallback(
    (nextSalon: string, nextDate: string) => {
      if (nextSalon !== currentSalonSlug) writeSalonPreference(nextSalon);
      setCurrentSalonSlug(nextSalon);
      setCurrentDate(nextDate);

      const nextUrl = `/bookings?salon=${encodeURIComponent(nextSalon)}&date=${encodeURIComponent(nextDate)}`;
      window.history.pushState(
        { salon: nextSalon, date: nextDate },
        "",
        nextUrl,
      );

      const cacheKey = `${nextSalon}:${nextDate}`;
      const cached = bookingsCacheRef.current.get(cacheKey);
      if (cached) {
        setBookings(cached);
      }

      void fetchDay(nextSalon, nextDate);
    },
    [currentSalonSlug, fetchDay],
  );

  // Instant back/forward navigation support
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const s = params.get("salon");
      const d = params.get("date");
      if (s && salons.some((item) => item.slug === s)) {
        setCurrentSalonSlug(s);
      }
      if (d && isValidDateString(d)) {
        setCurrentDate(d);
        const cached = bookingsCacheRef.current.get(
          `${s || currentSalonSlug}:${d}`,
        );
        if (cached) setBookings(cached);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [salons, currentSalonSlug]);

  // Aggressive idle prefetching of adjacent ±3 days so navigation is instant
  useEffect(() => {
    const daysToPrefetch: string[] = [];
    const base = new Date(date + "T12:00:00Z");
    for (let offset = -2; offset <= 4; offset++) {
      if (offset === 0) continue;
      const d = new Date(base.getTime() + offset * 86_400_000);
      const str = d.toISOString().slice(0, 10);
      const cacheKey = `${salon.slug}:${str}`;
      if (!bookingsCacheRef.current.has(cacheKey)) {
        daysToPrefetch.push(str);
      }
    }

    if (daysToPrefetch.length === 0) return;

    let cancelled = false;
    const runPrefetch = async () => {
      for (const targetDate of daysToPrefetch) {
        if (cancelled) break;
        try {
          const res = await fetch(
            `/api/bookings?salon=${encodeURIComponent(salon.slug)}&date=${encodeURIComponent(targetDate)}`,
            { cache: "no-store" },
          );
          if (!res.ok || cancelled) continue;
          const data = (await res.json()) as { bookings: BookingDTO[] };
          bookingsCacheRef.current.set(
            `${salon.slug}:${targetDate}`,
            data.bookings,
          );
        } catch {
          // Best effort
        }
      }
    };

    const timer = setTimeout(() => void runPrefetch(), 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [date, salon.slug]);

  // Prefetch all other salons for the current date so salon transitions are 0s instant
  useEffect(() => {
    const otherSalons = salons.filter((s) => s.slug !== salon.slug);
    for (const other of otherSalons) {
      const cacheKey = `${other.slug}:${date}`;
      if (!bookingsCacheRef.current.has(cacheKey)) {
        fetch(
          `/api/bookings?salon=${encodeURIComponent(other.slug)}&date=${encodeURIComponent(date)}`,
          { cache: "no-store" },
        )
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.bookings) {
              bookingsCacheRef.current.set(cacheKey, data.bookings);
            }
          })
          .catch(() => {});
      }
    }
  }, [salons, salon.slug, date]);

  // Seed bookingsCacheRef for every day in monthBookings so any day clicked is already cached
  useEffect(() => {
    if (monthBookings.length === 0) return;
    const grouped = new Map<string, BookingDTO[]>();
    for (const b of monthBookings) {
      const list = grouped.get(b.bookingDate);
      if (list) list.push(b);
      else grouped.set(b.bookingDate, [b]);
    }
    for (const [d, dayList] of grouped.entries()) {
      const key = `${salon.slug}:${d}`;
      if (!bookingsCacheRef.current.has(key)) {
        bookingsCacheRef.current.set(key, dayList);
      }
    }
  }, [monthBookings, salon.slug]);

  const prefetchSalon = useCallback(
    (slug: string) => {
      const cacheKey = `${slug}:${date}`;
      if (!bookingsCacheRef.current.has(cacheKey)) {
        fetch(
          `/api/bookings?salon=${encodeURIComponent(slug)}&date=${encodeURIComponent(date)}`,
          { cache: "no-store" },
        )
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.bookings) {
              bookingsCacheRef.current.set(cacheKey, data.bookings);
            }
          })
          .catch(() => {});
      }
    },
    [date],
  );

  const monthRange = useMemo(() => {
    const cells = monthMatrix(date);
    return {
      from: cells[0]?.date ?? date,
      to: cells[cells.length - 1]?.date ?? date,
    };
  }, [date]);

  const fetchMonth = useCallback(async () => {
    const rangeKey = `${salon.slug}:${monthRange.from}:${monthRange.to}`;
    try {
      const res = await fetch(
        `/api/bookings/range?salon=${encodeURIComponent(salon.slug)}&from=${monthRange.from}&to=${monthRange.to}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { bookings: BookingDTO[] };
      monthCacheRef.current.set(rangeKey, data.bookings);
      setMonthBookings(data.bookings);
    } catch {
      // Best-effort
    }
  }, [salon.slug, monthRange.from, monthRange.to]);

  useEffect(() => {
    const rangeKey = `${salon.slug}:${monthRange.from}:${monthRange.to}`;
    const cached = monthCacheRef.current.get(rangeKey);
    if (cached) {
      setMonthBookings(cached);
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/bookings/range?salon=${encodeURIComponent(salon.slug)}&from=${monthRange.from}&to=${monthRange.to}`,
          { cache: "no-store" },
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { bookings: BookingDTO[] };
        monthCacheRef.current.set(rangeKey, data.bookings);
        if (!cancelled) setMonthBookings(data.bookings);
      } catch {
        // Best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [salon.slug, monthRange.from, monthRange.to]);

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
      bookingsCacheRef.current.set(`${salon.slug}:${date}`, data.bookings);
      void fetchMonth();
    } catch {
      // The next poll catches us up
    }
  }, [salon.slug, date, router, fetchMonth]);

  // Sub-second poll with single-roundtrip sync
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
        const sinceParam =
          lastWatermark !== null
            ? `&since=${encodeURIComponent(lastWatermark)}`
            : "";
        const res = await fetch(
          `/api/bookings/watermark?salon=${encodeURIComponent(salon.slug)}&date=${date}${sinceParam}`,
          { cache: "no-store" },
        );
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));

        const data = (await res.json()) as {
          watermark: string;
          changed?: boolean;
          bookings?: BookingDTO[];
        };
        consecutiveFailures = 0;
        setStream("live");

        if (data.changed) {
          if (data.bookings) {
            setBookings(data.bookings);
            bookingsCacheRef.current.set(`${salon.slug}:${date}`, data.bookings);
            void fetchMonth();
          } else {
            await refetch();
          }
        }
        lastWatermark = data.watermark;
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
  }, [salon.slug, date, refetch, router, fetchMonth]);

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

  // Optimistic UI mutation handlers for 0s delay feedback
  const handleOptimisticCreate = useCallback(
    (booking: BookingDTO) => {
      const previousBookings = bookings;
      const nextBookings = [...bookings, booking].sort(
        (a, b) => a.startMin - b.startMin,
      );
      setBookings(nextBookings);
      bookingsCacheRef.current.set(`${salon.slug}:${date}`, nextBookings);
      setMonthBookings((prev) =>
        [...prev, booking].sort((a, b) => a.startMin - b.startMin),
      );

      return {
        rollback: () => {
          setBookings(previousBookings);
          bookingsCacheRef.current.set(
            `${salon.slug}:${date}`,
            previousBookings,
          );
          setMonthBookings((prev) =>
            prev.filter((b) => b.id !== booking.id),
          );
        },
        commit: (serverBooking: BookingDTO) => {
          setBookings((prev) =>
            prev.map((b) => (b.id === booking.id ? serverBooking : b)),
          );
          const current =
            bookingsCacheRef.current.get(`${salon.slug}:${date}`) ??
            nextBookings;
          bookingsCacheRef.current.set(
            `${salon.slug}:${date}`,
            current.map((b) => (b.id === booking.id ? serverBooking : b)),
          );
          setMonthBookings((prev) =>
            prev.map((b) => (b.id === booking.id ? serverBooking : b)),
          );
          announceChange();
        },
      };
    },
    [bookings, salon.slug, date, announceChange],
  );

  const handleOptimisticUpdate = useCallback(
    (booking: BookingDTO) => {
      const previousBookings = bookings;
      const nextBookings = bookings.map((b) =>
        b.id === booking.id ? booking : b,
      );
      setBookings(nextBookings);
      bookingsCacheRef.current.set(`${salon.slug}:${date}`, nextBookings);
      setMonthBookings((prev) =>
        prev.map((b) => (b.id === booking.id ? booking : b)),
      );

      return {
        rollback: () => {
          setBookings(previousBookings);
          bookingsCacheRef.current.set(
            `${salon.slug}:${date}`,
            previousBookings,
          );
          setMonthBookings((prev) =>
            prev.map((b) => {
              const old = previousBookings.find((p) => p.id === b.id);
              return old ?? b;
            }),
          );
        },
        commit: (serverBooking: BookingDTO) => {
          setBookings((prev) =>
            prev.map((b) => (b.id === booking.id ? serverBooking : b)),
          );
          const current =
            bookingsCacheRef.current.get(`${salon.slug}:${date}`) ??
            nextBookings;
          bookingsCacheRef.current.set(
            `${salon.slug}:${date}`,
            current.map((b) => (b.id === booking.id ? serverBooking : b)),
          );
          announceChange();
        },
      };
    },
    [bookings, salon.slug, date, announceChange],
  );

  const handleOptimisticStatus = useCallback(
    (bookingId: string, newStatus: BookingDTO["status"]) => {
      const previousBookings = bookings;
      const nextBookings = bookings.map((b) =>
        b.id === bookingId ? { ...b, status: newStatus } : b,
      );
      setBookings(nextBookings);
      bookingsCacheRef.current.set(`${salon.slug}:${date}`, nextBookings);
      setMonthBookings((prev) =>
        prev.map((b) =>
          b.id === bookingId ? { ...b, status: newStatus } : b,
        ),
      );

      return {
        rollback: () => {
          setBookings(previousBookings);
          bookingsCacheRef.current.set(
            `${salon.slug}:${date}`,
            previousBookings,
          );
          setMonthBookings((prev) =>
            prev.map((b) => {
              const old = previousBookings.find((p) => p.id === b.id);
              return old ?? b;
            }),
          );
        },
        commit: () => {
          announceChange();
        },
      };
    },
    [bookings, salon.slug, date, announceChange],
  );

  const activeCount = useMemo(
    () => bookings.filter((b) => b.status !== "cancelled").length,
    [bookings],
  );

  /** The first free slot, so the primary action always has somewhere to go.
   *  On today, skips any slot whose end time has already passed. */
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
    const nowMin = date === today ? nowMinutesInSalonTz() : null;
    for (let t = salon.opensAtMin; t < salon.closesAtMin; t += salon.slotMin) {
      if (taken.has(t)) continue;
      if (nowMin !== null && t + salon.slotMin <= nowMin) continue;
      return t;
    }
    // Fallback: day is full or entirely past — opening time (server will reject
    // if staff try to book it, which is the right outcome).
    return salon.opensAtMin;
  }, [bookings, salon, date, today]);

  const bookingsByDate = useMemo(() => {
    const map = new Map<string, BookingDTO[]>();
    for (const b of monthBookings) {
      const list = map.get(b.bookingDate);
      if (list) list.push(b);
      else map.set(b.bookingDate, [b]);
    }
    // Instant fallback: ensures current day always renders without delay
    if (!map.has(date) && bookings.length > 0) {
      map.set(date, bookings);
    }
    return map;
  }, [monthBookings, date, bookings]);

  const visibleBookings = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bookings;
    return bookings.filter(
      (b) =>
        b.clientName.toLowerCase().includes(q) ||
        b.service.toLowerCase().includes(q) ||
        b.clientPhone.includes(q),
    );
  }, [bookings, query]);

  const hasUpcoming = useMemo(() => {
    if (date !== today) return false;
    const nowMin = nowMinutesInSalonTz();
    return bookings.some(
      (b) =>
        b.status === "confirmed" &&
        b.startMin >= nowMin &&
        b.startMin <= nowMin + 30,
    );
  }, [bookings, date, today]);

  return (
    <div
      className="relative flex min-h-dvh flex-col md:flex-row"
      style={{ background: "var(--paper)" }}
    >
      {/* Ambient glow — the one purely atmospheric touch kept from the
          reference, low enough opacity that it never competes with the
          grid. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-0 h-[420px] opacity-70"
        style={{
          background:
            "radial-gradient(ellipse 60% 100% at 50% 100%, var(--accent-tint), transparent 70%)",
        }}
      />

      <Sidebar
        salons={salons}
        currentSalon={salon.slug}
        onSelectSalon={(slug) => navigate(slug, date)}
        onPrefetchSalon={prefetchSalon}
        mode={mode}
        onModeChange={setDeviceMode}
        role={role}
      />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {/* ---- Header ------------------------------------------------- */}
        <header
          className="sticky top-0 z-20 border-b px-3 pt-3 sm:px-4 md:px-5 lg:px-6"
          style={{
            borderColor: "var(--line)",
            background: "color-mix(in srgb, var(--paper) 88%, transparent)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div className="flex w-full flex-col gap-3 pb-3">
            <div className="flex items-center gap-3 md:hidden">
              <a href="/bookings" className="mr-auto" title="L'Atelier Groupe">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo-transparent.webp"
                  alt="L'Atelier Groupe"
                  className="h-7 w-auto max-w-[120px] object-contain"
                />
              </a>
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

            <div className="md:hidden">
              <SalonSwitcher
                salons={salons}
                current={salon.slug}
                onSelect={(slug) => navigate(slug, date)}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="min-w-0">
                <h1 className="t-display text-[22px] md:text-[26px]">
                  Bonjour !
                </h1>
                <p
                  className="t-small mt-1"
                  style={{ color: "var(--ink-faint)" }}
                >
                  <span className="hidden lg:inline">
                    {shortName(salon.name)} ·{" "}
                  </span>
                  <span className="first-letter:uppercase">
                    {formatLongDate(date)}
                  </span>{" "}
                  · <span data-nums>{activeCount}</span> rendez-vous
                  {date === today ? " · aujourd'hui" : ""}
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="hidden items-center gap-1 md:flex">
                  <LiveDot state={stream} />
                </div>

                {date !== today ? (
                  <button
                    type="button"
                    onClick={() => navigate(salon.slug, today)}
                    className="t-small shrink-0 rounded-[8px] px-2.5 py-1.5 transition-colors duration-[120ms] hover:bg-[color:var(--surface-sunk)]"
                    style={{ color: "var(--accent-hover)" }}
                  >
                    Aujourd&apos;hui
                  </button>
                ) : null}

                <div
                  className="hidden items-center gap-2 rounded-full px-3.5 py-2 md:flex"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                  }}
                >
                  <span style={{ color: "var(--ink-faint)" }}>
                    <Search size={15} />
                  </span>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Rechercher un client…"
                    aria-label="Rechercher un rendez-vous"
                    className="w-[180px] bg-transparent text-[13.5px] outline-none placeholder:text-[color:var(--ink-faint)]"
                    style={{ color: "var(--ink)" }}
                  />
                </div>

                <span
                  className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                    color: "var(--ink-soft)",
                  }}
                  aria-hidden
                >
                  <Bell size={17} />
                  {hasUpcoming ? (
                    <span
                      className="absolute right-2 top-2 block h-[7px] w-[7px] rounded-full"
                      style={{
                        background: "var(--accent)",
                        border: "1.5px solid var(--surface)",
                      }}
                    />
                  ) : null}
                </span>

                <button
                  type="button"
                  onClick={() =>
                    setDialog({ kind: "create", startMin: firstFreeSlot })
                  }
                  className="btn-primary btn-sm hidden shrink-0 md:inline-flex"
                >
                  <Plus size={16} />
                  Nouveau
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* ---- Calendar + schedule ------------------------------------ */}
        <main className="flex flex-1 flex-col w-full px-3 pb-24 pt-3 sm:px-4 md:px-5 lg:px-6 lg:pb-8">
          <div className="flex w-full flex-1 flex-col gap-3.5">
            <ViewSwitcher view={view} onChange={setView} />

            {view === "day" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-4">
                <DayGrid
                  salon={salon}
                  date={date}
                  today={today}
                  bookings={bookings}
                  onSelectSlot={(startMin) =>
                    setDialog({ kind: "create", startMin })
                  }
                  onSelectBooking={(booking) =>
                    setDialog({ kind: "edit", booking })
                  }
                />
                {activeCount === 0 ? (
                  <p
                    className="t-small text-center"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    Aucun rendez-vous. Touchez un créneau pour en ajouter un.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1">
                  {view === "week" ? (
                    <WeekGrid
                      salon={salon}
                      date={date}
                      today={today}
                      bookingsByDate={bookingsByDate}
                      onSelectDate={(d) => navigate(salon.slug, d)}
                      onSelectSlot={(d, startMin) =>
                        d === date
                          ? setDialog({ kind: "create", startMin })
                          : navigate(salon.slug, d)
                      }
                      onSelectBooking={(booking) =>
                        setDialog({ kind: "edit", booking })
                      }
                    />
                  ) : (
                    <MonthCalendar
                      date={date}
                      today={today}
                      bookingsByDate={bookingsByDate}
                      onSelectDate={(d) => navigate(salon.slug, d)}
                      onNavigateMonth={(delta) =>
                        navigate(salon.slug, startOfMonth(addMonths(date, delta)))
                      }
                    />
                  )}
                </div>

                <ScheduledPanel
                  date={date}
                  salon={salon}
                  bookings={visibleBookings}
                  onSelectBooking={(booking) =>
                    setDialog({ kind: "edit", booking })
                  }
                  onCreate={() =>
                    setDialog({ kind: "create", startMin: firstFreeSlot })
                  }
                />
              </div>
            )}
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
          onOptimisticCreate={handleOptimisticCreate}
          onOptimisticUpdate={handleOptimisticUpdate}
          onOptimisticStatus={handleOptimisticStatus}
        />
      ) : null}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function ViewSwitcher({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Vue du calendrier"
      className="inline-flex w-fit gap-0.5 self-start rounded-full p-0.5"
      style={{ background: "var(--surface-sunk)" }}
    >
      {(
        [
          ["day", "Jour"],
          ["week", "Semaine"],
          ["month", "Mois"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={view === value}
          onClick={() => onChange(value)}
          className="min-h-[34px] rounded-full px-4 text-[13px] transition-colors duration-[120ms]"
          style={{
            background: view === value ? "var(--surface)" : "transparent",
            boxShadow: view === value ? "var(--shadow-card)" : "none",
            color: view === value ? "var(--ink)" : "var(--ink-soft)",
            fontWeight: view === value ? 600 : 500,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function LiveDot({ state }: { state: StreamState }) {
  const map = {
    live: { label: "En direct", color: "var(--accent)" },
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
