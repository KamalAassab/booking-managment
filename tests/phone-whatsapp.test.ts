import { describe, expect, it } from "vitest";

import { formatPhoneForDisplay, normalizePhone, waDigits } from "@/lib/phone";
import { buildConfirmationMessage, buildWhatsAppLink } from "@/lib/whatsapp";

/**
 * The wa.me link is the whole WhatsApp confirmation feature (brief §3). If the
 * number is normalised wrong, the agent opens a chat with the wrong person or
 * with nobody, mid-call, with no obvious error.
 */

describe("normalizePhone", () => {
  it("accepts the way a Moroccan client says their number", () => {
    for (const input of [
      "0612345678",
      "06 12 34 56 78",
      "06-12-34-56-78",
      "06.12.34.56.78",
      " 0612345678 ",
    ]) {
      const result = normalizePhone(input);
      expect(result.ok, input).toBe(true);
      if (result.ok) {
        expect(result.e164).toBe("+212612345678");
        expect(result.wa).toBe("212612345678");
      }
    }
  });

  it("accepts international forms of the same number", () => {
    for (const input of ["+212612345678", "212612345678", "00212612345678", "+212 612 345 678"]) {
      const result = normalizePhone(input);
      expect(result.ok, input).toBe(true);
      if (result.ok) expect(result.e164).toBe("+212612345678");
    }
  });

  it("accepts a national number with the leading zero dropped", () => {
    const result = normalizePhone("612345678");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.e164).toBe("+212612345678");
  });

  it("accepts landline and 07 mobile prefixes", () => {
    expect(normalizePhone("0523456789").ok).toBe(true);
    expect(normalizePhone("0712345678").ok).toBe(true);
  });

  it("rejects numbers that are the wrong length", () => {
    expect(normalizePhone("06123456").ok).toBe(false);
    expect(normalizePhone("061234567890").ok).toBe(false);
    expect(normalizePhone("").ok).toBe(false);
    expect(normalizePhone("   ").ok).toBe(false);
  });

  it("rejects an invalid Moroccan prefix", () => {
    expect(normalizePhone("0112345678").ok).toBe(false);
    expect(normalizePhone("0812345678").ok).toBe(false);
  });

  it("passes a foreign number through when written in full international form", () => {
    const result = normalizePhone("+33612345678");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.e164).toBe("+33612345678");
  });
});

describe("formatPhoneForDisplay", () => {
  it("renders a Moroccan number the way staff read it aloud", () => {
    expect(formatPhoneForDisplay("+212612345678")).toBe("06 12 34 56 78");
  });

  it("leaves foreign numbers alone", () => {
    expect(formatPhoneForDisplay("+33612345678")).toBe("+33612345678");
  });
});

describe("wa.me link", () => {
  const input = {
    clientName: "Salma Bennani",
    clientPhone: "+212612345678",
    salonName: "L'Atelier VIP",
    salonSlug: "vip",
    bookingDate: "2026-09-08",
    startMin: 870,
    durationMin: 90,
    service: "Coloration",
    price: 350,
    notes: "Client fidèle",
  };

  it("addresses the digits-only number, with no plus sign", () => {
    const url = buildWhatsAppLink(input);
    expect(url.startsWith("https://api.whatsapp.com/send?phone=212612345678&text=")).toBe(true);
    expect(url).not.toContain("+212");
    expect(waDigits("+212612345678")).toBe("212612345678");
  });

  it("puts all booking details, native emojis, price and note in the pre-filled message", () => {
    const message = buildConfirmationMessage(input);
    expect(message).toContain("Salma");
    expect(message).toContain("👑 *L'Atelier VIP*");
    expect(message).toContain("14:30");
    expect(message).toContain("(90 min)");
    expect(message).toContain("Coloration");
    expect(message).toContain("350 MAD");
    expect(message).toContain("Client fidèle");
    expect(message).not.toContain("\uFFFD");
  });

  it("greets by first name with friendly wave emoji", () => {
    expect(buildConfirmationMessage(input).startsWith("Bonjour Salma 👋,")).toBe(true);
  });

  it("uses matching emojis for each salon identity", () => {
    const vipMsg = buildConfirmationMessage({
      ...input,
      salonName: "L'Atelier VIP",
      salonSlug: "vip",
    });
    expect(vipMsg).toContain("👑 *L'Atelier VIP*");

    const goldMsg = buildConfirmationMessage({
      ...input,
      salonName: "L'Atelier Gold",
      salonSlug: "gold",
    });
    expect(goldMsg).toContain("✨ *L'Atelier Gold*");

    const silverMsg = buildConfirmationMessage({
      ...input,
      salonName: "L'Atelier Silver",
      salonSlug: "silver",
    });
    expect(silverMsg).toContain("💈 *L'Atelier Silver*");
  });

  it("resolves catalog price when price is not provided", () => {
    const msg = buildConfirmationMessage({
      clientName: "Mehdi",
      clientPhone: "0661000000",
      salonName: "L'Atelier Silver",
      salonSlug: "barber",
      bookingDate: "2026-09-10",
      startMin: 600,
      service: "Coupe Simple",
    });
    expect(msg).toContain("40 MAD");
    expect(msg).toContain("💈 *L'Atelier Silver*");
  });

  it("url-encodes the message cleanly so emojis, newlines and accents survive", () => {
    const url = buildWhatsAppLink(input);
    const parsedUrl = new URL(url);
    const text = parsedUrl.searchParams.get("text");
    expect(text).toBe(buildConfirmationMessage(input));
    expect(url).not.toContain("\n");
    expect(url).not.toContain("\uFFFD");
  });
});
