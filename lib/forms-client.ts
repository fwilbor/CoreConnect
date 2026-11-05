import { useEffect, useTransition, type FormEvent, type RefObject } from "react";

// React 19 resets every uncontrolled field after a <form action={...}> runs,
// even when the action returns a validation error, so people lose what they
// typed. Submitting through onSubmit and dispatching the useActionState action
// ourselves skips that reset while keeping its pending and result state.
export function useSubmitKeepingValues(dispatch: (formData: FormData) => void) {
  const [, startTransition] = useTransition();
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  };
}

// After a failed submit, moves focus to the first field marked aria-invalid, so
// keyboard and screen-reader users land on the problem.
export function useFocusFirstError(formRef: RefObject<HTMLElement | null>, errors: unknown) {
  useEffect(() => {
    if (!errors || (typeof errors === "object" && Object.keys(errors).length === 0)) return;
    const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    first?.focus();
  }, [formRef, errors]);
}

// Props that tie an input to its error message for assistive technology.
export const errorProps = (id: string, error: string | undefined) =>
  error ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
