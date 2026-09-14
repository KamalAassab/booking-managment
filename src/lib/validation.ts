import { z } from "zod";

import {
  MINUTES_IN_DAY,
  isValidDateString,
  nowMinutesInSalonTz,
  todayInSalonTz,
} from "./time";

export const MIN_PASSWORD_LENGTH = 4;
/** scrypt hashes the whole input; an unbounded field is a cheap CPU DoS. */
export const MAX_PASSWORD_LENGTH = 200;

// Per-salon service names now come from lib/services-catalog.ts (the real
// catalogue). These durations are every distinct value that catalogue uses,
// so a service's real duration is always a selectable option.
export const DURATION_OPTIONS = [
  10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 90, 120, 150, 180,
] as const;

export const MIN_DURATION_MIN = 5;
export const MAX_DURATION_MIN = 480;

const dateString = z
  .string()
  .refine(isValidDateString, { message: "Date invalide." });

const startMin = z
  .number()
  .int("Heure de début invalide.")
  .min(0, "Heure de début invalide.")
  .max(MINUTES_IN_DAY - 1, "Heure de début invalide.");

const durationMin = z
  .number()
  .int("Durée invalide.")
  .min(MIN_DURATION_MIN, "Durée trop courte.")
  .max(MAX_DURATION_MIN, "Durée trop longue.");

/**
 * Notes are optional and an empty string means "none". Normalising that to
 * undefined here keeps the null-vs-empty-string decision in one place instead
 * of at every call site.
 */
const notes = z
  .string()
  .max(1000, "Note trop longue.")
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

/** A booking must end on the day it starts — mirrors the bookings_within_day CHECK. */
const endsSameDay = {
  check: (v: { startMin: number; durationMin: number }) =>
    v.startMin + v.durationMin <= MINUTES_IN_DAY,
  message: "Un rendez-vous ne peut pas se prolonger après minuit.",
};

export const createBookingSchema = z
  .object({
    salonSlug: z.string().min(1, "Salon requis.").max(24, "Salon invalide."),
    clientName: z
      .string()
      .trim()
      .min(2, "Nom du client requis.")
      .max(120, "Nom trop long."),
    clientPhone: z
      .string()
      .trim()
      .min(1, "Numéro de téléphone requis.")
      .max(32, "Numéro trop long."),
    bookingDate: dateString,
    startMin,
    durationMin,
    service: z.string().trim().min(1, "Service requis.").max(120, "Service trop long."),
    notes,
    channel: z.enum(["call_center", "front_desk"]),
  })
  .refine(endsSameDay.check, {
    message: endsSameDay.message,
    path: ["durationMin"],
  })
  .refine((v) => v.bookingDate >= todayInSalonTz(), {
    message: "Impossible de réserver une date passée.",
    path: ["bookingDate"],
  })
  .refine(
    (v) =>
      v.bookingDate > todayInSalonTz() || v.startMin >= nowMinutesInSalonTz(),
    {
      message: "Ce créneau est déjà passé.",
      path: ["startMin"],
    },
  );

export const updateBookingSchema = z
  .object({
    clientName: z
      .string()
      .trim()
      .min(2, "Nom du client requis.")
      .max(120, "Nom trop long.")
      .optional(),
    clientPhone: z
      .string()
      .trim()
      .min(1, "Numéro de téléphone requis.")
      .max(32, "Numéro trop long.")
      .optional(),
    bookingDate: dateString.optional(),
    startMin: startMin.optional(),
    durationMin: durationMin.optional(),
    service: z
      .string()
      .trim()
      .min(1, "Service requis.")
      .max(120, "Service trop long.")
      .optional(),
    notes,
    status: z.enum(["confirmed", "cancelled", "done"]).optional(),
  })
  // Only checkable when both halves are supplied; a patch that moves only the
  // start time is validated against the stored duration in updateBooking.
  .refine(
    (v) =>
      v.startMin === undefined ||
      v.durationMin === undefined ||
      endsSameDay.check({ startMin: v.startMin, durationMin: v.durationMin }),
    { message: endsSameDay.message, path: ["durationMin"] },
  )
  .refine(
    (v) => v.bookingDate === undefined || v.bookingDate >= todayInSalonTz(),
    {
      message: "Impossible de reporter à une date passée.",
      path: ["bookingDate"],
    },
  );

export const listQuerySchema = z.object({
  salon: z.string().min(1).max(24),
  date: dateString,
});

export const rangeQuerySchema = z.object({
  salon: z.string().min(1).max(24),
  from: dateString,
  to: dateString,
});

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`)
  .max(MAX_PASSWORD_LENGTH, "Mot de passe trop long.");

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
export type ListQueryInput = z.infer<typeof listQuerySchema>;
export type RangeQueryInput = z.infer<typeof rangeQuerySchema>;
