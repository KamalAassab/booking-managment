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
  /** Warms a salon's day before the tap lands, so the switch is instant. */
  onPrefetch?: (slug: string) => void;
};

/** The phone's salon choice: one segmented track, one tap per salon. */
export function SalonSwitcher({ salons, current, onSelect, onPrefetch }: Props) {
  return (
    <nav aria-label="Salon" className="segmented flex w-full">
      {salons.map((s) => {
        const active = s.slug === current;
        return (
          <button
            key={s.slug}
            type="button"
            onClick={() => onSelect(s.slug)}
            onPointerDown={() => onPrefetch?.(s.slug)}
            onFocus={() => onPrefetch?.(s.slug)}
            aria-current={active ? "page" : undefined}
            className="flex min-h-[38px] flex-1 items-center justify-center gap-1.5"
          >
            <span className="flex shrink-0" style={{ color: salonColor(s.slug) }}>
              <SalonGlyph slug={s.slug} size={14} />
            </span>
            <span className="truncate">{shortName(s.name)}</span>
          </button>
        );
      })}
    </nav>
  );
}
