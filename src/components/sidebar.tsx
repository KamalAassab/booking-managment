"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { logout } from "@/app/actions/auth";
import {
  ChevronLeft,
  ChevronRight,
  Grid,
  ListIcon,
  OwnerAvatarIcon,
  Phone,
  Power,
  SalonGlyph,
  User,
} from "@/components/icons";
import { useDeviceMode, useSidebarCollapsed, type DeviceMode } from "@/lib/device";
import { salonColor, shortName } from "@/lib/salon-display";
import type { SalonDTO } from "@/lib/types";

const DEFAULT_SALONS: SalonDTO[] = [
  { id: "vip", slug: "vip", name: "L'Atelier VIP", opensAtMin: 540, closesAtMin: 1200, slotMin: 30 },
  { id: "gold", slug: "gold", name: "L'Atelier Gold", opensAtMin: 540, closesAtMin: 1200, slotMin: 30 },
  { id: "barber", slug: "barber", name: "L'Atelier Silver", opensAtMin: 540, closesAtMin: 1260, slotMin: 30 },
];

type Props = {
  salons?: SalonDTO[];
  currentSalon?: string;
  onSelectSalon?: (slug: string) => void;
  mode?: DeviceMode;
  onModeChange?: (mode: DeviceMode) => void;
  role?: "staff" | "owner";
};

/**
 * Desktop-only luxury black icon rail fixed on all pages. Collapses to an icon-only strip.
 */
