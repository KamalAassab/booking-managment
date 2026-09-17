"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import { BoardHeader, type StreamState, type ViewMode } from "@/components/board-header";
import { BookingSheet } from "@/components/booking-sheet";
import { DayAgenda } from "@/components/day-agenda";
import { DayRail } from "@/components/day-rail";
import { DayTimeline } from "@/components/day-timeline";
import { Plus, Search } from "@/components/icons";
import { MonthCalendar } from "@/components/month-calendar";
import { Sidebar } from "@/components/sidebar";
import { Toast, type ToastMessage } from "@/components/toast";
import { WeekGrid } from "@/components/week-grid";
import {
  bookingPhase,
  firstOpenSlotStart,
  freeWindows,
  peakConcurrency,
} from "@/lib/day-layout";
import { readSalonPreference, writeSalonPreference } from "@/lib/device";
import {
  getServicesForSalon,
  type ServiceCatalogEntry,
} from "@/lib/services-catalog";
import {
  addDays,
  addMonths,
  isValidDateString,
  monthMatrix,
  nowMinutesInSalonTz,
  todayInSalonTz,
  weekDates,
} from "@/lib/time";
import type { BookingDTO, SalonDTO } from "@/lib/types";

type Props = {
  salons: SalonDTO[];
  salon: SalonDTO;
  date: string;
  initialBookings: BookingDTO[];
  /** Each salon's bookable services, keyed by slug — the owner's live catalogue. */
  catalogs: Record<string, ServiceCatalogEntry[]>;
  role: "staff" | "owner";
};

export type DialogState =
  | { kind: "create"; startMin: number; date: string }
  | { kind: "edit"; booking: BookingDTO }
  | null;

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
/**
 * The day view also watches its month, less often: the phone's week strip
 * and a switch to the week or month view then show other days' changes
 * without a wait. Every eighth poll, about every six seconds.
 */
const RANGE_EVERY_N_POLLS = 8;
/** Ceiling for the exponential backoff after repeated failures. */
const POLL_MAX_BACKOFF_MS = 10_000;

const dayKey = (salonSlug: string, date: string) => `${salonSlug}:${date}`;

/** The span a month grid shows for a date: whole weeks, so up to 42 days. */
function monthRangeFor(date: string): { from: string; to: string } {
  const cells = monthMatrix(date);
  return {
    from: cells[0]?.date ?? date,
    to: cells[cells.length - 1]?.date ?? date,
  };
}

const monthKeyFor = (salonSlug: string, date: string) => {
  const { from, to } = monthRangeFor(date);
  return `${salonSlug}:${from}:${to}`;
};

const NO_BOOKINGS: BookingDTO[] = [];

function bySchedule(a: BookingDTO, b: BookingDTO): number {
  return a.startMin - b.startMin;
}

function byDateAndSchedule(a: BookingDTO, b: BookingDTO): number {
  return a.bookingDate.localeCompare(b.bookingDate) || bySchedule(a, b);
}

const withoutAccents = (value: string) =>
  value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Name and service ignore case and accents ("helene" finds Hélène); a phone
 * matches on digits in either the stored international form or the
 * national one people type ("0612").
 */
function bookingMatcher(query: string): ((booking: BookingDTO) => boolean) | null {
  const text = withoutAccents(query.trim());
  if (!text) return null;
  const digits = query.replace(/\D/g, "");
  return (booking) => {
    if (withoutAccents(booking.clientName).includes(text)) return true;
    if (withoutAccents(booking.serviceLabel).includes(text)) return true;
    if (digits.length < 2) return false;
    const stored = booking.clientPhone.replace(/\D/g, "");
    const national = stored.startsWith("212") ? `0${stored.slice(3)}` : stored;
    return stored.includes(digits) || national.includes(digits);
  };
}

/**
 * Re-renders on a slow clock, so "now" and "today" keep moving on a screen
 * nobody touches: the front desk's calendar stays open all day, and without
 * this the current-time line froze and past slots kept looking bookable until
 * the next unrelated update.
 */
function useMinuteClock(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
}

