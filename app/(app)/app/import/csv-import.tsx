"use client";

import Papa from "papaparse";
import { useState, useTransition } from "react";
import type { ImportRow, ImportSummary } from "@/lib/intake/import";
import { importLeads } from "./actions";

type Target = keyof ImportRow | "ignore";

const TARGETS: { value: Target; label: string }[] = [
  { value: "ignore", label: "Don't import" },
  { value: "fullName", label: "Full name" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "tags", label: "Tags (comma or ; separated)" },
  { value: "notes", label: "Notes" },
];

// Best guess from the header text; the user can change every column.
function guess(header: string): Target {
  const h = header.toLowerCase().replace(/[^a-z]/g, "");
  if (/^(first|firstname|fname|given)/.test(h)) return "firstName";
  if (/^(last|lastname|lname|surname|family)/.test(h)) return "lastName";
  if (/^(name|fullname|contact|buyer|client|customer)$/.test(h)) return "fullName";
  if (h.includes("email")) return "email";
  if (/(phone|mobile|cell|tel)/.test(h)) return "phone";
  if (/(tag|label|group)/.test(h)) return "tags";
  if (/(note|comment|memo)/.test(h)) return "notes";
  return "ignore";
}

const MAX_ROWS = 2000;

export function CsvImport() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, Target>>({});
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onFile = (file: File | undefined) => {
    setSummary(null);
    setError(null);
    if (!file) return;
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (result) => {
        const fields = (result.meta.fields ?? []).filter(Boolean);
        if (!fields.length) return setError("That file has no header row.");
        if (result.data.length > MAX_ROWS) return setError(`Import up to ${MAX_ROWS.toLocaleString()} rows at a time; this file has ${result.data.length.toLocaleString()}.`);
        setHeaders(fields);
        setData(result.data);
        setMapping(Object.fromEntries(fields.map((f) => [f, guess(f)])));
      },
      error: (err) => setError(`Couldn't read that file: ${err.message}`),
    });
  };

  const mapped = (): ImportRow[] =>
    data.map((record) => {
      const row: ImportRow = {};
      for (const [header, target] of Object.entries(mapping)) {
        if (target === "ignore") continue;
        const value = (record[header] ?? "").trim();
        if (!value) continue;
        row[target] = row[target] ? `${row[target]}; ${value}` : value;
      }
      return row;
    });

  const targets = new Set(Object.values(mapping));
  const hasName = targets.has("fullName") || targets.has("firstName");
  const hasContact = targets.has("email") || targets.has("phone");

  const run = (dryRun: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await importLeads(JSON.stringify(mapped()), dryRun);
      if (result.error) setError(result.error);
      else setSummary(result.summary ?? null);
    });

  return (
    <div className="mt-6 space-y-6">
      <label className="block text-sm font-medium">
        CSV file
        <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="mt-1 block text-sm" />
      </label>

      {headers.length > 0 && (
        <section>
          <h2 className="font-medium">Match columns · {fileName} · {data.length.toLocaleString()} rows</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-neutral-500"><tr><th className="py-1 pr-3">Column</th><th className="pr-3">Example</th><th>Import as</th></tr></thead>
              <tbody>
                {headers.map((h) => (
                  <tr key={h} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="py-1.5 pr-3 font-medium">{h}</td>
                    <td className="max-w-[16rem] truncate pr-3 text-neutral-500">{data.find((r) => r[h]?.trim())?.[h] ?? ""}</td>
                    <td>
                      <select
                        value={mapping[h]}
                        onChange={(e) => { setMapping({ ...mapping, [h]: e.target.value as Target }); setSummary(null); }}
                        className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
                      >
                        {TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(!hasName || !hasContact) && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">Match a name column and at least one of email or phone.</p>
          )}
          <button
            onClick={() => run(true)}
            disabled={pending || !hasName || !hasContact}
            className="mt-3 rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-neutral-700"
          >
            {pending && !summary ? "Checking…" : "Preview import"}
          </button>
        </section>
      )}

      {summary && (
        <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="font-medium">{summary.committed ? "Import complete" : "Preview: nothing has been saved yet"}</h2>
          <ul className="mt-2 space-y-1 text-sm">
            <li>{summary.created} new contacts</li>
            <li>{summary.merged} matched existing contacts and will be updated</li>
            {summary.conflicts > 0 && <li>{summary.conflicts} matched two different contacts and will be flagged for review</li>}
            <li>{summary.invalid.length} rows skipped</li>
          </ul>
          {summary.invalid.length > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer">Skipped rows</summary>
              <ul className="mt-1 max-h-48 overflow-y-auto text-neutral-500">
                {summary.invalid.map((r) => <li key={r.row}>Row {r.row}: {r.reason}</li>)}
              </ul>
            </details>
          )}
          {!summary.committed && summary.created + summary.merged > 0 && (
            <button
              onClick={() => run(false)}
              disabled={pending}
              className="mt-4 rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
            >
              {pending ? "Importing…" : `Import ${summary.created + summary.merged} rows`}
            </button>
          )}
          {summary.committed && <a href="/app/leads" className="mt-3 inline-block text-sm underline">View leads</a>}
        </section>
      )}

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}
