// Parses an inquiry that a breeder forwarded to their CoreConnect address
// (FR-04): finds who originally wrote it, their phone if they gave one, and
// what they said. Handles Gmail ("---------- Forwarded message ---------"),
// Apple Mail ("Begin forwarded message:") and Outlook ("From: … Sent: …")
// formats, plain or ">"-quoted. Pure: no database, so it can be tested alone.

export type Address = { name: string | null; email: string | null };
export type ForwardedInquiry = { from: Address; subject: string | null; body: string; phone: string | null };

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// Senders that are a system, not a person: Facebook, marketplaces, form tools.
const NOT_A_PERSON = /^(no-?reply|do-?not-?reply|notifications?|notify|mailer-daemon|postmaster|bounce[s]?|alerts?|info|support)([+._-]|@)/i;
const MARKERS = [
  /^-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
  /^Begin forwarded message:\s*$/im,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^_{10,}\s*$/m,
];

export function parseAddress(raw: string | null | undefined): Address {
  if (!raw) return { name: null, email: null };
  const clean = raw.replace(/\*/g, "").replace(/mailto:/gi, "").trim();
  const email = clean.match(EMAIL_RE)?.[0]?.toLowerCase() ?? null;
  let name = clean.replace(/[<[(]?\s*[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\s*[>\])]?/gi, "").replace(/["']/g, "").trim();
  // "Lee, Ann" -> "Ann Lee"
  if (/^[^,]+,\s*[^,]+$/.test(name)) name = name.split(",").map((s) => s.trim()).reverse().join(" ");
  return { name: name || null, email };
}

export const isPersonAddress = (email: string | null) => Boolean(email && !NOT_A_PERSON.test(email));

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Drops the quoted history under a reply ("On Tue, Ann wrote:" and "> " lines).
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/.test(line.trim()) || /^-{2,}\s*(Original|Forwarded) Message/i.test(line.trim())) break;
    if (/^>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

const unquote = (text: string) =>
  text.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/^(>\s?)+/, "")).join("\n");

export function findPhone(text: string): string | null {
  // Ten-digit US style numbers, optionally with +1 and common separators.
  const m = text.match(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
  return m ? m[0] : null;
}

export function parseForwarded(input: { text: string | null; html: string | null; subject: string | null }): ForwardedInquiry | null {
  const raw = input.text?.trim() ? input.text : input.html ? htmlToText(input.html) : "";
  const text = unquote(raw);

  // Start at a forward marker if there is one, else at the first header block.
  let start = -1;
  for (const re of MARKERS) {
    const m = re.exec(text);
    if (m && (start === -1 || m.index < start)) start = m.index + m[0].length;
  }
  const rest = start >= 0 ? text.slice(start) : text;
  const lines = rest.split("\n");
  const fromAt = lines.findIndex((l) => /^\s*\**From:\**\s/i.test(l));
  if (fromAt === -1) return null;

  const headers: Record<string, string> = {};
  let i = fromAt;
  for (; i < lines.length && i < fromAt + 12; i++) {
    const m = lines[i].replace(/\*/g, "").match(/^\s*(From|Date|Sent|Subject|To|Cc|Reply-To):\s*(.*)$/i);
    if (m) headers[m[1].toLowerCase()] = m[2].trim();
    else if (!lines[i].trim()) {
      if (Object.keys(headers).length > 1) break;
    } else if (Object.keys(headers).length > 1) break;
  }
  // A real header block has From plus at least one of Date/Sent/Subject.
  if (!headers.from || !(headers.date || headers.sent || headers.subject)) return null;

  const body = stripQuoted(lines.slice(i).join("\n")).slice(0, 5000);
  let from = parseAddress(headers.from);
  const replyTo = parseAddress(headers["reply-to"]);
  if (!isPersonAddress(from.email) && isPersonAddress(replyTo.email)) from = { name: replyTo.name ?? from.name, email: replyTo.email };
  if (!isPersonAddress(from.email)) {
    // A notification email (marketplace, social site): look for the buyer's address in the message.
    const inBody = [...body.matchAll(new RegExp(EMAIL_RE.source, "gi"))].map((m) => m[0].toLowerCase()).find(isPersonAddress) ?? null;
    from = { name: isPersonAddress(from.email) ? from.name : null, email: inBody };
  }
  const subject = (headers.subject ?? input.subject ?? "").replace(/^\s*((fwd?|fw):\s*)+/i, "").trim() || null;
  return { from, subject, body, phone: findPhone(body) };
}
