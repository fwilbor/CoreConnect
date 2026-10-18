import { z } from "zod";

// Custom form fields (FR-03). Name, email, phone, source and SMS consent are
// fixed fields every inquiry form renders; forms.fields holds only these.
export const FIELD_TYPES = ["text", "select", "multi_select", "yes_no", "date"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const MAX_CUSTOM_FIELDS = 15;

const RESERVED_KEYS = new Set(["first_name", "last_name", "name", "email", "phone", "source", "sms_consent"]);

export const FormField = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "lowercase letters, numbers and underscores"),
    label: z.string().trim().min(1).max(200),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  })
  .refine((f) => !RESERVED_KEYS.has(f.key), { message: "That key is reserved", path: ["key"] })
  .refine((f) => (f.type === "select" || f.type === "multi_select" ? (f.options?.length ?? 0) >= 2 : true), {
    message: "Choice fields need at least two options",
    path: ["options"],
  });
export type FormField = z.infer<typeof FormField>;

export const FormFields = z
  .array(FormField)
  .max(MAX_CUSTOM_FIELDS, `Up to ${MAX_CUSTOM_FIELDS} custom fields`)
  .refine((fields) => new Set(fields.map((f) => f.key)).size === fields.length, "Field keys must be unique");

export type Answers = Record<string, string | string[] | boolean>;

// Validates raw answers (form strings or JSON values) against the field
// definitions. Unknown keys are dropped.
export function parseAnswers(
  fields: FormField[],
  raw: Record<string, unknown>,
): { ok: true; answers: Answers } | { ok: false; errors: Record<string, string> } {
  const answers: Answers = {};
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const value = raw[field.key];
    const blank =
      value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
    if (blank) {
      if (field.required) errors[field.key] = "Required";
      continue;
    }
    switch (field.type) {
      case "text": {
        const text = String(value).trim();
        if (text.length > 2000) errors[field.key] = "Too long";
        else if (text) answers[field.key] = text;
        else if (field.required) errors[field.key] = "Required";
        break;
      }
      case "select": {
        const choice = String(value);
        if (!field.options?.includes(choice)) errors[field.key] = "Pick one of the options";
        else answers[field.key] = choice;
        break;
      }
      case "multi_select": {
        const choices = (Array.isArray(value) ? value : [value]).map(String);
        if (choices.some((c) => !field.options?.includes(c))) errors[field.key] = "Pick from the options";
        else answers[field.key] = [...new Set(choices)];
        break;
      }
      case "yes_no": {
        const v = typeof value === "boolean" ? value : String(value).toLowerCase();
        if (v === true || v === "yes" || v === "true") answers[field.key] = true;
        else if (v === false || v === "no" || v === "false") answers[field.key] = false;
        else errors[field.key] = "Answer yes or no";
        break;
      }
      case "date": {
        const date = String(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
          errors[field.key] = "Enter a date";
        } else answers[field.key] = date;
        break;
      }
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, answers };
}
