import { formatDuration } from "./day-layout";
import { formatLongDate, minutesToLabel } from "./time";
import { waDigits } from "./phone";

export type ConfirmationInput = {
  clientName: string;
  clientPhone: string;
  salonName: string;
  salonSlug?: string;
  bookingDate: string;
  startMin: number;
  /** One line per service, in run order — its own duration and price. */
  services: { service: string; durationMin: number; price: number }[];
  notes?: string | null;
};

/**
 * Returns matching native emoji for each salon identity:
 * - VIP: 👑 (Crown)
 * - Gold: ✨ (Sparkles)
 * - Silver / Barber: 💈 (Barber Pole)
 */
const EMOJI_VIP = "\u{1F451}"; // 👑 Crown
const EMOJI_GOLD = "\u{2728}"; // ✨ Sparkles
const EMOJI_SILVER = "\u{1F488}"; // 💈 Barber Pole
const EMOJI_WAVE = "\u{1F44B}"; // 👋 Wave
const EMOJI_CALENDAR = "\u{1F4C5}"; // 📅 Calendar
const EMOJI_CLOCK = "\u{23F0}"; // ⏰ Alarm Clock
const EMOJI_SCISSORS = "\u{2702}\uFE0F"; // ✂️ Scissors
const EMOJI_MONEY = "\u{1F4B0}"; // 💰 Money bag
const EMOJI_NOTE = "\u{1F4DD}"; // 📝 Memo
const EMOJI_PIN = "\u{1F4CD}"; // 📍 Round Pushpin

export function getSalonEmoji(salonName: string, salonSlug?: string): string {
  const norm = (salonSlug || salonName).toLowerCase();
  if (norm.includes("vip")) return EMOJI_VIP;
  if (norm.includes("gold")) return EMOJI_GOLD;
  if (norm.includes("barber") || norm.includes("silver")) return EMOJI_SILVER;
  return EMOJI_GOLD;
}

/**
 * Builds a rich, beautifully formatted WhatsApp confirmation message with:
 * - Native WhatsApp emojis (👑, ✨, 💈, 📅, ⏰, ✂️, 💰, 📍, 👋)
 * - Salon-matching signature styling
 * - Total price and duration details
 * - Client greeting and polite closing
 */
export function buildConfirmationMessage(b: ConfirmationInput): string {
  const firstName = b.clientName.trim().split(/\s+/)[0] || b.clientName.trim();
  const salonIcon = getSalonEmoji(b.salonName, b.salonSlug);

  const totalDuration = b.services.reduce((sum, s) => sum + s.durationMin, 0);
  const totalPrice = b.services.reduce((sum, s) => sum + s.price, 0);
  const serviceLabel = b.services.map((s) => s.service).join(" + ");

  const lines: string[] = [
    `Bonjour ${firstName} ${EMOJI_WAVE},`,
    "",
    `Votre rendez-vous chez ${salonIcon} *${b.salonName}* est confirmé :`,
    "",
    `${EMOJI_CALENDAR} *Date :* ${formatLongDate(b.bookingDate)}`,
    `${EMOJI_CLOCK} *Heure :* ${minutesToLabel(b.startMin)}${totalDuration ? ` (${formatDuration(totalDuration)})` : ""}`,
    `${EMOJI_SCISSORS} *Prestation${b.services.length > 1 ? "s" : ""} :* ${serviceLabel}`,
  ];

  if (totalPrice > 0) {
    lines.push(`${EMOJI_MONEY} *Tarif :* ${totalPrice.toLocaleString("fr-MA")} MAD`);
  }

  if (b.notes && b.notes.trim()) {
    lines.push(`${EMOJI_NOTE} *Note :* ${b.notes.trim()}`);
  }

  lines.push(
    `${EMOJI_PIN} *Lieu :* ${b.salonName}`,
    "",
    "Merci de nous prévenir en cas d'empêchement.",
    `À très bientôt ! ${EMOJI_GOLD}`
  );

  return lines.join("\n");
}

/** Full WhatsApp direct URL with the confirmation text pre-filled.
 * Uses api.whatsapp.com/send directly to avoid the wa.me 302 redirect
 * header bug that corrupts multi-byte UTF-8 emojis into replacement diamonds ().
 */
export function buildWhatsAppLink(b: ConfirmationInput): string {
  const phone = waDigits(b.clientPhone);
  const text = encodeURIComponent(wellFormed(buildConfirmationMessage(b)));
  return `https://api.whatsapp.com/send?phone=${phone}&text=${text}`;
}

/**
 * encodeURIComponent throws on half an emoji — a lone UTF-16 surrogate, which
 * a paste cut mid-character can leave in a name or note. That would crash the
 * booking sheet's submit handler; the replacement character is the better
 * outcome.
 */
function wellFormed(text: string): string {
  return typeof text.toWellFormed === "function"
    ? text.toWellFormed()
    : text.replace(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
        "�",
      );
}
