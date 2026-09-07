import { formatPhoneForDisplay, normalizePhone } from "./phone";

/**
 * The salon's own WhatsApp number.
 *
 * This is the number the confirmations go *out* from — the account on the
 * owner's phone that each of the four call-centre browsers is linked to as a
 * WhatsApp companion device (README, "WhatsApp confirmations"). It is not a
 * client's number and it is never written to the bookings table; the wa.me
 * link is always addressed to the client.
 *
 * It lives in configuration rather than in the database because there is
 * exactly one of it and it changes roughly never — a database column would
 * mean a migration, a seed, and an admin screen for a value that is read and
 * never written. Override it per environment with SALON_WHATSAPP_NUMBER.
 */
const DEFAULT_SALON_WHATSAPP = "+212766092140";

export type SalonContact = {
  /** E.164, e.g. +212766092140. */
  e164: string;
  /** Digits only, for a wa.me URL. */
  wa: string;
  /** How staff read it aloud, e.g. 07 66 09 21 40. */
  display: string;
};

/**
 * Parsed once per process. A misconfigured override falls back to the default
 * rather than throwing: a bad environment variable must not be able to take
 * the owner screen down, and the number is informational on every path that
 * reads it.
 */
export function salonWhatsAppNumber(): SalonContact {
  const configured = process.env.SALON_WHATSAPP_NUMBER?.trim();
  const parsed = normalizePhone(configured || DEFAULT_SALON_WHATSAPP);

  if (!parsed.ok) {
    const fallback = normalizePhone(DEFAULT_SALON_WHATSAPP);
    if (!fallback.ok) {
      // Unreachable: the default is a constant checked by the test suite.
      return { e164: DEFAULT_SALON_WHATSAPP, wa: "", display: DEFAULT_SALON_WHATSAPP };
    }
    return {
      e164: fallback.e164,
      wa: fallback.wa,
      display: formatPhoneForDisplay(fallback.e164),
    };
  }

  return {
    e164: parsed.e164,
    wa: parsed.wa,
    display: formatPhoneForDisplay(parsed.e164),
  };
}
