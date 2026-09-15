"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ConfigError } from "@/db";
import { requireOwner } from "@/lib/auth";
import {
  isConnectionError,
  isMissingSchemaError,
  pgErrorCode,
  SQLSTATE,
} from "@/lib/db-errors";
import {
  createService,
  deleteService,
  updateService,
} from "@/lib/services";
import { MAX_DURATION_MIN, MIN_DURATION_MIN } from "@/lib/validation";

// A service's duration pre-fills the booking sheet, so it is held to the same
// bounds as a booking: a 3-minute service could be saved here and then never
// booked, because POST /api/bookings refuses anything under five minutes.
const durationMin = z.coerce
  .number({ error: "Durée invalide." })
  .int("Durée invalide.")
  .min(MIN_DURATION_MIN, `Durée minimale : ${MIN_DURATION_MIN} min.`)
  .max(MAX_DURATION_MIN, `Durée maximale : ${MAX_DURATION_MIN} min.`);

const price = z.coerce
  .number({ error: "Prix invalide." })
  .int("Prix invalide.")
  .min(0, "Le prix ne peut pas être négatif.")
  .max(99999, "Prix trop élevé.");

const name = z
  .string({ error: "Nom requis." })
  .trim()
  .min(1, "Nom requis.")
  .max(200, "Nom trop long.");

const category = z
  .string({ error: "Catégorie requise." })
  .trim()
  .min(1, "Catégorie requise.")
  .max(120, "Catégorie trop longue.");

const id = z.uuid({ error: "Service introuvable." });

const UpdateSchema = z.object({
  id,
  name: name.optional(),
  category: category.optional(),
  durationMin: durationMin.optional(),
  price: price.optional(),
});

const CreateSchema = z.object({
  salonId: z.uuid({ error: "Salon introuvable." }),
  category,
  name,
  durationMin,
  price,
});

export type ServiceActionState = {
  error?: string;
  success?: boolean;
};

/** A sentence for the owner instead of an exception out of the action. */
function describeFailure(error: unknown, context: string): ServiceActionState {
  if (error instanceof ConfigError) {
    return { error: "Configuration du serveur incomplète." };
  }
  if (isMissingSchemaError(error)) {
    return { error: "Base de données non initialisée (lancez npm run db:migrate)." };
  }
  if (isConnectionError(error)) {
    return { error: "Base de données injoignable. Réessayez dans un instant." };
  }
  if (pgErrorCode(error) === SQLSTATE.FOREIGN_KEY_VIOLATION) {
    return { error: "Salon introuvable." };
  }
  console.error(`${context} failed`, error);
  return { error: "Erreur serveur. Réessayez." };
}

/** FormData.get returns null for an absent field; zod wants undefined. */
function field(formData: FormData, key: string): FormDataEntryValue | undefined {
  return formData.get(key) ?? undefined;
}

export async function updateServiceAction(
  _prev: ServiceActionState,
  formData: FormData,
): Promise<ServiceActionState> {
  await requireOwner();

  const parsed = UpdateSchema.safeParse({
    id: field(formData, "id"),
    name: field(formData, "name"),
    category: field(formData, "category"),
    durationMin: field(formData, "durationMin"),
    price: field(formData, "price"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }

  const { id: serviceId, ...patch } = parsed.data;
  try {
    const updated = await updateService(serviceId, patch);
    if (!updated) return { error: "Service introuvable." };
  } catch (error) {
    return describeFailure(error, "updateServiceAction");
  }

  revalidatePath("/owner/services");
  revalidatePath("/bookings");
  return { success: true };
}

export async function createServiceAction(
  _prev: ServiceActionState,
  formData: FormData,
): Promise<ServiceActionState> {
  await requireOwner();

  const parsed = CreateSchema.safeParse({
    salonId: field(formData, "salonId"),
    category: field(formData, "category"),
    name: field(formData, "name"),
    durationMin: field(formData, "durationMin"),
    price: field(formData, "price"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }

  try {
    await createService(parsed.data);
  } catch (error) {
    return describeFailure(error, "createServiceAction");
  }

  revalidatePath("/owner/services");
  revalidatePath("/bookings");
  return { success: true };
}

export async function deleteServiceAction(
  _prev: ServiceActionState,
  formData: FormData,
): Promise<ServiceActionState> {
  await requireOwner();

  const parsed = id.safeParse(field(formData, "id"));
  if (!parsed.success) return { error: "Service introuvable." };

  try {
    const deleted = await deleteService(parsed.data);
    if (!deleted) return { error: "Service introuvable." };
  } catch (error) {
    return describeFailure(error, "deleteServiceAction");
  }

  revalidatePath("/owner/services");
  revalidatePath("/bookings");
  return { success: true };
}
