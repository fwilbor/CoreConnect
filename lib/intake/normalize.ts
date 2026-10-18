import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { z } from "zod";

const emailSchema = z.email();

// Lowercased and trimmed; null when blank or not a valid address.
export function normalizeEmail(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  return emailSchema.safeParse(value).success ? value : null;
}

// E.164 (+15555550100); null when blank or not a valid number. Numbers without
// a country code are read as US/Canada.
export function normalizePhone(raw: string | null | undefined, defaultCountry: CountryCode = "US"): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const parsed = parsePhoneNumberFromString(value, defaultCountry);
  return parsed?.isValid() ? parsed.number : null;
}

// "Jane Q. Smith" -> { firstName: "Jane Q.", lastName: "Smith" }
export function splitName(full: string): { firstName: string; lastName: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: null };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1)! };
}
