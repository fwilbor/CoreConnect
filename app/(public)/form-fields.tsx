import type { FormField } from "@/lib/intake/fields";
import { errorProps } from "@/lib/forms-client";

// Renders one custom question on the public inquiry and application forms.
export const fieldInputClass =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 " +
  "aria-[invalid=true]:border-red-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const input = fieldInputClass;

// The message under a field, with the id its input points to via aria-describedby.
export function FieldError({ id, error }: { id: string; error: string | undefined }) {
  return error ? <span id={`${id}-error`} className="mt-1 block text-sm text-red-600">{error}</span> : null;
}

export function CustomField({ field, error }: { field: FormField; error?: string }) {
  const label = `${field.label}${field.required ? " *" : ""}`;
  const a11y = errorProps(field.key, error);
  const message = <FieldError id={field.key} error={error} />;
  switch (field.type) {
    case "text":
      return (
        <label className="block text-sm font-medium">
          {label}
          <textarea name={field.key} required={field.required} rows={2} maxLength={2000} className={input} {...a11y} />
          {message}
        </label>
      );
    case "date":
      return (
        <label className="block text-sm font-medium">
          {label}
          <input type="date" name={field.key} required={field.required} className={input} {...a11y} />
          {message}
        </label>
      );
    case "select":
      return (
        <label className="block text-sm font-medium">
          {label}
          <select name={field.key} required={field.required} defaultValue="" className={input} {...a11y}>
            <option value="">Choose one</option>
            {field.options?.map((o) => <option key={o}>{o}</option>)}
          </select>
          {message}
        </label>
      );
    case "multi_select":
      return (
        <fieldset className="text-sm">
          <legend className="font-medium">{label}</legend>
          {field.options?.map((o) => (
            <label key={o} className="mt-1 flex items-center gap-2">
              <input type="checkbox" name={field.key} value={o} {...a11y} /> {o}
            </label>
          ))}
          {message}
        </fieldset>
      );
    case "yes_no":
      return (
        <fieldset className="text-sm">
          <legend className="font-medium">{label}</legend>
          <div className="mt-1 flex gap-4">
            <label className="flex items-center gap-2"><input type="radio" name={field.key} value="yes" {...a11y} /> Yes</label>
            <label className="flex items-center gap-2"><input type="radio" name={field.key} value="no" {...a11y} /> No</label>
          </div>
          {message}
        </fieldset>
      );
  }
}
