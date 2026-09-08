"use client";

import type { SalonDTO } from "@/lib/types";

type Props = {
  salons: SalonDTO[];
  current: string;
  onSelect: (slug: string) => void;
  /** Stacked list for the desktop sidebar; segmented track on mobile. */
  variant?: "segmented" | "list";
};

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

export function SalonSwitcher({
  salons,
  current,
  onSelect,
  variant = "segmented",
}: Props) {
  if (variant === "list") {
    return (
      <nav aria-label="Salon" className="flex flex-col gap-0.5">
        {salons.map((s) => {
          const active = s.slug === current;
          return (
            <button
              key={s.slug}
              type="button"
              onClick={() => onSelect(s.slug)}
              aria-current={active ? "page" : undefined}
              className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-[120ms]"
              style={{
                background: active ? "var(--surface-sunk)" : "transparent",
                color: active ? "var(--ink)" : "var(--ink-soft)",
                fontWeight: active ? 600 : 400,
              }}
            >
              <span
                className="block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: salonColor(s.slug) }}
                aria-hidden
              />
              <span className="truncate">{shortName(s.name)}</span>
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Salon"
      className="flex gap-0.5 rounded-full p-0.5"
      style={{ background: "var(--surface-sunk)" }}
    >
      {salons.map((s) => {
        const active = s.slug === current;
        return (
          <button
            key={s.slug}
            type="button"
            onClick={() => onSelect(s.slug)}
            aria-current={active ? "page" : undefined}
            className="flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] transition-colors duration-[120ms]"
            style={{
              background: active ? "var(--surface)" : "transparent",
              boxShadow: active ? "var(--shadow-card)" : "none",
              color: active ? "var(--ink)" : "var(--ink-soft)",
              fontWeight: active ? 600 : 500,
            }}
          >
            <span
              className="block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{
                background: active ? salonColor(s.slug) : "transparent",
              }}
              aria-hidden
            />
            {shortName(s.name)}
          </button>
        );
      })}
    </nav>
  );
}
