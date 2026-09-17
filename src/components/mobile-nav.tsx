"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { logout } from "@/app/actions/auth";
import { Grid, ListIcon, OwnerAvatarIcon, Power, User } from "@/components/icons";

type Props = {
  role: "staff" | "owner";
};

/**
 * The phone's navigation: every section one thumb-reach tap away at the
 * bottom of the screen, with sign-out itself as the last tap rather than
 * behind an account sheet — nothing else lived there worth a confirmation
 * screen.
 */
export function MobileNav({ role }: Props) {
  const pathname = usePathname();

  const items = [
    { href: "/bookings", label: "Planning", icon: Grid, active: pathname.startsWith("/bookings") || pathname === "/" },
    { href: "/clients", label: "Clients", icon: User, active: pathname.startsWith("/clients") },
    ...(role === "owner"
      ? [
          { href: "/owner/services", label: "Services", icon: ListIcon, active: pathname.startsWith("/owner/services") },
          { href: "/owner", label: "Gestion", icon: OwnerAvatarIcon, active: pathname === "/owner" },
        ]
      : []),
  ];

  return (
    <nav aria-label="Navigation" className="mobile-nav md:hidden">
      {items.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={href}
          href={href}
          prefetch
          className="mnav-item"
          aria-current={active ? "page" : undefined}
        >
          <Icon size={22} />
          <span>{label}</span>
        </Link>
      ))}
      <form action={logout} className="contents">
        <button type="submit" className="mnav-item">
          <Power size={22} />
          <span>Déconnexion</span>
        </button>
      </form>
    </nav>
  );
}
