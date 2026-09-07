"use client";

/**
 * Per-device preferences, kept in localStorage (brief §3: the account is not
 * scoped to a salon, so each browser remembers its own).
 *
 *  - `salon` — a front-desk person should never re-pick their own salon.
 *  - `mode`  — "front_desk" or "call_center". This is a property of the desk,
 *    not of a person: it decides whether Submit opens the pre-filled wa.me
 *    tab. It is not attribution, and nothing about it is stored per user.
 */

import { useCallback, useSyncExternalStore } from "react";

const SALON_KEY = "atelier.salon";
const MODE_KEY = "atelier.mode";
const MODE_EVENT = "atelier:mode";

export type DeviceMode = "front_desk" | "call_center";

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

export function readModePreference(): DeviceMode {
  return safeGet(MODE_KEY) === "call_center" ? "call_center" : "front_desk";
}

function subscribeToMode(onChange: () => void): () => void {
  // `storage` covers the front desk's second window; the custom event covers
  // a change made in this tab, which `storage` deliberately does not fire for.
  window.addEventListener("storage", onChange);
  window.addEventListener(MODE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(MODE_EVENT, onChange);
  };
}

/**
 * localStorage is an external store, so it is read through
 * useSyncExternalStore rather than copied into state inside an effect. The
 * server snapshot is the default, which is also what the very first client
 * paint shows before hydration settles.
 */
export function useDeviceMode(): [DeviceMode, (mode: DeviceMode) => void] {
  const mode = useSyncExternalStore(
    subscribeToMode,
    readModePreference,
    () => "front_desk" as const,
  );

  const setMode = useCallback((next: DeviceMode) => {
    safeSet(MODE_KEY, next);
    window.dispatchEvent(new Event(MODE_EVENT));
  }, []);

  return [mode, setMode];
}
