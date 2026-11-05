"use client";

import { useActionState, useRef } from "react";
import { useFocusFirstError, useSubmitKeepingValues } from "@/lib/forms-client";
import type { FormField } from "@/lib/intake/fields";
import { CustomField } from "../../../form-fields";
import { submitApplicationAction, type ApplyState } from "./actions";

export function ApplicationForm(props: { slug: string; token: string; fields: FormField[]; brandColor: string | null }) {
  const action = submitApplicationAction.bind(null, props.slug, props.token);
  const [state, formAction, pending] = useActionState<ApplyState, FormData>(action, { status: "idle" });
  const errors: Record<string, string> = state.status === "error" ? (state.errors ?? {}) : {};
  const formRef = useRef<HTMLFormElement>(null);
  // Applications are long: a validation error must never clear the answers.
  const onSubmit = useSubmitKeepingValues(formAction);
  useFocusFirstError(formRef, state.status === "error" ? state.errors : null);

  if (state.status === "success") {
    return (
      <div role="status" className="py-6">
        <p className="text-lg font-medium">Application received</p>
        <p className="mt-2">{state.message ?? "Thank you! We'll review it and be in touch."}</p>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4" noValidate>
      {props.fields.map((f) => <CustomField key={f.key} field={f} error={errors[f.key]} />)}
      {state.status === "error" && <p className="text-sm text-red-600" role="alert">{state.message}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-md px-4 py-3 font-medium text-white disabled:opacity-60"
        style={{ backgroundColor: props.brandColor ?? "#171717" }}>
        {pending ? "Sending…" : "Submit application"}
      </button>
    </form>
  );
}
