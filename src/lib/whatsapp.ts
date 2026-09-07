import { formatLongDate, minutesToLabel } from "./time";
import { waDigits } from "./phone";

/**
 * WhatsApp confirmation — click-to-chat only.
 *
 * See PROJECT_BRIEF.md §3. We deliberately do NOT use the WhatsApp Business
 * Platform (would force migrating the owner's existing number off the phone
 * app) and we deliberately do NOT drive WhatsApp Web through an unofficial
 * automation library (real risk of the salon's main number being banned).
 *
 * Instead we build WhatsApp's own official wa.me deep link with the message
 * pre-filled. Because each agent's browser is already a linked companion
 * device on the salon's number, the link opens straight into the compose box
 * and the agent presses Send once. One click is the correct ceiling here —
 * do not try to make this literally zero-click without reopening that
 * decision with the owner.
 */

export type ConfirmationInput = {
  clientName: string;
  clientPhone: string;
  salonName: string;
  bookingDate: string;
  startMin: number;
  service: string;
};

export function buildConfirmationMessage(b: ConfirmationInput): string {
  const firstName = b.clientName.trim().split(/\s+/)[0] || b.clientName.trim();
  return [
    `Bonjour ${firstName},`,
    "",
    `Votre rendez-vous chez ${b.salonName} est confirmé :`,
    `📅 ${formatLongDate(b.bookingDate)}`,
    `🕐 ${minutesToLabel(b.startMin)}`,
    `💇 ${b.service}`,
    "",
    "Merci de nous prévenir en cas d'empêchement.",
    "À très bientôt !",
  ].join("\n");
}

/** Full wa.me URL with the confirmation text pre-filled. */
export function buildWhatsAppLink(b: ConfirmationInput): string {
  const phone = waDigits(b.clientPhone);
  const text = encodeURIComponent(buildConfirmationMessage(b));
  return `https://wa.me/${phone}?text=${text}`;
}
