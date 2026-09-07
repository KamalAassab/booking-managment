import { z } from "zod";

import { isValidDateString } from "./time";

export const MIN_PASSWORD_LENGTH = 8;

export const SERVICES = [
  "Coupe",
  "Coupe + Brushing",
  "Coloration",
  "Mèches / Balayage",
  "Lissage",
  "Soin cheveux",
  "Coiffure mariée",
  "Manucure",
  "Pédicure",
  "Épilation",
  "Soin visage",
  "Maquillage",
  "Hammam / Gommage",
  "Massage",
  "Barbe / Rasage",
  "Coupe homme",
  "Autre",
] as const;

export const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 150, 180] as const;

const dateString = z
  .string()
  .refine(isValidDateString, { message: "Date invalide." });

export const createBookingSchema = z.object({
  salonSlug: z.string().min(1, "Salon requis."),
  clientName: z
    .string()
    .trim()
    .min(2, "Nom du client requis.")
    .max(120, "Nom trop long."),
  clientPhone: z.string().trim().min(1, "Numéro de téléphone requis."),
  bookingDate: dateString,
  startMin: z.number().int().min(0).max(1439),
  durationMin: z.number().int().min(5).max(480),
  service: z.string().trim().min(1, "Service requis.").max(120),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  channel: z.enum(["call_center", "front_desk"]),
});

export const updateBookingSchema = z.object({
  clientName: z.string().trim().min(2).max(120).optional(),
  clientPhone: z.string().trim().min(1).optional(),
  bookingDate: dateString.optional(),
  startMin: z.number().int().min(0).max(1439).optional(),
  durationMin: z.number().int().min(5).max(480).optional(),
  service: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  status: z.enum(["confirmed", "cancelled", "done"]).optional(),
});

export const listQuerySchema = z.object({
  salon: z.string().min(1),
  date: dateString,
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
