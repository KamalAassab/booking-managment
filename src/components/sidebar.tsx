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
  Power,
  SalonGlyph,
  User,
} from "@/components/icons";
import { MobileNav } from "@/components/mobile-nav";
import { useSidebarCollapsed } from "@/lib/device";
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
  onPrefetchSalon?: (slug: string) => void;
  role?: "staff" | "owner";
};

/**
 * The obsidian navigation rail, on every signed-in page. Icons only between
 * 768 and 1023px, where the width belongs to the calendar; full labels from
 * 1024px unless the user collapsed it. Below 768px it becomes the bottom
 * navigation (MobileNav).
 */
export function Sidebar({
  salons = DEFAULT_SALONS,
  currentSalon = "vip",
  onSelectSalon,
  onPrefetchSalon,
  role = "owner",
}: Props) {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const pathname = usePathname();
  const router = useRouter();

  const isPlanning = pathname.startsWith("/bookings") || pathname === "/";
  const nav = [
    { href: "/bookings", label: "Planning", icon: Grid, active: isPlanning },
    { href: "/clients", label: "Clients", icon: User, active: pathname.startsWith("/clients") },
    ...(role === "owner"
      ? [
          { href: "/owner/services", label: "Services", icon: ListIcon, active: pathname.startsWith("/owner/services") },
          { href: "/owner", label: "Propriétaire", icon: OwnerAvatarIcon, active: pathname === "/owner" },
        ]
      : []),
  ];

  const selectSalon = (slug: string) => {
    if (onSelectSalon) onSelectSalon(slug);
    else router.push(`/bookings?salon=${slug}`);
  };

  return (
    <>
      <aside className={`sidebar hidden md:flex ${collapsed ? "is-collapsed" : ""}`}>
        <div className="sb-top">
          <Link href="/bookings" className="sb-logo" title="L'Atelier Groupe">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-transparent.webp" alt="L'Atelier Groupe" />
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Développer le menu" : "Réduire le menu"}
            title={collapsed ? "Développer le menu" : "Réduire le menu"}
            className="sb-collapse"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        <nav aria-label="Navigation" className="flex flex-col gap-1">
          {nav.map(({ href, label, icon: Icon, active }) => (
            <Link
              key={href}
              href={href}
              prefetch
              onMouseEnter={() => router.prefetch(href)}
              title={label}
              aria-current={active ? "page" : undefined}
              className="sb-item"
            >
              <Icon size={19} />
              <span className="sb-label">{label}</span>
            </Link>
          ))}
        </nav>

        <div className="sb-section">
          <p className="sb-heading sb-label">Salons</p>
          <nav aria-label="Salon" className="flex flex-col gap-1">
            {salons.map((s) => {
              const active = isPlanning && s.slug === currentSalon;
              return (
                <button
                  key={s.slug}
                  type="button"
                  onClick={() => selectSalon(s.slug)}
                  onMouseEnter={() => onPrefetchSalon?.(s.slug)}
                  onFocus={() => onPrefetchSalon?.(s.slug)}
                  title={s.name}
                  aria-current={active ? "page" : undefined}
                  className="sb-item sb-salon"
                >
                  <span className="flex shrink-0" style={{ color: salonColor(s.slug) }}>
                    <SalonGlyph slug={s.slug} size={18} />
                  </span>
                  <span className="sb-label">{shortName(s.name)}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="sb-footer">
          <div className="sb-role sb-expanded">
            <span className="sb-role-icon" aria-hidden>
              {role === "owner" ? <OwnerAvatarIcon size={16} /> : <User size={15} />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold" style={{ color: "var(--noir-ink)" }}>
                {role === "owner" ? "Propriétaire" : "Personnel"}
              </span>
              <span className="block truncate text-[12px]" style={{ color: "var(--noir-ink-soft)" }}>
                {role === "owner" ? "Accès complet" : "Réservations"}
              </span>
            </span>
          </div>

          <form action={logout}>
            <button type="submit" className="sb-item sb-logout" title="Déconnexion" aria-label="Déconnexion">
              <Power size={18} />
              <span className="sb-label">Déconnexion</span>
            </button>
          </form>
        </div>
      </aside>

      <MobileNav role={role} />
    </>
  );
}
