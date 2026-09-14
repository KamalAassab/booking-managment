"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import {
  createService,
  deleteService,
  updateService,
} from "@/lib/services";

const UpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Nom requis").max(200).optional(),
  category: z.string().min(1).max(120).optional(),
  durationMin: z.coerce.number().int().min(1).max(480).optional(),
  price: z.coerce.number().int().min(0).max(99999).optional(),
});

const CreateSchema = z.object({
  salonId: z.string().uuid(),
  category: z.string().min(1, "Catégorie requise").max(120),
  name: z.string().min(1, "Nom requis").max(200),
  durationMin: z.coerce.number().int().min(1).max(480),
  price: z.coerce.number().int().min(0).max(99999),
});

export type ServiceActionState = {
  error?: string;
  success?: boolean;
};

export async function updateServiceAction(
  _prev: ServiceActionState,
  formData: FormData,
): Promise<ServiceActionState> {
  await requireOwner();

  const parsed = UpdateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name") ?? undefined,
    category: formData.get("category") ?? undefined,
    durationMin: formData.get("durationMin") ?? undefined,
    price: formData.get("price") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }

  const { id, ...patch } = parsed.data;
  const updated = await updateService(id, patch);
  if (!updated) return { error: "Service introuvable." };

  revalidatePath("/owner/services");
  return { success: true };
}

export async function createServiceAction(
  _prev: ServiceActionState,
  formData: FormData,
): Promise<ServiceActionState> {
  await requireOwner();

  const parsed = CreateSchema.safeParse({
    salonId: formData.get("salonId"),
    category: formData.get("category"),
    name: formData.get("name"),
    durationMin: formData.get("durationMin"),
    price: formData.get("price"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }

  await createService(parsed.data);

  revalidatePath("/owner/services");
  return { success: true };
}

export async function deleteServiceAction(
  _prev: ServiceActionState,
  formData: FormData,
): Promise<ServiceActionState> {
  await requireOwner();

  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "ID manquant." };

  const deleted = await deleteService(id);
  if (!deleted) return { error: "Service introuvable." };

  revalidatePath("/owner/services");
  return { success: true };
}
