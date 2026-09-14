/**
 * Pure display helpers for salon identity — split out from
 * components/salon-switcher.tsx (a "use client" module) because Next 16
 * refuses to call a plain function exported from a client module during
 * server rendering, and the owner page needs these while rendering on the
 * server.
 */

/**
 * Salon colour is the one place identity colour is used, because it is the
 * one place salons are compared. Inside a single salon's grid the colour
 * would be constant, and a constant carries nothing.
 */
export function salonColor(slug: string): string {
  if (slug === "vip") return "var(--salon-vip)";
  if (slug === "gold") return "var(--salon-gold)";
  if (slug === "barber") return "var(--salon-barber)";
  return "var(--ink-soft)";
}

/** "L'Atelier Gold" -> "Gold". The prefix is constant, so it carries nothing. */
export function shortName(name: string): string {
  return name.replace(/^L'Atelier\s*/i, "").replace(/\s*Shop & Spa$/i, "");
}
