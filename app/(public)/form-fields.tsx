import type { FormField } from "@/lib/intake/fields";

// Renders one custom question on the public inquiry and application forms.
export const fieldInputClass =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 " +
  "dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const input = fieldInputClass;

export function CustomField({ field, error }: { field: FormField; error: React.ReactNode }) {
  const label = `${field.label}${field.required ? " *" : ""}`;
  switch (field.type) {
    case "text":
      return (
        <label className="block text-sm font-medium">
          {label}
          <textarea name={field.key} required={field.required} rows={2} maxLength={2000} className={input} />
          {error}
        </label>
      );
    case "date":
      return (
        <label className="block text-sm font-medium">
          {label}
          <input type="date" name={field.key} required={field.required} className={input} />
          {error}
        </label>
      );
    case "select":
      return (
        <label className="block text-sm font-medium">
          {label}
          <select name={field.key} required={field.required} defaultValue="" className={input}>
            <option value="">Choose one</option>
            {field.options?.map((o) => <option key={o}>{o}</option>)}
          </select>
          {error}
        </label>
      );
    case "multi_select":
      return (
        <fieldset className="text-sm">
          <legend className="font-medium">{label}</legend>
          {field.options?.map((o) => (
            <label key={o} className="mt-1 flex items-center gap-2">
              <input type="checkbox" name={field.key} value={o} /> {o}
            </label>
          ))}
          {error}
        </fieldset>
      );
    case "yes_no":
      return (
        <fieldset className="text-sm">
          <legend className="font-medium">{label}</legend>
          <div className="mt-1 flex gap-4">
            <label className="flex items-center gap-2"><input type="radio" name={field.key} value="yes" /> Yes</label>
            <label className="flex items-center gap-2"><input type="radio" name={field.key} value="no" /> No</label>
          </div>
          {error}
        </fieldset>
      );
  }
}
