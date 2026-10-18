import { describe, expect, it } from "vitest";
import { FormFields, parseAnswers, type FormField } from "@/lib/intake/fields";
import { normalizeEmail, normalizePhone, splitName } from "@/lib/intake/normalize";

describe("normalize", () => {
  it("lowercases emails and rejects invalid ones", () => {
    expect(normalizeEmail("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });

  it("formats US phone numbers as E.164 however they are typed", () => {
    for (const raw of ["(312) 555-0142", "312.555.0142", "+1 312 555 0142", "1-312-555-0142"]) {
      expect(normalizePhone(raw)).toBe("+13125550142");
    }
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("12345")).toBeNull();
  });

  it("splits full names on the last space", () => {
    expect(splitName("Jane Q. Smith")).toEqual({ firstName: "Jane Q.", lastName: "Smith" });
    expect(splitName("Cher")).toEqual({ firstName: "Cher", lastName: null });
  });
});

describe("custom fields", () => {
  const fields: FormField[] = [
    { key: "looking_for", label: "Looking for", type: "text", required: true },
    { key: "sex_pref", label: "Sex", type: "select", required: false, options: ["Male", "Female"] },
    { key: "colors", label: "Colors", type: "multi_select", required: false, options: ["Black", "Red"] },
    { key: "owned", label: "Owned before", type: "yes_no", required: false },
    { key: "start", label: "Start", type: "date", required: false },
  ];

  it("accepts valid answers and drops unknown keys", () => {
    const result = parseAnswers(fields, {
      looking_for: " A female pup ", sex_pref: "Female", colors: ["Black", "Black"], owned: "yes",
      start: "2027-03-01", extra: "ignored",
    });
    expect(result).toEqual({
      ok: true,
      answers: { looking_for: "A female pup", sex_pref: "Female", colors: ["Black"], owned: true, start: "2027-03-01" },
    });
  });

  it("reports missing required fields and bad values", () => {
    const result = parseAnswers(fields, { sex_pref: "Puppy", owned: "maybe", start: "next week" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["looking_for", "owned", "sex_pref", "start"]);
  });

  it("validates field definitions", () => {
    expect(FormFields.safeParse([{ key: "email", label: "Email", type: "text" }]).success).toBe(false);
    expect(FormFields.safeParse([{ key: "pick", label: "Pick", type: "select", options: ["Only one"] }]).success).toBe(false);
    expect(FormFields.safeParse(Array.from({ length: 16 }, (_, i) => ({ key: `f${i}`, label: "F", type: "text" }))).success).toBe(false);
  });
});
