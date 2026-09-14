"use client";

import { logout } from "@/app/actions/auth";
import {
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Grid,
  Phone,
  Power,
  User,
} from "@/components/icons";
import { useSidebarCollapsed, type DeviceMode } from "@/lib/device";
import { salonColor, shortName } from "@/lib/salon-display";
import type { SalonDTO } from "@/lib/types";

type Props = {
  salons: SalonDTO[];
  currentSalon: string;
  onSelectSalon: (slug: string) => void;
  mode: DeviceMode;
  onModeChange: (mode: DeviceMode) => void;
  role: "staff" | "owner";
};

/**
 * Desktop-only icon rail. Collapses to an icon-only strip — a front desk
 * running a small screen gets the width back; salon and poste stay reachable
 * either way, just as a dot or an icon instead of a labelled row.
 */
export function Sidebar({
  salons,
  currentSalon,
  onSelectSalon,
  mode,
  onModeChange,
  role,
}: Props) {
  const [collapsed, setCollapsed] = useSidebarCollapsed();

  return (
    <aside
      className="hidden shrink-0 flex-col gap-6 border-r p-4 transition-[width] duration-150 lg:sticky lg:top-0 lg:flex lg:h-dvh"
      style={{
        borderColor: "var(--line)",
        background: "var(--surface-sunk)",
        width: collapsed ? 72 : 220,
      }}
    >
      <div className="flex items-center justify-between">
        {collapsed ? null : <p className="t-title text-[16px] leading-tight">Atelier</p>}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Développer le menu" : "Réduire le menu"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] transition-colors duration-[120ms] hover:bg-[color:var(--surface)]"
          style={{ color: "var(--ink-soft)" }}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav aria-label="Navigation" className="flex flex-col gap-0.5">
        <NavItem icon={<Grid size={18} />} label="Planning" active collapsed={collapsed} />
        {role === "owner" ? (
          <a
            href="/owner"
            title="Espace propriétaire"
            className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[13px] transition-colors duration-[120ms] hover:bg-[color:var(--surface)]"
            style={{ color: "var(--ink-soft)", justifyContent: collapsed ? "center" : "flex-start" }}
          >
            <Briefcase size={18} />
            {collapsed ? null : "Espace propriétaire"}
          </a>
        ) : null}
      </nav>

      <div>
        {collapsed ? null : <span className="label mb-1.5 block">Salon</span>}
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            {salons.map((s) => (
              <button
                key={s.slug}
                type="button"
                title={shortName(s.name)}
                onClick={() => onSelectSalon(s.slug)}
                aria-current={s.slug === currentSalon ? "page" : undefined}
                className="flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-[120ms]"
                style={{
                  background:
                    s.slug === currentSalon ? "var(--surface)" : "transparent",
                  border:
                    s.slug === currentSalon
                      ? `1.5px solid ${salonColor(s.slug)}`
                      : "1.5px solid transparent",
                }}
              >
                <span
                  className="block h-2 w-2 rounded-full"
                  style={{ background: salonColor(s.slug) }}
                  aria-hidden
                />
              </button>
            ))}
          </div>
        ) : (
          <nav aria-label="Salon" className="flex flex-col gap-0.5">
            {salons.map((s) => {
              const isActive = s.slug === currentSalon;
              return (
                <button
                  key={s.slug}
                  type="button"
                  onClick={() => onSelectSalon(s.slug)}
                  aria-current={isActive ? "page" : undefined}
                  className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-[120ms]"
                  style={{
                    background: isActive ? "var(--surface)" : "transparent",
                    color: isActive ? "var(--ink)" : "var(--ink-soft)",
                    fontWeight: isActive ? 600 : 400,
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
        )}
      </div>

      <div className="mt-auto flex flex-col gap-4">
        <div>
          {collapsed ? null : <span className="label mb-1.5 block">Poste</span>}
          <div
            role="radiogroup"
            aria-label="Type de poste"
            className={collapsed ? "flex flex-col items-center gap-2" : "flex flex-col gap-0.5"}
          >
            {(
              [
                ["front_desk", "Réception", User],
                ["call_center", "Centre d'appels", Phone],
              ] as const
            ).map(([value, label, Icon]) =>
              collapsed ? (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  title={label}
                  onClick={() => onModeChange(value)}
                  className="flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-[120ms]"
                  style={{
                    background: mode === value ? "var(--surface)" : "transparent",
                    color: mode === value ? "var(--accent)" : "var(--ink-faint)",
                    border:
                      mode === value
                        ? "1.5px solid var(--accent)"
                        : "1.5px solid var(--line-strong)",
                  }}
                >
                  <Icon size={14} />
                </button>
              ) : (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => onModeChange(value)}
                  className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-left text-[13px] transition-colors duration-[120ms]"
                  style={{
                    background: mode === value ? "var(--surface)" : "transparent",
                    color: mode === value ? "var(--ink)" : "var(--ink-soft)",
                    fontWeight: mode === value ? 600 : 400,
                  }}
                >
                  <span
                    className="block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      background: mode === value ? "var(--accent)" : "var(--line-strong)",
                    }}
                    aria-hidden
                  />
                  {label}
                </button>
              ),
            )}
          </div>
        </div>

        <form
          action={logout}
          className={collapsed ? "flex justify-center" : "flex items-center gap-2.5 px-1"}
        >
          <button
            type="submit"
            aria-label="Déconnexion"
            title="Déconnexion"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors duration-[120ms] hover:bg-[color:var(--surface)]"
            style={{ color: "var(--ink-soft)", border: "1px solid var(--line-strong)" }}
          >
            <Power size={16} />
          </button>
          {collapsed ? null : (
            <span className="t-small" style={{ color: "var(--ink-faint)" }}>
              Déconnexion
            </span>
          )}
        </form>
      </div>
    </aside>
  );
}

function NavItem({
  icon,
  label,
  active,
  collapsed,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  collapsed: boolean;
}) {
  return (
    <span
      title={label}
      className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold"
      style={{
        background: active ? "var(--accent)" : "transparent",
        color: active ? "#fff" : "var(--ink-soft)",
        justifyContent: collapsed ? "center" : "flex-start",
      }}
    >
      {icon}
      {collapsed ? null : label}
    </span>
  );
}
