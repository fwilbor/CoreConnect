import "server-only";
import { eq } from "drizzle-orm";
import { serviceDb } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";

// Details for the privacy and terms pages (Privacy and compliance: "Privacy
// policy and terms pages for both you and, via template, each workspace's
// public form"). The operator's legal details come from the environment so
// they can be filled in without a code change; until then the pages show a
// bracketed placeholder.

// Change this whenever the wording of a policy changes.
export const LEGAL_EFFECTIVE_DATE = "November 5, 2026";

export function operator() {
  return {
    product: "CoreConnect",
    company: process.env.LEGAL_COMPANY_NAME || "[Company legal name]",
    email: process.env.LEGAL_CONTACT_EMAIL || "[contact email]",
    address: process.env.LEGAL_MAILING_ADDRESS || "[mailing address]",
    state: process.env.LEGAL_GOVERNING_STATE || "[state]",
  };
}

export type LegalWorkspace = {
  name: string;
  slug: string;
  address: string | null;
  depositTerms: string | null;
  smsEnabled: boolean;
  logoUrl: string | null;
};

// Public details only; this backs pages anyone can open.
export async function loadLegalWorkspace(slug: string): Promise<LegalWorkspace | null> {
  const [row] = await serviceDb()
    .select({
      name: workspaces.name, slug: workspaces.slug, address: workspaces.physicalAddress,
      depositTerms: workspaces.depositTerms, smsEnabled: workspaces.smsEnabled, logoUrl: workspaces.logoUrl,
    })
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);
  return row ?? null;
}
