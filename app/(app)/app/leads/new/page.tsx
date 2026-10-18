import { QuickAddForm } from "./quick-add-form";

export const metadata = { title: "Quick add · CoreConnect" };

export default function QuickAddPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <h1 className="text-2xl font-semibold">Quick add</h1>
      <p className="mt-1 text-sm text-neutral-500">Log a call, text, DM or show contact.</p>
      <QuickAddForm />
    </main>
  );
}