export function Sidebar({
  salons = DEFAULT_SALONS,
  currentSalon = "vip",
  onSelectSalon,
  mode,
  onModeChange,
  role = "owner",
}: Props) {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [internalMode, setInternalMode] = useDeviceMode();
  const pathname = usePathname();
  const router = useRouter();

  const activeMode = mode ?? internalMode;
  const handleModeChange = onModeChange ?? setInternalMode;

  const handleSalonClick = (slug: string) => {
    if (onSelectSalon) {
      onSelectSalon(slug);
    } else {
      router.push(`/bookings?salon=${slug}`);
    }
  };

  const isPlanning = pathname.startsWith("/bookings") || pathname === "/";
  const isClients = pathname.startsWith("/clients");
  const isServices = pathname.startsWith("/owner/services");
  const isOwner = pathname === "/owner";

  return (
    <aside
      className="hidden shrink-0 flex-col gap-6 border-r p-4 transition-[width] duration-150 md:sticky md:top-0 md:flex md:h-dvh shadow-2xl text-white"
      style={{
        borderColor: "rgba(255, 255, 255, 0.1)",
        background: "#09090b",
        width: collapsed ? 72 : 220,
      }}
    >
      {/* Top Logo and Collapse Button */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-2.5">
          <Link
            href="/bookings"
            className="flex h-10 w-full items-center justify-center"
            title="L'Atelier Groupe"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-transparent.webp"
              alt="L'Atelier Groupe"
              className="h-7 w-auto max-w-[42px] object-contain"
            />
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label="Développer le menu"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-zinc-400 transition-colors duration-[120ms] hover:bg-zinc-800 hover:text-white"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/bookings"
            className="flex flex-1 items-center justify-center pl-1"
            title="L'Atelier Groupe"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-transparent.webp"
              alt="L'Atelier Groupe"
              className="h-8 w-auto max-w-[135px] object-contain"
            />
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label="Réduire le menu"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-zinc-400 transition-colors duration-[120ms] hover:bg-zinc-800 hover:text-white"
          >
            <ChevronLeft size={16} />
          </button>
        </div>
      )}

      {/* Main Navigation */}
      <nav aria-label="Navigation" className="flex flex-col gap-1">
        <Link
          href="/bookings"
          title="Planning"
          className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold transition-colors duration-[120ms]"
          style={{
            background: isPlanning ? "var(--accent)" : "transparent",
            color: isPlanning ? "#ffffff" : "#d4d4d8",
            justifyContent: collapsed ? "center" : "flex-start",
          }}
        >
          <Grid size={18} />
          {collapsed ? null : "Planning"}
        </Link>

        <Link
          href="/clients"
          title="Clients"
          className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[13px] font-medium transition-colors duration-[120ms] hover:bg-zinc-800/80 hover:text-white"
          style={{
            background: isClients ? "var(--accent)" : "transparent",
            color: isClients ? "#ffffff" : "#d4d4d8",
            justifyContent: collapsed ? "center" : "flex-start",
          }}
        >
          <User size={18} />
          {collapsed ? null : "Clients"}
        </Link>

        {role === "owner" ? (
          <>
            <Link
              href="/owner/services"
              title="Services"
              className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[13px] font-medium transition-colors duration-[120ms] hover:bg-zinc-800/80 hover:text-white"
              style={{
                background: isServices ? "var(--accent)" : "transparent",
                color: isServices ? "#ffffff" : "#d4d4d8",
                justifyContent: collapsed ? "center" : "flex-start",
              }}
            >
              <ListIcon size={18} />
              {collapsed ? null : "Services"}
            </Link>

            <Link
              href="/owner"
              title="Espace propriétaire"
              className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[13px] font-medium transition-colors duration-[120ms] hover:bg-zinc-800/80 hover:text-white"
              style={{
                background: isOwner ? "var(--accent)" : "transparent",
                color: isOwner ? "#ffffff" : "#d4d4d8",
                justifyContent: collapsed ? "center" : "flex-start",
              }}
            >
              <OwnerAvatarIcon size={18} />
              {collapsed ? null : "Propriétaire"}
            </Link>
          </>
        ) : null}
      </nav>

      {/* Salon Switcher */}
      <div className="border-t pt-4" style={{ borderColor: "rgba(255, 255, 255, 0.08)" }}>
        {collapsed ? null : (
          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Salons
          </span>
        )}
        {collapsed ? (
          <nav aria-label="Salon" className="flex flex-col gap-2">
            {salons.map((s) => {
              const isActive = isPlanning && s.slug === currentSalon;
              return (
                <button
                  key={s.slug}
                  type="button"
                  onClick={() => handleSalonClick(s.slug)}
                  title={shortName(s.name)}
                  aria-current={isActive ? "page" : undefined}
                  className="flex w-full flex-col items-center justify-center gap-1.5 rounded-[10px] py-2.5 transition-colors duration-[120ms]"
                  style={{
                    background: isActive ? "#18181b" : "transparent",
                    color: isActive ? "#ffffff" : "#a1a1aa",
                    border: isActive ? `1px solid ${salonColor(s.slug)}` : "1px solid transparent",
                  }}
                >
                  <span style={{ color: salonColor(s.slug) }}>
                    <SalonGlyph slug={s.slug} size={18} />
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? "#ffffff" : "#a1a1aa",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {shortName(s.name)}
                  </span>
                </button>
              );
            })}
          </nav>
        ) : (
          <nav aria-label="Salon" className="flex flex-col gap-1.5">
            {salons.map((s) => {
              const isActive = isPlanning && s.slug === currentSalon;
              return (
                <button
                  key={s.slug}
                  type="button"
                  onClick={() => handleSalonClick(s.slug)}
                  aria-current={isActive ? "page" : undefined}
                  className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-[13px] transition-colors duration-[120ms]"
                  style={{
                    background: isActive ? "#18181b" : "transparent",
                    color: isActive ? "#ffffff" : "#a1a1aa",
                    fontWeight: isActive ? 600 : 400,
                    border: isActive ? `1px solid rgba(255, 255, 255, 0.14)` : "1px solid transparent",
                  }}
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px]"
                    style={{
                      background: isActive ? "rgba(255, 255, 255, 0.08)" : "transparent",
                      color: salonColor(s.slug),
                    }}
                  >
                    <SalonGlyph slug={s.slug} size={16} />
                  </span>
                  <span className="truncate">{shortName(s.name)}</span>
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {/* Footer / Actor Role / Logout */}
      <div className="mt-auto flex flex-col gap-3 border-t pt-4" style={{ borderColor: "rgba(255, 255, 255, 0.08)" }}>
        {collapsed ? (
          <div
            title={role === "owner" ? "Session Propriétaire" : "Session Centre d'appels"}
            className="flex h-8 w-8 items-center justify-center rounded-full mx-auto"
            style={{ background: "#18181b", color: "var(--accent)" }}
          >
            {role === "owner" ? <OwnerAvatarIcon size={16} /> : <Phone size={15} />}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-[10px] px-3 py-2" style={{ background: "#18181b" }}>
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
              style={{ background: "var(--accent-tint)", color: "var(--accent-hover)" }}
            >
              {role === "owner" ? <OwnerAvatarIcon size={14} /> : <Phone size={13} />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold text-white">
                {role === "owner" ? "Propriétaire" : "Centre d'appels"}
              </p>
              <p className="truncate text-[10.5px] text-zinc-400">
                {role === "owner" ? "Accès complet" : "Gestion des réservations"}
              </p>
            </div>
          </div>
        )}

        <form
          action={logout}
          className={collapsed ? "flex justify-center" : "flex items-center gap-2.5 px-1"}
        >
          <button
            type="submit"
            aria-label="Déconnexion"
            title="Déconnexion"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors duration-[120ms] hover:bg-zinc-800 hover:text-rose-400"
            style={{ border: "1px solid rgba(255, 255, 255, 0.12)" }}
          >
            <Power size={16} />
          </button>
          {collapsed ? null : (
            <span className="t-small text-zinc-400">
              Déconnexion
            </span>
          )}
        </form>
      </div>
    </aside>
  );
}
