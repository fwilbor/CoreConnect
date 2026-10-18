// Template rendering. Templates are plain text with {{merge_fields}}; email
// gets an HTML version with a CAN-SPAM footer (business address and a one-click
// unsubscribe link).

export const MERGE_FIELDS = [
  "first_name", "last_name", "business_name", "application_link", "deposit_link", "deposit_amount",
  "waitlist_position", "litter_name",
] as const;
export type MergeValues = Partial<Record<(typeof MERGE_FIELDS)[number], string | null>>;

// Unknown fields render as empty so a typo never leaks "{{...}}" to a buyer.
export function renderTemplate(text: string, values: MergeValues): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => values[key as keyof MergeValues] ?? "");
}

export function unknownMergeFields(text: string): string[] {
  const found = [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(found.filter((f) => !(MERGE_FIELDS as readonly string[]).includes(f)))];
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const linkify = (escaped: string) =>
  escaped.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}">${url}</a>`);

export type EmailParts = { subject: string; text: string; html: string };

export function buildEmail(params: {
  subject: string;
  body: string;
  businessName: string;
  physicalAddress: string;
  unsubscribeUrl: string;
}): EmailParts {
  const footerText =
    `\n\n--\n${params.businessName}\n${params.physicalAddress}\n` +
    `Unsubscribe: ${params.unsubscribeUrl}`;
  const paragraphs = params.body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${linkify(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const html =
    `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;` +
    `font-size:15px;line-height:1.5;color:#171717;max-width:560px;margin:0 auto;padding:16px">` +
    paragraphs +
    `<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0 12px">` +
    `<p style="font-size:12px;color:#737373;margin:0">${escapeHtml(params.businessName)}<br>` +
    `${escapeHtml(params.physicalAddress).replace(/\n/g, "<br>")}<br>` +
    `<a href="${escapeHtml(params.unsubscribeUrl)}" style="color:#737373">Unsubscribe</a></p>` +
    `</body></html>`;
  return { subject: params.subject.replace(/[\r\n]+/g, " ").trim(), text: params.body + footerText, html };
}
