"use client";

/**
 * Per-device preferences, kept in localStorage (brief §3: the account is not
 * scoped to a salon, so each browser remembers its own).
 *
 *  - `salon` — a call-centre agent should never re-pick their own salon.
 */

import { useCallback, useSyncExternalStore } from "react";

const SALON_KEY = "atelier.salon";
const SIDEBAR_KEY = "atelier.sidebar.collapsed";
const SIDEBAR_EVENT = "atelier:sidebar";

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private mode, or site data blocked — fall back to defaults silently.
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do; the app works fine without a remembered preference.
  }
}

export function readSalonPreference(): string | null {
  return safeGet(SALON_KEY);
}

export function writeSalonPreference(slug: string): void {
  safeSet(SALON_KEY, slug);
}

function readSidebarCollapsed(): boolean {
  return safeGet(SIDEBAR_KEY) === "1";
}

function subscribeToSidebar(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(SIDEBAR_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SIDEBAR_EVENT, onChange);
  };
}

/**
 * The desktop sidebar's collapsed state is a per-device preference in
 * localStorage, read through useSyncExternalStore so the first client paint
 * matches the server render (the default) instead of flashing on hydration.
 */
export function useSidebarCollapsed(): [boolean, (collapsed: boolean) => void] {
  const collapsed = useSyncExternalStore(
    subscribeToSidebar,
    readSidebarCollapsed,
    () => false,
  );

  const setCollapsed = useCallback((next: boolean) => {
    safeSet(SIDEBAR_KEY, next ? "1" : "0");
    window.dispatchEvent(new Event(SIDEBAR_EVENT));
  }, []);

  return [collapsed, setCollapsed];
}
