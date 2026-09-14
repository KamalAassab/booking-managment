"use client";

import { SalonGlyph } from "@/components/icons";
import { salonColor, shortName } from "@/lib/salon-display";
import type { SalonDTO } from "@/lib/types";

// Re-exported for existing importers — the definitions live in
// lib/salon-display.ts now so a server component (the owner page) can call
// them too; a "use client" module cannot export a plain function that a
// server component invokes directly.
export { salonColor, shortName };

type Props = {
  salons: SalonDTO[];
  current: string;
  onSelect: (slug: string) => void;
  /** Stacked list for the desktop sidebar; segmented track on mobile. */
  variant?: "segmented" | "list";
};

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
                className="flex h-5 w-5 shrink-0 items-center justify-center"
                style={{ color: salonColor(s.slug) }}
              >
                <SalonGlyph slug={s.slug} size={15} />
              </span>
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
              className="flex h-4 w-4 shrink-0 items-center justify-center"
              style={{
                color: salonColor(s.slug),
              }}
            >
              <SalonGlyph slug={s.slug} size={13} />
            </span>
            {shortName(s.name)}
          </button>
        );
      })}
    </nav>
  );
}
