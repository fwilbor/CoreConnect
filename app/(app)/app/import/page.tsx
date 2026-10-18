import { requireWorkspace } from "@/lib/workspace";
import { CsvImport } from "./csv-import";

export const metadata = { title: "Import leads · CoreConnect" };

export default async function ImportPage() {
  await requireWorkspace();
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-2xl font-semibold">Import leads</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Upload a CSV from a spreadsheet. You&apos;ll match its columns and see a preview before anything is saved.
        Existing contacts are matched by email or phone and updated, not duplicated. Imported leads don&apos;t get
        auto-replies or follow-up sequences.
      </p>
      <CsvImport />
    </main>
  );
}
