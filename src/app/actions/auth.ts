"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ConfigError, db } from "@/db";
import { users } from "@/db/schema";
import { clearSessionCookie, getSession, setSessionCookie } from "@/lib/auth";
import { isConnectionError, isMissingSchemaError } from "@/lib/db-errors";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  checkRateLimit,
  clientKeyFromHeaders,
  recordFailure,
  recordSuccess,
} from "@/lib/rate-limit";
import { passwordSchema } from "@/lib/validation";
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

const WRONG_PASSWORD = "Mot de passe incorrect.";

/**
 * Turns an infrastructure failure into a sentence the person at the front
 * desk can act on — or pass on. Before this existed, a database that was
 * unreachable or had never been migrated produced an unhandled exception and
 * a blank "A server error occurred" page with no way to tell the two apart.
 */
function describeInfrastructureError(error: unknown): string | null {
  if (error instanceof ConfigError) {
    return `Configuration du serveur incomplète : ${error.message}`;
  }
  if (isMissingSchemaError(error)) {
    return "La base de données n'a pas encore été initialisée (npm run db:migrate).";
  }
  if (isConnectionError(error)) {
    return "Base de données injoignable. Réessayez dans un instant.";
  }
  return null;
}

export async function login(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const rawRole = String(formData.get("role") ?? "staff");
  const password = String(formData.get("password") ?? "");
  const role: Role = rawRole === "owner" ? "owner" : "staff";

  if (!password) return { error: "Mot de passe requis." };

  const key = `login:${role}:${clientKeyFromHeaders(await headers())}`;
  const limit = checkRateLimit(key);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return {
      error:
        limit.retryAfterSeconds < 60
          ? `Trop de tentatives. Réessayez dans ${limit.retryAfterSeconds} secondes.`
          : `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? "s" : ""}.`,
    };
  }

  let user: typeof users.$inferSelect | undefined;
  try {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.username, role))
      .limit(1);
    user = rows[0];
  } catch (error) {
    const described = describeInfrastructureError(error);
    if (described) return { error: described };
    console.error("login query failed", error);
    return { error: "Erreur serveur. Réessayez." };
  }

  if (!user) {
    // Keep the timing indistinguishable from a real account with a wrong
    // password, so "which roles exist" is not readable off the response.
    await verifyPassword(password, DUMMY_HASH);
    recordFailure(key);
    return { error: WRONG_PASSWORD };
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    recordFailure(key);
    return { error: WRONG_PASSWORD };
  }

  recordSuccess(key);

  try {
    await setSessionCookie(user.id, user.role);
  } catch (error) {
    // The only way this fails is a missing or too-short SESSION_SECRET.
    console.error("session cookie could not be issued", error);
    return {
      error:
        "Configuration du serveur incomplète : SESSION_SECRET est absent ou trop court.",
    };
  }

  // redirect() signals by throwing, so nothing below runs on success.
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

  const parsed = passwordSchema.safeParse(next);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Mot de passe invalide." };
  }
  if (next !== confirm) return { error: "Les deux mots de passe diffèrent." };

  try {
    const updated = await db
      .update(users)
      .set({ passwordHash: await hashPassword(next), updatedAt: new Date() })
      .where(eq(users.username, "staff"))
      .returning({ id: users.id });

    // Reporting success for an UPDATE that matched nothing would leave the
    // owner telling the whole team a password that does not work.
    if (updated.length === 0) {
      return { error: "Compte personnel introuvable (lancez npm run db:seed)." };
    }
  } catch (error) {
    const described = describeInfrastructureError(error);
    if (described) return { error: described };
    console.error("staff password change failed", error);
    return { error: "Erreur serveur. Réessayez." };
  }

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

  try {
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

    const parsed = passwordSchema.safeParse(next);
    if (!parsed.success) {
      return {
        error: parsed.error.issues[0]?.message ?? "Mot de passe invalide.",
      };
    }
    if (next !== confirm) return { error: "Les deux mots de passe diffèrent." };
    if (next === current) {
      return { error: "Le nouveau mot de passe est identique à l'ancien." };
    }

    await db
      .update(users)
      .set({ passwordHash: await hashPassword(next), updatedAt: new Date() })
      .where(eq(users.username, "owner"));
  } catch (error) {
    const described = describeInfrastructureError(error);
    if (described) return { error: described };
    console.error("owner password change failed", error);
    return { error: "Erreur serveur. Réessayez." };
  }

  return { success: "Votre mot de passe a été mis à jour." };
}
