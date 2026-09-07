/**
 * Phone normalisation for Moroccan numbers.
 *
 * Clients on the phone read their number out in whatever shape they think of
 * it: "06 12 34 56 78", "0612-345678", "+212 612 345 678", "212612345678".
 * The wa.me deep link only accepts digits in international format with no
 * leading +, so everything is normalised on write and stored as E.164.
 *
 * Getting this wrong is not a cosmetic bug: the agent opens a WhatsApp chat
 * with a stranger, mid-call, with nothing on screen to say anything is amiss.
 * So the rules below are deliberately strict, and anything that does not fit
 * one of them is rejected rather than guessed at.
 */

const MOROCCO_CC = "212";

/** Moroccan mobile and landline numbers are nine digits after the trunk 0. */
const NATIONAL_LENGTH = 9;

/** 5 landline, 6 and 7 mobile. Nothing else is assignable in Morocco. */
const VALID_NATIONAL_PREFIX = /^[567]/;

export type PhoneResult =
  | { ok: true; e164: string; wa: string }
  | { ok: false; error: string };

const INVALID = "Numéro invalide. Format attendu : 06 12 34 56 78 ou +212...";

function moroccan(national: string): PhoneResult {
  if (national.length !== NATIONAL_LENGTH) return { ok: false, error: INVALID };
  if (!VALID_NATIONAL_PREFIX.test(national)) {
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

/**
 * Accepts the common Moroccan shapes plus any other country's number written
 * in full international form. Returns E.164 (`+212612345678`) and the digits
 * -only form wa.me wants (`212612345678`).
 */
export function normalizePhone(input: string): PhoneResult {
  if (typeof input !== "string") {
    return { ok: false, error: "Numéro de téléphone requis." };
  }

  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Numéro de téléphone requis." };

  // Anything that is not a digit, a separator humans actually type, or a
  // leading +, means the field was filled in with something that is not a
  // phone number at all. Better to say so than to strip it down to digits
  // and dial whatever is left.
  if (!/^\+?[\d\s().\-/]+$/.test(trimmed)) {
    return { ok: false, error: INVALID };
  }

  let digits = trimmed.replace(/\D/g, "");

  // "+212..." and "00212..." are the same intent written two ways. The 00 is
  // detected on the digits rather than on the raw string so that "00 212 612
  // 345 678" — dictated in groups, which is how people say it out loud — is
  // recognised as international too. No Moroccan national number can start
  // with two zeros, so this cannot swallow a leading trunk zero by mistake.
  const startsWithTrunkPrefix = digits.startsWith("00");
  const isInternational = trimmed.startsWith("+") || startsWithTrunkPrefix;
  if (startsWithTrunkPrefix) digits = digits.slice(2);

  if (!digits) return { ok: false, error: "Numéro de téléphone invalide." };

  if (digits.startsWith(MOROCCO_CC)) {
    let national = digits.slice(MOROCCO_CC.length);
    // "+212 0612345678" — the country code *and* the trunk zero. Extremely
    // common when someone reads their number off a saved contact, and the
    // reason this function exists in its current form: the previous version
    // trusted any string that began with + and produced +2120612345678, a
    // number that belongs to nobody. WhatsApp would have opened a chat with
    // an unknown recipient and the agent would never have seen an error.
    if (national.length === NATIONAL_LENGTH + 1 && national.startsWith("0")) {
      national = national.slice(1);
    }
    return moroccan(national);
  }

  if (digits.startsWith("0") && digits.length === NATIONAL_LENGTH + 1) {
    // 0612345678 — the way almost every client will say it.
    return moroccan(digits.slice(1));
  }

  if (!isInternational && digits.length === NATIONAL_LENGTH) {
    // 612345678 — leading zero dropped.
    return moroccan(digits);
  }

  if (isInternational) {
    // Some other country, written in full international form. We have no
    // per-country rules, so the only check possible is the E.164 length
    // range: a country code is 1-3 digits and the whole number caps at 15.
    if (digits.length < 8 || digits.length > 15) {
      return { ok: false, error: "Numéro de téléphone invalide." };
    }
    return { ok: true, e164: `+${digits}`, wa: digits };
  }

  return { ok: false, error: INVALID };
}

/** `+212612345678` -> `06 12 34 56 78` for display. */
export function formatPhoneForDisplay(e164: string): string {
  if (typeof e164 !== "string") return "";
  if (e164.startsWith(`+${MOROCCO_CC}`) && e164.length === 13) {
    const n = `0${e164.slice(4)}`;
    return `${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8)}`;
  }
  return e164;
}

/** Digits-only form for wa.me, derived from a stored E.164 number. */
export function waDigits(e164: string): string {
  if (typeof e164 !== "string") return "";
  return e164.replace(/\D/g, "");
}
