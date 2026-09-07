"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { users } from "@/db/schema";
import { clearSessionCookie, getSession, setSessionCookie } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";
import type { Role } from "@/lib/session";

export type ActionState = { error?: string; success?: string };

/**
 * A constant-ish-cost dummy verification for the "no such account" branch, so
 * a wrong role selection is not distinguishable by response time from a wrong
 * password.
 */
const DUMMY_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "Ozf1cbNTZ5aY4jVwvhpTC0z5oqCq4/7CfL8Aq6iy3JgOP+m6vHY9Xk5vE3s0lPMoGrRSTS94Y7DFXpVnpDdOTA==";

export async function login(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const rawRole = String(formData.get("role") ?? "staff");
  const password = String(formData.get("password") ?? "");
  const role: Role = rawRole === "owner" ? "owner" : "staff";

  if (!password) return { error: "Mot de passe requis." };

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.username, role))
    .limit(1);
  const user = rows[0];

  if (!user) {
    await verifyPassword(password, DUMMY_HASH);
    return { error: "Mot de passe incorrect." };
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return { error: "Mot de passe incorrect." };

  await setSessionCookie(user.id, user.role);
  redirect(user.role === "owner" ? "/owner" : "/bookings");
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

/**
 * Owner-only. Changes the single shared staff password — the main reason the
 * owner account exists at all (brief §3).
 */
export async function changeStaffPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (!session || session.role !== "owner") {
    return { error: "Action réservée au propriétaire." };
  }

  const next = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
    };
  }
  if (next !== confirm) return { error: "Les deux mots de passe diffèrent." };

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next), updatedAt: new Date() })
    .where(eq(users.username, "staff"));

  return {
    success:
      "Mot de passe du personnel mis à jour. Les sessions déjà ouvertes restent actives — communiquez le nouveau mot de passe aux équipes.",
  };
}

/** Owner-only: change the owner's own password. */
export async function changeOwnerPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (!session || session.role !== "owner") {
    return { error: "Action réservée au propriétaire." };
  }

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.username, "owner"))
    .limit(1);
  const owner = rows[0];
  if (!owner) return { error: "Compte propriétaire introuvable." };

  if (!(await verifyPassword(current, owner.passwordHash))) {
    return { error: "Mot de passe actuel incorrect." };
  }
  if (next.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `Le nouveau mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
    };
  }
  if (next !== confirm) return { error: "Les deux mots de passe diffèrent." };

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next), updatedAt: new Date() })
    .where(eq(users.username, "owner"));

  return { success: "Votre mot de passe a été mis à jour." };
}
