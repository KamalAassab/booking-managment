/**
 * Phone normalisation for Moroccan numbers.
 *
 * Clients on the phone read their number out in whatever shape they think of
 * it: "06 12 34 56 78", "0612-345678", "+212 612 345 678", "212612345678".
 * The wa.me deep link only accepts digits in international format with no
 * leading +, so everything is normalised on write and stored as E.164.
 */

const MOROCCO_CC = "212";

export type PhoneResult =
  | { ok: true; e164: string; wa: string }
  | { ok: false; error: string };

/**
 * Accepts the common Moroccan shapes plus any other country's number written
 * in full international form. Returns E.164 (`+212612345678`) and the digits
 * -only form wa.me wants (`212612345678`).
 */
export function normalizePhone(input: string): PhoneResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Numéro de téléphone requis." };

  const hadPlus = trimmed.startsWith("+") || trimmed.startsWith("00");
  let digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("00")) digits = digits.slice(2);

  if (!digits) return { ok: false, error: "Numéro de téléphone invalide." };

  let national: string;

  if (digits.startsWith(MOROCCO_CC) && digits.length === 12) {
    // 212612345678
    national = digits.slice(MOROCCO_CC.length);
  } else if (digits.startsWith("0") && digits.length === 10) {
    // 0612345678 — the way almost every client will say it.
    national = digits.slice(1);
  } else if (!hadPlus && digits.length === 9) {
    // 612345678 — leading zero dropped.
    national = digits;
  } else if (hadPlus) {
    // Some other country, written in full international form. Trust it.
    if (digits.length < 8 || digits.length > 15) {
      return { ok: false, error: "Numéro de téléphone invalide." };
    }
    return { ok: true, e164: `+${digits}`, wa: digits };
  } else {
    return {
      ok: false,
      error: "Numéro invalide. Format attendu : 06 12 34 56 78 ou +212...",
    };
  }

  if (national.length !== 9) {
    return {
      ok: false,
      error: "Numéro invalide. Format attendu : 06 12 34 56 78 ou +212...",
    };
  }
  if (!/^[567]/.test(national)) {
    return {
      ok: false,
      error: "Numéro marocain invalide (doit commencer par 05, 06 ou 07).",
    };
  }

  return {
    ok: true,
    e164: `+${MOROCCO_CC}${national}`,
    wa: `${MOROCCO_CC}${national}`,
  };
}

/** `+212612345678` -> `06 12 34 56 78` for display. */
export function formatPhoneForDisplay(e164: string): string {
  if (e164.startsWith(`+${MOROCCO_CC}`) && e164.length === 13) {
    const n = `0${e164.slice(4)}`;
    return `${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8)}`;
  }
  return e164;
}

/** Digits-only form for wa.me, derived from a stored E.164 number. */
export function waDigits(e164: string): string {
  return e164.replace(/\D/g, "");
}
