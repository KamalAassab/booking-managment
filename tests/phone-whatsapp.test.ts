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
    bookingDate: "2026-09-08",
    startMin: 870,
    service: "Coloration",
  };

  it("addresses the digits-only number, with no plus sign", () => {
    const url = buildWhatsAppLink(input);
    expect(url.startsWith("https://wa.me/212612345678?text=")).toBe(true);
    expect(url).not.toContain("+212");
    expect(waDigits("+212612345678")).toBe("212612345678");
  });

  it("puts the booking details in the pre-filled message", () => {
    const message = buildConfirmationMessage(input);
    expect(message).toContain("Salma");
    expect(message).toContain("L'Atelier VIP");
    expect(message).toContain("14:30");
    expect(message).toContain("Coloration");
  });

  it("greets by first name only", () => {
    expect(buildConfirmationMessage(input).startsWith("Bonjour Salma,")).toBe(
      true,
    );
  });

  it("url-encodes the message so newlines and accents survive", () => {
    const url = buildWhatsAppLink(input);
    const text = decodeURIComponent(url.split("?text=")[1]);
    expect(text).toBe(buildConfirmationMessage(input));
    expect(url).not.toContain("\n");
  });
});
