import { afterEach, describe, expect, it } from "vitest";

import { normalizePhone } from "@/lib/phone";
import { salonWhatsAppNumber } from "@/lib/salon-contact";

afterEach(() => {
  delete process.env.SALON_WHATSAPP_NUMBER;
});

describe("salonWhatsAppNumber", () => {
  it("returns the configured salon number in all three forms", () => {
    const contact = salonWhatsAppNumber();
    expect(contact.e164).toBe("+212766092140");
    expect(contact.wa).toBe("212766092140");
    expect(contact.display).toBe("07 66 09 21 40");
  });

  it("ships a default that is a valid Moroccan mobile", () => {
    // If the committed default ever stops parsing, every screen that shows it
    // silently degrades to raw digits. Catch that here rather than in a salon.
    const parsed = normalizePhone(salonWhatsAppNumber().e164);
    expect(parsed.ok).toBe(true);
  });

  it("can be overridden per environment", () => {
    process.env.SALON_WHATSAPP_NUMBER = "0612345678";
    const contact = salonWhatsAppNumber();
    expect(contact.e164).toBe("+212612345678");
    expect(contact.display).toBe("06 12 34 56 78");
  });

  it("accepts an override written in any of the shapes staff type", () => {
    for (const written of [
      "+212 766 092 140",
      "07 66 09 21 40",
      "00212766092140",
      "+212 0766092140",
    ]) {
      process.env.SALON_WHATSAPP_NUMBER = written;
      expect(salonWhatsAppNumber().e164).toBe("+212766092140");
    }
  });

  it("falls back to the default rather than throwing on a bad override", () => {
    // A typo in an environment variable must not be able to take down the
    // owner screen.
    for (const bad of ["not a number", "0000", "+", "   "]) {
      process.env.SALON_WHATSAPP_NUMBER = bad;
      expect(() => salonWhatsAppNumber()).not.toThrow();
      expect(salonWhatsAppNumber().e164).toBe("+212766092140");
    }
  });

  it("never returns a wa form containing a plus or a space", () => {
    process.env.SALON_WHATSAPP_NUMBER = "+212 766 092 140";
    expect(salonWhatsAppNumber().wa).toMatch(/^\d+$/);
  });
});
