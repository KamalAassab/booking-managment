"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { logout } from "@/app/actions/auth";
import {
  Close,
  Grid,
  ListIcon,
  Menu,
  OwnerAvatarIcon,
  Phone,
  Power,
  User,
} from "@/components/icons";
import type { DeviceMode } from "@/lib/device";

type Props = {
  role: "staff" | "owner";
  mode: DeviceMode;
  onModeChange: (mode: DeviceMode) => void;
};

/**
 * The phone's navigation: every section one thumb-reach tap away at the
 * bottom of the screen, and the device settings (the desk this phone is,
 * and signing out) in an account sheet. Before this, a phone had no way to
 * reach Clients or to set the desk at all.
 */
export function MobileNav({ role, mode, onModeChange }: Props) {
  const pathname = usePathname();
  const [accountOpen, setAccountOpen] = useState(false);

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
    <>
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
        <button
          type="button"
          className="mnav-item"
          onClick={() => setAccountOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={accountOpen}
        >
          <Menu size={22} />
          <span>Compte</span>
        </button>
      </nav>

      {accountOpen ? (
        <AccountSheet
          role={role}
          mode={mode}
          onModeChange={onModeChange}
          onClose={() => setAccountOpen(false)}
        />
      ) : null}
    </>
  );
}

function AccountSheet({
  role,
  mode,
  onModeChange,
  onClose,
}: Props & { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  });

  useEffect(() => {
    const returnFocusTo = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const listener = (e: KeyboardEvent) => onKeyDown(e);
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      returnFocusTo?.focus?.();
    };
  }, []);

  return (
    <div
      className="sheet-backdrop md:hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        className="anim-sheet w-full rounded-t-[20px] px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-2"
        style={{ background: "var(--surface)", boxShadow: "var(--shadow-sheet)" }}
      >
        <div className="flex justify-center pb-1" aria-hidden>
          <span className="block h-1 w-9 rounded-full" style={{ background: "var(--line-strong)" }} />
        </div>
        <div className="flex items-center justify-between py-2">
          <div>
            <h2 id="account-title" className="t-heading">
              Compte
            </h2>
            <p className="t-small" style={{ color: "var(--ink-faint)" }}>
              {role === "owner" ? "Propriétaire, accès complet" : "Personnel, gestion des réservations"}
            </p>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Fermer">
            <Close size={20} />
          </button>
        </div>

        <div className="mt-2">
          <p className="label">Poste de cet appareil</p>
          <div role="radiogroup" aria-label="Poste" className="grid grid-cols-2 gap-2">
            {(
              [
                ["front_desk", "Réception", User],
                ["call_center", "Centre d'appels", Phone],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => onModeChange(value)}
                className="choice"
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
          </div>
          <p className="t-small mt-2" style={{ color: "var(--ink-faint)" }}>
            Enregistré sur chaque rendez-vous pris depuis cet appareil.
          </p>
        </div>

        <form action={logout} className="mt-5">
          <button type="submit" className="btn-danger w-full">
            <Power size={18} />
            Déconnexion
          </button>
        </form>
      </div>
    </div>
  );
}
