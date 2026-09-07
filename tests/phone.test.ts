import { describe, expect, it } from "vitest";

import { formatPhoneForDisplay, normalizePhone, waDigits } from "@/lib/phone";

/**
 * Getting a number wrong here is not a cosmetic bug: the agent opens a
 * WhatsApp chat with a stranger, mid-call, and nothing on screen says so.
 */

/** Narrows the result so a failing case reports its message, not "ok is false". */
function expectOk(input: string) {
  const result = normalizePhone(input);
  if (!result.ok) {
    throw new Error(`expected ${JSON.stringify(input)} to be valid: ${result.error}`);
  }
  return result;
}

function expectRejected(input: string) {
  const result = normalizePhone(input);
  if (result.ok) {
    throw new Error(
      `expected ${JSON.stringify(input)} to be rejected, got ${result.e164}`,
    );
  }
  return result;
}

describe("normalizePhone — the shapes clients actually say", () => {
  it.each([
    ["0612345678", "+212612345678"],
    ["06 12 34 56 78", "+212612345678"],
    ["06.12.34.56.78", "+212612345678"],
    ["06-12-34-56-78", "+212612345678"],
    ["0612-345678", "+212612345678"],
    ["(06) 12 34 56 78", "+212612345678"],
    ["  0612345678  ", "+212612345678"],
    ["612345678", "+212612345678"],
    ["212612345678", "+212612345678"],
    ["+212612345678", "+212612345678"],
    ["+212 612 345 678", "+212612345678"],
    ["+212-612-345-678", "+212612345678"],
    ["00212612345678", "+212612345678"],
    ["00 212 612 345 678", "+212612345678"],
  ])("normalises %s to %s", (input, expected) => {
    expect(expectOk(input).e164).toBe(expected);
  });

  it("accepts landline (05) and the other mobile prefix (07)", () => {
    expect(expectOk("0523456789").e164).toBe("+212523456789");
    expect(expectOk("0712345678").e164).toBe("+212712345678");
  });

  it("returns the wa.me digit form alongside E.164", () => {
    const result = expectOk("06 12 34 56 78");
    expect(result.e164).toBe("+212612345678");
    expect(result.wa).toBe("212612345678");
    expect(result.wa).not.toContain("+");
  });
});

describe("normalizePhone — country code plus trunk zero", () => {
  /**
   * The bug this suite was written for. "+212 0612345678" is what someone
   * reads off a saved contact that already includes the country code, and it
   * used to be trusted verbatim: the old code saw a leading + and returned
   * +2120612345678 — thirteen digits belonging to nobody. WhatsApp would
   * happily open a chat with an unknown recipient and no error was shown.
   */
  it.each([
    "+2120612345678",
    "+212 0612345678",
    "+212 06 12 34 56 78",
    "00212 0612345678",
    "2120612345678",
  ])("strips the redundant trunk zero from %s", (input) => {
    expect(expectOk(input).e164).toBe("+212612345678");
  });

  it("does not strip a digit from a correctly written number", () => {
    expect(expectOk("+212612345678").e164).toBe("+212612345678");
  });

  it("still rejects a 212 number with too many digits to be either shape", () => {
    expectRejected("+21206123456789");
  });
});

describe("normalizePhone — other countries", () => {
  it("accepts a full international number and leaves it alone", () => {
    expect(expectOk("+33612345678").e164).toBe("+33612345678");
    expect(expectOk("+34600123456").e164).toBe("+34600123456");
    expect(expectOk("+15551234567").e164).toBe("+15551234567");
  });

  it("accepts the 00 prefix form of a foreign number", () => {
    expect(expectOk("0033612345678").e164).toBe("+33612345678");
  });

  it("rejects an international number outside the E.164 length range", () => {
    expectRejected("+1234567");
    expectRejected("+1234567890123456");
  });
});

describe("normalizePhone — rejections", () => {
  it("rejects empty and whitespace-only input", () => {
    expect(expectRejected("").error).toContain("requis");
    expect(expectRejected("   ").error).toContain("requis");
  });

  it("rejects a Moroccan number of the wrong length", () => {
    expectRejected("061234567");
    expectRejected("06123456789");
    expectRejected("21261234567");
  });

  it("rejects a Moroccan prefix that is not assignable", () => {
    // 01/02/03/04/08/09 are not issued to subscribers.
    for (const prefix of ["01", "02", "03", "04", "08", "09"]) {
      const result = expectRejected(`${prefix}12345678`);
      expect(result.error).toContain("05, 06 ou 07");
    }
  });

  it("rejects text typed into the phone field", () => {
    expectRejected("pas de téléphone");
    expectRejected("le fixe du salon");
    expectRejected("N/A");
    expectRejected("06 12 34 56 78 (bureau)");
  });

  it("rejects a number with no digits at all", () => {
    expectRejected("+");
    expectRejected("()-. ");
  });

  it("rejects non-string input without throwing", () => {
    // The API validates before calling this, but a direct caller must not be
    // able to crash the request with a bad type.
    expect(normalizePhone(null as unknown as string).ok).toBe(false);
    expect(normalizePhone(undefined as unknown as string).ok).toBe(false);
    expect(normalizePhone(42 as unknown as string).ok).toBe(false);
  });

  it("never returns a number containing a non-digit after the +", () => {
    for (const input of ["06 12 34 56 78", "+212612345678", "0033612345678"]) {
      const result = expectOk(input);
      expect(result.e164).toMatch(/^\+\d+$/);
      expect(result.wa).toMatch(/^\d+$/);
    }
  });
});

describe("normalizePhone — idempotence", () => {
  it("normalising an already-normalised number changes nothing", () => {
    for (const input of ["0612345678", "+33612345678", "0523456789"]) {
      const once = expectOk(input).e164;
      const twice = expectOk(once).e164;
      expect(twice).toBe(once);
    }
  });
});

describe("formatPhoneForDisplay", () => {
  it("renders a stored Moroccan number the way staff read it", () => {
    expect(formatPhoneForDisplay("+212612345678")).toBe("06 12 34 56 78");
    expect(formatPhoneForDisplay("+212523456789")).toBe("05 23 45 67 89");
  });

  it("leaves a foreign number as stored rather than mangling its grouping", () => {
    expect(formatPhoneForDisplay("+33612345678")).toBe("+33612345678");
  });

  it("round-trips: display form parses back to the same E.164", () => {
    const e164 = "+212612345678";
    expect(expectOk(formatPhoneForDisplay(e164)).e164).toBe(e164);
  });

  it("does not throw on unexpected input", () => {
    expect(formatPhoneForDisplay("")).toBe("");
    expect(formatPhoneForDisplay(null as unknown as string)).toBe("");
  });
});

describe("waDigits", () => {
  it("strips the plus for the wa.me path segment", () => {
    expect(waDigits("+212612345678")).toBe("212612345678");
  });

  it("strips every separator", () => {
    expect(waDigits("+212 612-345.678")).toBe("212612345678");
  });

  it("returns an empty string rather than throwing on bad input", () => {
    expect(waDigits("")).toBe("");
    expect(waDigits(null as unknown as string)).toBe("");
  });
});
