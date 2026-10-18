import { NextResponse, type NextRequest } from "next/server";
import { submitPublicInquiry } from "@/lib/intake/public";
import { clientIp } from "@/lib/intake/spam";
import { kickQueue } from "@/lib/messaging/kick";

// POST /api/public/:slug/inquiries: the inquiry form's JSON/form endpoint for
// clients other than the hosted page. Auth: Turnstile token + per-IP rate limit.
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const type = request.headers.get("content-type") ?? "";

  let raw: Record<string, unknown>;
  try {
    if (type.includes("application/json")) {
      raw = (await request.json()) as Record<string, unknown>;
    } else {
      const form = await request.formData();
      raw = {};
      for (const key of new Set(form.keys())) {
        const values = form.getAll(key).filter((v): v is string => typeof v === "string");
        raw[key] = values.length > 1 ? values : values[0];
      }
    }
  } catch {
    return NextResponse.json({ error: { code: "bad_request", message: "Body must be JSON or form data" } }, { status: 400 });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json({ error: { code: "bad_request", message: "Body must be an object" } }, { status: 400 });
  }

  const token = (raw["cf-turnstile-response"] ?? raw.turnstile_token ?? null) as string | null;
  const result = await submitPublicInquiry({
    slug,
    channel: "form",
    raw,
    turnstileToken: typeof token === "string" ? token : null,
    ip: clientIp(request.headers),
    userAgent: request.headers.get("user-agent"),
  });

  if (result.ok) kickQueue();
  if (result.ok) return NextResponse.json({ ok: true, message: result.successMessage }, { status: 201 });
  return NextResponse.json(
    { error: { code: result.reason, message: result.reason.replace("_", " "), fields: result.errors } },
    { status: result.status },
  );
}