export function BookingsBoard({
  salons,
  salon: initialSalon,
  date: initialDate,
  initialBookings,
  catalogs,
  role,
}: Props) {
  const router = useRouter();
  useMinuteClock();

  // Active salon and date managed in client state for 0s instantaneous transitions
  const [currentSalonSlug, setCurrentSalonSlug] = useState(initialSalon.slug);
  const [currentDate, setCurrentDate] = useState(initialDate);

  const salon = useMemo(
    () => salons.find((s) => s.slug === currentSalonSlug) ?? initialSalon,
    [salons, currentSalonSlug, initialSalon],
  );
  const date = currentDate;
  const catalog = useMemo(
    () => catalogs[salon.slug] ?? getServicesForSalon(salon.slug),
    [catalogs, salon.slug],
  );

  const [bookings, setBookings] = useState(initialBookings);
  /** True while the day on screen has no data yet — never another day's. */
  const [dayLoading, setDayLoading] = useState(false);
  /** A month grid's rows, tagged with the salon and span they belong to. */
  const [monthData, setMonthData] = useState<{
    key: string;
    rows: BookingDTO[];
    /** False until this salon and span has been fetched at least once. */
    loaded: boolean;
  }>({ key: "", rows: [], loaded: false });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [stream, setStream] = useState<StreamState>("connecting");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("day");
  const today = todayInSalonTz();
  const nowMin = nowMinutesInSalonTz();
  const searchRef = useRef<HTMLInputElement>(null);

  // In-memory caches for 0s instant switching
  const bookingsCacheRef = useRef<Map<string, BookingDTO[]>>(new Map());
  const monthCacheRef = useRef<Map<string, BookingDTO[]>>(new Map());

  /**
   * The salon and day on screen *right now*, updated synchronously on every
   * navigation. Every response is checked against it before it touches the
   * screen: responses arrive in any order, and one for the day the agent just
   * left used to overwrite the day they moved to — so a day could show
   * another day's bookings, under its own date, until something else changed.
   */
  const viewKeyRef = useRef(dayKey(initialSalon.slug, initialDate));

  const monthRange = useMemo(() => monthRangeFor(date), [date]);
  const monthKey = `${salon.slug}:${monthRange.from}:${monthRange.to}`;
  const monthKeyRef = useRef(monthKey);
  // Only rows fetched for the salon and month on screen are ever drawn: after
  // a salon switch the week grid would otherwise show the previous salon's
  // bookings on the same dates until the new month arrived.
  const monthBookings = monthData.key === monthKey ? monthData.rows : NO_BOOKINGS;
  const monthLoading = !(monthData.key === monthKey && monthData.loaded);

  // Seed cache on mount or when initial props change
  useEffect(() => {
    bookingsCacheRef.current.set(
      dayKey(initialSalon.slug, initialDate),
      initialBookings,
    );
  }, [initialSalon.slug, initialDate, initialBookings]);

  /** Stores a day's rows, and shows them only if that day is still on screen. */
  const applyDay = useCallback(
    (salonSlug: string, targetDate: string, rows: BookingDTO[]) => {
      const key = dayKey(salonSlug, targetDate);
      bookingsCacheRef.current.set(key, rows);
      if (viewKeyRef.current === key) {
        setBookings(rows);
        setDayLoading(false);
      }
    },
    [],
  );

  const fetchDay = useCallback(
    async (salonSlug: string, targetDate: string): Promise<boolean> => {
      try {
        const res = await fetch(
          `/api/bookings?salon=${encodeURIComponent(salonSlug)}&date=${encodeURIComponent(targetDate)}`,
          { cache: "no-store" },
        );
        if (res.status === 401) {
          router.push("/login");
          return false;
        }
        if (!res.ok) return false;
        const data = (await res.json()) as { bookings: BookingDTO[] };
        applyDay(salonSlug, targetDate, data.bookings);
        return true;
      } catch {
        // Best effort — the poll catches up.
        return false;
      }
    },
    [router, applyDay],
  );

  /** A month grid's rows, shown only if that salon and month are still on screen. */
  const fetchMonth = useCallback(async (): Promise<boolean> => {
    const key = monthKey;
    try {
      const res = await fetch(
        `/api/bookings/range?salon=${encodeURIComponent(salon.slug)}&from=${monthRange.from}&to=${monthRange.to}`,
        { cache: "no-store" },
      );
      if (!res.ok) return false;
      const data = (await res.json()) as { bookings: BookingDTO[] };
      monthCacheRef.current.set(key, data.bookings);
      if (monthKeyRef.current === key) setMonthData({ key, rows: data.bookings, loaded: true });
      return true;
    } catch {
      // Best-effort
      return false;
    }
  }, [monthKey, salon.slug, monthRange.from, monthRange.to]);

  /**
   * Puts a salon's day on screen: the cached rows at once when there are any,
   * otherwise an empty, loading day — never the previous day's bookings
   * under the new date — and a fresh fetch either way.
   */
  const showView = useCallback(
    (nextSalon: string, nextDate: string) => {
      const key = dayKey(nextSalon, nextDate);
      viewKeyRef.current = key;
      setCurrentSalonSlug(nextSalon);
      setCurrentDate(nextDate);

      const cached = bookingsCacheRef.current.get(key);
      setBookings(cached ?? NO_BOOKINGS);
      setDayLoading(!cached);

      const nextMonthKey = monthKeyFor(nextSalon, nextDate);
      if (nextMonthKey !== monthKeyRef.current) {
        monthKeyRef.current = nextMonthKey;
        setMonthData({
          key: nextMonthKey,
          rows: monthCacheRef.current.get(nextMonthKey) ?? NO_BOOKINGS,
          loaded: monthCacheRef.current.has(nextMonthKey),
        });
      }

      void fetchDay(nextSalon, nextDate);
    },
    [fetchDay],
  );

  /**
   * 0s Instant Navigation:
   * 1. Updates state synchronously (0ms)
   * 2. Immediately loads from in-memory cache if present (0ms)
   * 3. Syncs browser URL via pushState with NO server roundtrip
   * 4. SWR revalidates in the background
   */
  const navigate = useCallback(
    (nextSalon: string, nextDate: string, { replace = false } = {}) => {
      if (nextSalon !== viewKeyRef.current.split(":")[0]) {
        writeSalonPreference(nextSalon);
      }
      const nextUrl = `/bookings?salon=${encodeURIComponent(nextSalon)}&date=${encodeURIComponent(nextDate)}`;
      const history = window.history;
      (replace ? history.replaceState : history.pushState).call(
        history,
        { salon: nextSalon, date: nextDate },
        "",
        nextUrl,
      );
      showView(nextSalon, nextDate);
    },
    [showView],
  );

  // A desk remembers its own salon (brief §3). Applied once per browser
  // session, after the first render — localStorage does not exist on the
  // server that rendered it.
  useEffect(() => {
    const remembered = readSalonPreference();
    if (
      remembered &&
      remembered !== initialSalon.slug &&
      salons.some((s) => s.slug === remembered) &&
      !window.sessionStorage.getItem("atelier.salon.applied")
    ) {
      window.sessionStorage.setItem("atelier.salon.applied", "1");
      queueMicrotask(() => navigate(remembered, initialDate, { replace: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Instant back/forward navigation support
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const s = params.get("salon");
      const d = params.get("date");
      const [keySalon, keyDate] = viewKeyRef.current.split(":");
      showView(
        s && salons.some((item) => item.slug === s) ? s : keySalon,
        d && isValidDateString(d) ? d : keyDate,
      );
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [salons, showView]);

  // Aggressive idle prefetching of adjacent ±3 days so navigation is instant
  useEffect(() => {
    const daysToPrefetch: string[] = [];
    const base = new Date(date + "T12:00:00Z");
    for (let offset = -2; offset <= 4; offset++) {
      if (offset === 0) continue;
      const d = new Date(base.getTime() + offset * 86_400_000);
      const str = d.toISOString().slice(0, 10);
      if (!bookingsCacheRef.current.has(dayKey(salon.slug, str))) {
        daysToPrefetch.push(str);
      }
    }

    if (daysToPrefetch.length === 0) return;

    let cancelled = false;
    const runPrefetch = async () => {
      for (const targetDate of daysToPrefetch) {
        if (cancelled) break;
        await fetchDay(salon.slug, targetDate);
      }
    };

    const timer = setTimeout(() => void runPrefetch(), 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [date, salon.slug, fetchDay]);

  // Prefetch all other salons for the current date so salon transitions are 0s instant
  useEffect(() => {
    for (const other of salons) {
      if (other.slug === salon.slug) continue;
      if (!bookingsCacheRef.current.has(dayKey(other.slug, date))) {
        void fetchDay(other.slug, date);
      }
    }
  }, [salons, salon.slug, date, fetchDay]);

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
      const key = dayKey(salon.slug, d);
      if (!bookingsCacheRef.current.has(key)) {
        bookingsCacheRef.current.set(key, dayList);
      }
    }
  }, [monthBookings, salon.slug]);

  const prefetchSalon = useCallback(
    (slug: string) => {
      if (!bookingsCacheRef.current.has(dayKey(slug, date))) {
        void fetchDay(slug, date);
      }
    },
    [date, fetchDay],
  );

  // Sub-second poll with single-roundtrip sync. The week and month views also
  // watch every day they show, not only the selected one.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastWatermark: string | null = null;
    let lastRangeWatermark: string | null = null;
    let consecutiveFailures = 0;
    let polls = 0;

    const schedule = (ms: number) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(poll, ms);
    };

    const poll = async () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return schedule(POLL_IDLE_MS);

      const watchRange = view !== "day" || polls % RANGE_EVERY_N_POLLS === 0;
      polls += 1;
      try {
        const params = new URLSearchParams({ salon: salon.slug, date });
        if (lastWatermark !== null) params.set("since", lastWatermark);
        if (watchRange) {
          params.set("from", monthRange.from);
          params.set("to", monthRange.to);
          if (lastRangeWatermark !== null) params.set("sinceRange", lastRangeWatermark);
        }
        const res = await fetch(`/api/bookings/watermark?${params}`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));

        const data = (await res.json()) as {
          watermark: string;
          changed?: boolean;
          bookings?: BookingDTO[];
          rangeWatermark?: string;
          rangeChanged?: boolean;
        };
        if (cancelled) return;
        consecutiveFailures = 0;
        setStream("live");

        let upToDate = true;
        if (data.changed) {
          if (data.bookings) applyDay(salon.slug, date, data.bookings);
          else upToDate = await fetchDay(salon.slug, date);
        }
        if (cancelled) return;
        // Only remember a watermark once its data is actually on screen; a
        // failed fetch must be retried by the next poll, not forgotten.
        if (upToDate) lastWatermark = data.watermark;

        if (watchRange && data.rangeWatermark !== undefined) {
          if (data.rangeChanged !== false) {
            if (await fetchMonth()) lastRangeWatermark = data.rangeWatermark;
          } else {
            lastRangeWatermark = data.rangeWatermark;
          }
        }
        schedule(POLL_MS);
      } catch {
        if (cancelled) return;
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
      consecutiveFailures = 0;
      schedule(0);
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [salon.slug, date, view, monthRange.from, monthRange.to, router, applyDay, fetchDay, fetchMonth]);

  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("atelier.bookings");
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent) => {
      const msg = event.data as { salon: string; date: string };
      if (msg?.salon !== salon.slug) return;
      if (msg.date === date) void fetchDay(salon.slug, date);
      if (msg.date >= monthRange.from && msg.date <= monthRange.to) void fetchMonth();
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [salon.slug, date, monthRange.from, monthRange.to, fetchDay, fetchMonth]);

  /** Tells this browser's other tabs, and refreshes this one, after a write. */
  const announceChange = useCallback(
    (changedDates: string[] = [date]) => {
      for (const changed of new Set(changedDates)) {
        channelRef.current?.postMessage({ salon: salon.slug, date: changed });
      }
      void fetchDay(salon.slug, date);
      void fetchMonth();
    },
    [salon.slug, date, fetchDay, fetchMonth],
  );

  /**
   * Puts a booking exactly as the server stored it onto the screen at once —
   * into the day it now belongs to, out of the day it left — rather than
   * waiting for the next poll to notice.
   */
  const applySavedBooking = useCallback(
    (saved: BookingDTO, previousDate?: string) => {
      const bookingSalon = salons.find((s) => s.id === saved.salonId)?.slug;
      const place = (rows: BookingDTO[], slug: string, day: string) => {
        const others = rows.filter((b) => b.id !== saved.id);
        return bookingSalon === slug && saved.bookingDate === day
          ? [...others, saved].sort(bySchedule)
          : others;
      };

      if (bookingSalon) {
        for (const day of new Set([saved.bookingDate, previousDate ?? saved.bookingDate])) {
          const key = dayKey(bookingSalon, day);
          const cached = bookingsCacheRef.current.get(key);
          if (cached) bookingsCacheRef.current.set(key, place(cached, bookingSalon, day));
        }
      }

      // Placed against the day on screen when the answer arrives, which is
      // not necessarily the day the save started from.
      const [viewSalon, viewDate] = viewKeyRef.current.split(":");
      setBookings((rows) => place(rows, viewSalon, viewDate));
      setMonthData((current) => {
        const [monthSalon, from, to] = current.key.split(":");
        const others = current.rows.filter((b) => b.id !== saved.id);
        const belongs =
          saved.status !== "cancelled" &&
          bookingSalon === monthSalon &&
          saved.bookingDate >= from &&
          saved.bookingDate <= to;
        return {
          ...current,
          rows: belongs ? [...others, saved].sort(byDateAndSchedule) : others,
        };
      });

      announceChange([saved.bookingDate, previousDate ?? saved.bookingDate]);
    },
    [salons, announceChange],
  );

  // Status changes stay optimistic: they cannot collide with another booking
  // from this screen, so the agent gets the change at once and a rollback in
  // the rare case the network fails.
  const handleOptimisticStatus = useCallback(
    (bookingId: string, newStatus: BookingDTO["status"]) => {
      const before = bookings.find((b) => b.id === bookingId);
      const setStatus = (status: BookingDTO["status"], onlyIf?: BookingDTO["status"]) =>
        (rows: BookingDTO[]) =>
          rows.map((b) =>
            b.id === bookingId && (onlyIf === undefined || b.status === onlyIf)
              ? { ...b, status }
              : b,
          );

      setBookings(setStatus(newStatus));
      setMonthData((current) => ({ ...current, rows: setStatus(newStatus)(current.rows) }));

      return {
        // Reverts only this booking, and only if nothing newer replaced it —
        // restoring a snapshot of the whole day would also undo whatever the
        // other screens changed in the meantime.
        rollback: () => {
          if (!before) return;
          setBookings(setStatus(before.status, newStatus));
          setMonthData((current) => ({
            ...current,
            rows: setStatus(before.status, newStatus)(current.rows),
          }));
          announceChange();
        },
        commit: (saved: BookingDTO) => applySavedBooking(saved),
      };
    },
    [bookings, announceChange, applySavedBooking],
  );

  const active = useMemo(
    () => bookings.filter((b) => b.status !== "cancelled"),
    [bookings],
  );
  const activeCount = active.length;

  /**
   * Where a new booking starts when nothing more specific was picked: the
   * first moment of that day with nothing booked at all, not yet over. When
   * every moment has something running, the first open slot: another
   * service can still run beside it, and the sheet shows which times are
   * free for the service chosen.
   */
  const suggestStart = useCallback(
    (rows: BookingDTO[], day: string) => {
      const from = firstOpenSlotStart(
        salon,
        day === todayInSalonTz() ? nowMinutesInSalonTz() : null,
      );
      const open = rows.filter((b) => b.status !== "cancelled");
      const lastSlot = salon.closesAtMin - salon.slotMin;
      return freeWindows(open, salon, from)[0]?.startMin ?? Math.min(from, lastSlot);
    },
    [salon],
  );

  const bookingsByDate = useMemo(() => {
    const map = new Map<string, BookingDTO[]>();
    for (const b of monthBookings) {
      // The range endpoint never returns cancelled rows, but a cancellation
      // applied optimistically sits here until the server confirms it.
      if (b.status === "cancelled") continue;
      const list = map.get(b.bookingDate);
      if (list) list.push(b);
      else map.set(b.bookingDate, [b]);
    }
    // The selected day is polled every 750 ms, the month far less often:
    // its own rows are always the fresher copy.
    if (!dayLoading) map.set(date, active);
    return map;
  }, [monthBookings, date, active, dayLoading]);

  const matcher = useMemo(() => bookingMatcher(query), [query]);
  const matches = useMemo(
    () => (matcher ? new Set(active.filter(matcher).map((b) => b.id)) : null),
    [active, matcher],
  );

  // The global "Nouveau rendez-vous" action (header, FAB, the N shortcut) is
  // not tied to whatever day the board happens to be showing: a call almost
  // always means today, and the sheet's own date field lets the agent move
  // it to tomorrow, or any date, without first navigating the board there.
  const openCreate = useCallback(() => {
    // Bounded to a real slot even late at night, after closing: firstOpenSlotStart
    // only floors "now" to the grid, so past closing it can land outside the
    // day entirely. The sheet's own grid still guides the exact pick; this
    // only has to be a valid starting point.
    const startMin = Math.min(
      firstOpenSlotStart(salon, nowMin),
      salon.closesAtMin - salon.slotMin,
    );
    setDialog({ kind: "create", startMin, date: today });
  }, [salon, nowMin, today]);

  const openDay = useCallback(
    (day: string) => {
      setView("day");
      if (day !== date) navigate(salon.slug, day);
    },
    [date, navigate, salon.slug],
  );

  const createOn = useCallback(
    (day: string) => {
      const rows =
        day === date
          ? bookings
          : (bookingsCacheRef.current.get(dayKey(salon.slug, day)) ??
            bookingsByDate.get(day) ??
            NO_BOOKINGS);
      if (day !== date) navigate(salon.slug, day);
      setDialog({ kind: "create", startMin: suggestStart(rows, day), date: day });
    },
    [date, bookings, bookingsByDate, navigate, salon.slug, suggestStart],
  );

  const step = useCallback(
    (direction: -1 | 1) => {
      const next =
        view === "day"
          ? addDays(date, direction)
          : view === "week"
            ? addDays(date, 7 * direction)
            : addMonths(date, direction);
      navigate(salon.slug, next);
    },
    [view, date, navigate, salon.slug],
  );

  // Keyboard: N new booking, T today, arrows step, 1 2 3 views, / search.
  // Never while typing, never with a modifier, never under an open sheet.
  const onShortcut = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || dialog) return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    ) {
      return;
    }
    const onPage = !target || target === document.body || Boolean(target.closest("header"));
    switch (e.key) {
      case "n":
      case "N":
        if (e.repeat) return;
        e.preventDefault();
        openCreate();
        return;
      case "t":
      case "T":
        navigate(salon.slug, today);
        return;
      case "ArrowLeft":
      case "ArrowRight":
        if (!onPage) return;
        e.preventDefault();
        step(e.key === "ArrowLeft" ? -1 : 1);
        return;
      case "1":
        setView("day");
        return;
      case "2":
        setView("week");
        return;
      case "3":
        setView("month");
        return;
      case "/":
        if (view === "month") return;
        e.preventDefault();
        searchRef.current?.focus();
        return;
    }
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onShortcut(e);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const subtitle = useMemo(() => {
    const name = salon.name;
    if (view === "day") {
      if (dayLoading && active.length === 0) return `${name} · chargement`;
      const parts = [name, `${activeCount} rendez-vous`];
      if (date === today) {
        const running = active.filter((b) => bookingPhase(b, today, nowMin) === "running").length;
        if (running > 0) parts.push(`${running} en cours`);
      }
      const peak = peakConcurrency(active).count;
      if (peak > 1) parts.push(`jusqu'à ${peak} en même temps`);
      return parts.join(" · ");
    }
    if (monthLoading) return `${name} · chargement`;
    if (view === "week") {
      const total = weekDates(date).reduce((sum, d) => sum + (bookingsByDate.get(d)?.length ?? 0), 0);
      return `${name} · ${total} rendez-vous cette semaine`;
    }
    const month = date.slice(0, 7);
    let total = 0;
    for (const [d, list] of bookingsByDate) if (d.startsWith(month)) total += list.length;
    return `${name} · ${total} rendez-vous ce mois-ci`;
  }, [salon.name, view, dayLoading, active, activeCount, date, today, nowMin, monthLoading, bookingsByDate]);

  const selectBooking = useCallback((booking: BookingDTO) => setDialog({ kind: "edit", booking }), []);
  const selectSlot = useCallback(
    (startMin: number) => setDialog({ kind: "create", startMin, date }),
    [date],
  );

  return (
    <div
      className="relative flex min-h-dvh flex-col md:flex-row lg:h-dvh lg:overflow-hidden"
      style={{ background: "var(--paper)" }}
    >
      <Sidebar
        salons={salons}
        currentSalon={salon.slug}
        onSelectSalon={(slug) => navigate(slug, date)}
        onPrefetchSalon={prefetchSalon}
        role={role}
      />

      <div className="relative flex min-w-0 flex-1 flex-col lg:min-h-0">
        <BoardHeader
          salons={salons}
          salon={salon}
          date={date}
          today={today}
          view={view}
          stream={stream}
          subtitle={subtitle}
          query={query}
          searchRef={searchRef}
          bookingsByDate={bookingsByDate}
          onQueryChange={setQuery}
          onNavigate={(d) => navigate(salon.slug, d)}
          onStep={step}
          onViewChange={setView}
          onSelectSalon={(slug) => navigate(slug, date)}
          onPrefetchSalon={prefetchSalon}
          onCreate={openCreate}
        />

        <main
          className={`flex w-full flex-1 flex-col px-3 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-2 md:px-6 md:pb-6 md:pt-4 lg:min-h-0 ${
            view === "day" ? "lg:overflow-hidden" : "lg:overflow-y-auto"
          }`}
        >
          {view === "day" ? (
            <>
              <div className="hidden min-h-0 flex-1 gap-4 lg:flex">
                <DayTimeline
                  salon={salon}
                  date={date}
                  today={today}
                  nowMin={nowMin}
                  bookings={active}
                  matches={matches}
                  loading={dayLoading}
                  sheetOpen={dialog !== null}
                  onSelectSlot={selectSlot}
                  onSelectBooking={selectBooking}
                />
                <aside
                  className="hidden w-[260px] shrink-0 overflow-y-auto overscroll-contain pb-1 xl:block"
                  aria-label="Résumé et prochains rendez-vous"
                >
                  <DayRail
                    salon={salon}
                    date={date}
                    today={today}
                    nowMin={nowMin}
                    bookings={active}
                    loading={dayLoading}
                    onSelectSlot={selectSlot}
                    onSelectBooking={selectBooking}
                  />
                </aside>
              </div>

              <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 lg:hidden">
                {active.length >= 6 || query ? (
                  <label className="search-field w-full md:hidden">
                    <span className="shrink-0" style={{ color: "var(--ink-faint)" }}>
                      <Search size={16} />
                    </span>
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Rechercher un client, un service"
                      aria-label="Rechercher un rendez-vous"
                      autoComplete="off"
                    />
                  </label>
                ) : null}
                <DayAgenda
                  key={`${salon.slug}:${date}`}
                  salon={salon}
                  date={date}
                  today={today}
                  nowMin={nowMin}
                  bookings={active}
                  matches={matches}
                  query={query}
                  loading={dayLoading}
                  onSelectSlot={selectSlot}
                  onSelectBooking={selectBooking}
                />
              </div>
            </>
          ) : view === "week" ? (
            <WeekGrid
              salon={salon}
              date={date}
              today={today}
              nowMin={nowMin}
              bookingsByDate={bookingsByDate}
              matches={matcher}
              loading={monthLoading}
              onOpenDay={openDay}
              onCreateOn={createOn}
              onSelectBooking={selectBooking}
            />
          ) : (
            <MonthCalendar
              salon={salon}
              date={date}
              today={today}
              nowMin={nowMin}
              bookingsByDate={bookingsByDate}
              loading={monthLoading}
              onSelectDate={(d) => navigate(salon.slug, d)}
              onOpenDay={openDay}
              onCreateOn={createOn}
              onSelectBooking={selectBooking}
            />
          )}

          {/* Live changes arriving from another device are announced rather
              than appearing silently. */}
          <p aria-live="polite" className="sr-only">
            {dayLoading ? "" : `${activeCount} rendez-vous ce jour.`}
          </p>
        </main>
      </div>

      {/* New booking, under the thumb on a phone. */}
      <button
        type="button"
        onClick={openCreate}
        className="fab md:hidden"
        aria-label="Nouveau rendez-vous"
      >
        <Plus size={24} />
        <span className="sr-only">Nouveau</span>
      </button>

      {dialog ? (
        <BookingSheet
          key={dialog.kind === "edit" ? dialog.booking.id : `create:${dialog.date}:${dialog.startMin}`}
          state={dialog}
          salon={salon}
          date={date}
          today={today}
          bookings={bookings}
          catalog={catalog}
          onClose={() => setDialog(null)}
          onSaved={applySavedBooking}
          onChanged={() => announceChange()}
          onToast={setToast}
          onOptimisticStatus={handleOptimisticStatus}
        />
      ) : null}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
