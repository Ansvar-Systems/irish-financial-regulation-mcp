#!/usr/bin/env npx tsx
/**
 * Ingestion crawler for the Central Bank of Ireland (CBI) regulatory data.
 *
 * Crawls centralbank.ie to populate the MCP database with:
 *   1. Consumer Protection Code 2025 (Section 48 Regulations) — provisions table
 *   2. Corporate Governance Requirements — provisions table
 *   3. Fitness and Probity Standards — provisions table
 *   4. AML/CFT guidance — provisions table
 *   5. IT and Cybersecurity guidance — provisions table
 *   6. Prudential requirements — provisions table
 *   7. Individual Accountability Framework — provisions table
 *   8. Minimum Competency Code — provisions table
 *   9. Enforcement actions (fines, settlements, public statements) — enforcement_actions table
 *
 * Usage:
 *   npx tsx scripts/ingest-cbi.ts                 # full crawl
 *   npx tsx scripts/ingest-cbi.ts --resume        # skip already-ingested references
 *   npx tsx scripts/ingest-cbi.ts --dry-run       # fetch and parse but do not write DB
 *   npx tsx scripts/ingest-cbi.ts --force         # drop existing data and re-crawl
 *   npx tsx scripts/ingest-cbi.ts --resume --dry-run  # combinable flags
 */

import Database from "better-sqlite3";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DB_PATH = process.env["CBI_DB_PATH"] ?? "data/cbi.db";

const BASE_URL = "https://www.centralbank.ie";

/** Consumer Protection Code 2025 — Section 48 Regulations (Parts 1-6). */
const CPC_PARTS: Array<{ partNumber: number; slug: string; title: string }> = [
  {
    partNumber: 1,
    slug: "part-1-preliminary-and-general",
    title: "Preliminary and General",
  },
  {
    partNumber: 2,
    slug: "part-2-general-consumer-protection-requirements",
    title: "General Consumer Protection Requirements",
  },
  {
    partNumber: 3,
    slug: "part-3-consumer-banking--credit--arrears-and-certain-other-financial-arrangements",
    title: "Consumer Banking, Credit, Arrears and Certain Other Financial Arrangements",
  },
  {
    partNumber: 4,
    slug: "part-4-insurance",
    title: "Insurance",
  },
  {
    partNumber: 5,
    slug: "part-5-investments",
    title: "Investments",
  },
  {
    partNumber: 6,
    slug: "part-6-final-provisions-and-revocations",
    title: "Final Provisions and Revocations",
  },
];

const CPC_BASE_PATH =
  "/regulation/consumer-protection/consumer-protection-code/section-48-regulations";

/** Corporate Governance codes — PDF documents on the /codes page. */
const GOVERNANCE_PDFS: Array<{ id: string; name: string; url: string }> = [
  {
    id: "CGC_CreditInstitutions_2015",
    name: "Corporate Governance Requirements for Credit Institutions 2015",
    url: "/docs/default-source/regulation/how-we-regulate/codes/gns-4-1-7-corgovreq-credinstits2015.pdf",
  },
  {
    id: "CGC_InsuranceUndertakings_2015",
    name: "Corporate Governance Requirements for Insurance Undertakings 2015",
    url: "/docs/default-source/regulation/how-we-regulate/codes/gns-4-1-7-corgovreq-insundertakings2015.pdf",
  },
  {
    id: "CGC_Captives_2015",
    name: "Corporate Governance Requirements for Captive Insurance and Captive Reinsurance Undertakings 2015",
    url: "/docs/default-source/regulation/how-we-regulate/codes/gns-4-1-7-corgovreqforcaptives2015.pdf",
  },
  {
    id: "CGC_InvestmentFirms_2018",
    name: "Corporate Governance Requirements for Investment Firms and Market Operators 2018",
    url: "/docs/default-source/publications/consultation-papers/cp120/corporate-governance-requirements-for-investment-firms-and-market-operators-2018.pdf",
  },
];

/** Fitness and Probity Standards PDF. */
const FP_STANDARDS_URL =
  "/docs/default-source/regulation/how-we-regulate/fitness-probity/fitness-and-probity-standards-2025.pdf";

/** Fitness and Probity Guidance (HTML pages). */
const FP_GUIDANCE_URL =
  "/regulation/how-we-regulate/fitness-probity/fitness-probity-guidance/legal-framework";

/** Minimum Competency Code PDF. */
const MCC_URL =
  "/docs/default-source/regulation/how-we-regulate/authorisation/minimum-competency/minimum-competency-code-2017-and-minimum-competency-regulations-2017.pdf";

/** Individual Accountability Framework page. */
const IAF_URL =
  "/regulation/how-we-regulate/individual-accountability-framework";

/** Codes overview page — used to discover additional codes. */
const CODES_INDEX_URL = "/regulation/how-we-regulate/codes";

/** Enforcement actions listing page. */
const ENFORCEMENT_URL = "/news-media/legal-notices/enforcement-actions";

const RATE_LIMIT_MS = 1500;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 3000;
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const FLAG_RESUME = args.includes("--resume");
const FLAG_DRY_RUN = args.includes("--dry-run");
const FLAG_FORCE = args.includes("--force");

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

function warn(msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.warn(`[${ts}] WARN: ${msg}`);
}

function error(msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.error(`[${ts}] ERROR: ${msg}`);
}

// ---------------------------------------------------------------------------
// HTTP with retry + rate limiting
// ---------------------------------------------------------------------------

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      lastRequestTime = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "AnsvarBot/1.0 (compliance-research; contact: hello@ansvar.ai)",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-IE,en;q=0.9",
        },
      });
      clearTimeout(timeout);

      if (resp.status === 429) {
        const retryAfter = parseInt(
          resp.headers.get("Retry-After") ?? "10",
          10,
        );
        warn(`Rate limited (429) on ${url} — waiting ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} for ${url}`);
      }

      return resp;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        const backoff = RETRY_BACKOFF_MS * attempt;
        warn(
          `Attempt ${attempt}/${MAX_RETRIES} failed for ${url}: ${lastError.message} — retrying in ${backoff}ms`,
        );
        await sleep(backoff);
      }
    }
  }

  throw new Error(
    `Failed after ${MAX_RETRIES} attempts for ${url}: ${lastError?.message}`,
  );
}

async function fetchHtml(url: string): Promise<cheerio.CheerioAPI> {
  const fullUrl = url.startsWith("http") ? url : `${BASE_URL}${url}`;
  const resp = await rateLimitedFetch(fullUrl);
  const html = await resp.text();
  return cheerio.load(html);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Database bootstrap
// ---------------------------------------------------------------------------

function initDb(): Database.Database {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (FLAG_FORCE && existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    log(`Deleted existing database (--force)`);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

// ---------------------------------------------------------------------------
// Sourcebook definitions
// ---------------------------------------------------------------------------

interface SourcebookDef {
  id: string;
  name: string;
  description: string;
}

const SOURCEBOOKS: SourcebookDef[] = [
  {
    id: "Consumer_Protection",
    name: "Consumer Protection Code 2025",
    description:
      "Central Bank (Supervision and Enforcement) Act 2013 (Section 48) (Conduct of Business — Consumer Protection) Regulations 2025. 420 regulations across 6 parts covering consumer rights, suitability, disclosure, complaints, insurance, investments, and banking. Effective 24 March 2026.",
  },
  {
    id: "Fitness_Probity",
    name: "Fitness and Probity Standards 2025",
    description:
      "Standards under the Central Bank Reform Act 2010 for persons performing controlled functions (CF) and pre-approval controlled functions (PCF) at regulated financial service providers. Covers competence, honesty, integrity, and financial soundness requirements.",
  },
  {
    id: "Corporate_Governance",
    name: "Corporate Governance Requirements",
    description:
      "CBI corporate governance codes for credit institutions, insurance undertakings, captive insurers, and investment firms. Requirements for board composition, risk committees, internal audit, compliance statements, and senior management oversight.",
  },
  {
    id: "IT_Cybersecurity",
    name: "Cross-Industry Guidance on IT and Cybersecurity Risks",
    description:
      "CBI guidance on IT risk management frameworks, cybersecurity controls, operational resilience, third-party IT risk, and incident reporting obligations for regulated firms.",
  },
  {
    id: "AML_CFT",
    name: "Anti-Money Laundering and Counter-Terrorism Financing",
    description:
      "CBI guidance on AML/CFT obligations under the Criminal Justice (Money Laundering and Terrorist Financing) Act 2010 (as amended), covering customer due diligence, transaction monitoring, suspicious transaction reporting, and beneficial ownership requirements.",
  },
  {
    id: "Prudential",
    name: "Prudential Requirements",
    description:
      "Prudential rules for credit institutions and investment firms, covering capital adequacy, liquidity requirements, leverage ratio, and regulatory reporting under CRD/CRR frameworks as implemented in Ireland.",
  },
  {
    id: "IAF",
    name: "Individual Accountability Framework",
    description:
      "The Central Bank (Individual Accountability Framework) Act 2023 establishes the Senior Executive Accountability Regime (SEAR), Common Conduct Standards, Additional Conduct Standards, and enhancements to the Fitness and Probity regime.",
  },
  {
    id: "MCC",
    name: "Minimum Competency Code 2017",
    description:
      "Minimum professional standards for staff of regulated firms when dealing with consumers in relation to retail financial products. Covers qualifications, continuous professional development, and recognised qualification requirements.",
  },
  {
    id: "Related_Party_Lending",
    name: "Code of Practice on Related Party Lending",
    description:
      "CBI code governing lending by credit institutions to related parties, including directors, significant shareholders, and connected persons. Sets limits, disclosure obligations, and board approval requirements.",
  },
  {
    id: "Standards_Business",
    name: "Standards for Business Regulations 2025",
    description:
      "CBI regulations under Section 17A of the Central Bank Act 1942 setting out standards for regulated firms in the conduct of their business, complementing the Consumer Protection Code.",
  },
];

function ensureSourcebooks(db: Database.Database): void {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO sourcebooks (id, name, description) VALUES (?, ?, ?)",
  );
  for (const sb of SOURCEBOOKS) {
    stmt.run(sb.id, sb.name, sb.description);
  }
  log(`Ensured ${SOURCEBOOKS.length} sourcebooks`);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedProvision {
  sourcebookId: string;
  reference: string;
  title: string;
  text: string;
  type: string;
  status: string;
  effectiveDate: string | null;
  chapter: string | null;
  section: string | null;
}

interface ParsedEnforcement {
  firmName: string;
  referenceNumber: string | null;
  actionType: string;
  amount: number | null;
  date: string | null;
  summary: string;
  sourcebookReferences: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanBodyText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/We use cookies.*?accept/gi, "")
    .replace(/Skip to (main )?content/gi, "")
    .replace(/Cookie\s*Settings/gi, "")
    .replace(/Share.*?(Twitter|LinkedIn|BlueSky|Facebook|X\.com)/gi, "")
    .replace(/Back to top/gi, "")
    .trim();
}

function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;
  // Handle dd/mm/yyyy format used on CBI enforcement pages
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
  }
  // Handle "24 March 2025" or "March 24, 2025" formats
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function slugToTitle(slug: string): string {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Phase 1: Crawl Consumer Protection Code (Section 48 Regulations)
// ---------------------------------------------------------------------------

async function crawlConsumerProtectionCode(): Promise<ParsedProvision[]> {
  log("=== Phase 1: Consumer Protection Code 2025 (Section 48 Regulations) ===");
  const allProvisions: ParsedProvision[] = [];

  for (const part of CPC_PARTS) {
    const url = `${CPC_BASE_PATH}/${part.slug}`;
    log(`Fetching Part ${part.partNumber}: ${part.title}`);

    let $: cheerio.CheerioAPI;
    try {
      $ = await fetchHtml(url);
    } catch (err) {
      error(
        `Failed to fetch Part ${part.partNumber}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    const provisions = parseCpcPart($, part);
    log(
      `  Part ${part.partNumber}: extracted ${provisions.length} regulations`,
    );
    allProvisions.push(...provisions);
  }

  log(
    `Consumer Protection Code total: ${allProvisions.length} regulations extracted`,
  );
  return allProvisions;
}

/**
 * Parse a single CPC part page.
 *
 * The CBI website renders each regulation under heading elements (h2/h3/h4)
 * with the pattern "Regulation N" or "Regulation N: Title". The body text
 * follows in sibling paragraphs, lists, and divs until the next heading.
 *
 * Chapters appear as higher-level headings (h2) with patterns like
 * "Chapter 1: Knowing the consumer and suitability".
 */
function parseCpcPart(
  $: cheerio.CheerioAPI,
  part: { partNumber: number; title: string },
): ParsedProvision[] {
  const provisions: ParsedProvision[] = [];
  let currentChapter = `Part ${part.partNumber}`;

  // Strategy: find all headings and text content in the main content area.
  // The CBI site uses a structured content region.
  const contentSelectors = [
    ".sf-content-block",
    ".page-content",
    "#page-main-content",
    '[role="main"]',
    "main",
    "article",
  ];

  let $content: cheerio.Cheerio<AnyNode> | null = null;
  for (const sel of contentSelectors) {
    const el = $(sel);
    if (el.length > 0 && el.text().length > 200) {
      $content = el;
      break;
    }
  }

  if (!$content) {
    // Fall back to body
    $content = $("body");
  }

  // Walk through all headings and paragraphs in document order.
  // CBI uses h2 for chapters, h3/h4 for individual regulations, and
  // p/ol/ul for regulation text.
  const elements = $content.find("h2, h3, h4, h5, p, ol, ul, div.regulation, section");

  let currentRegNum: string | null = null;
  let currentRegTitle = "";
  let currentRegText: string[] = [];

  const flushRegulation = (): void => {
    if (currentRegNum && currentRegText.length > 0) {
      const text = currentRegText.join("\n").trim();
      if (text.length > 10) {
        provisions.push({
          sourcebookId: "Consumer_Protection",
          reference: `CPC Reg. ${currentRegNum}`,
          title: currentRegTitle || `Regulation ${currentRegNum}`,
          text,
          type: "Regulation",
          status: "in_force",
          effectiveDate: "2026-03-24",
          chapter: currentChapter,
          section: currentRegNum,
        });
      }
    }
    currentRegNum = null;
    currentRegTitle = "";
    currentRegText = [];
  };

  elements.each((_i, el) => {
    const tagName = $(el).prop("tagName")?.toLowerCase() ?? "";
    const rawText = $(el).text().trim();

    if (!rawText) return;

    // Detect chapter headings
    const chapterMatch = rawText.match(
      /^Chapter\s+(\d+)[:\s]*(.+)?$/i,
    );
    if (chapterMatch && (tagName === "h2" || tagName === "h3")) {
      flushRegulation();
      const chapNum = chapterMatch[1]!;
      const chapTitle = chapterMatch[2]?.trim() ?? "";
      currentChapter = chapTitle
        ? `Part ${part.partNumber}, Ch. ${chapNum}: ${chapTitle}`
        : `Part ${part.partNumber}, Ch. ${chapNum}`;
      return;
    }

    // Detect regulation headings: "Regulation 16", "16. Title text", "Regulation 16: Title"
    const regHeadingMatch = rawText.match(
      /^(?:Regulation\s+)?(\d{1,3})[\.\s:–—-]+\s*(.*)$/i,
    );
    const regExplicitMatch = rawText.match(
      /^Regulation\s+(\d{1,3})(?:[\s:–—-]+(.*))?$/i,
    );

    if (
      (tagName === "h2" || tagName === "h3" || tagName === "h4" || tagName === "h5") &&
      (regExplicitMatch ?? regHeadingMatch)
    ) {
      flushRegulation();
      const match = regExplicitMatch ?? regHeadingMatch;
      currentRegNum = match![1]!;
      currentRegTitle = (match![2] ?? "").trim();
      return;
    }

    // If we are inside a regulation, accumulate text
    if (currentRegNum) {
      // Skip navigation noise
      if (
        rawText.length < 5 ||
        rawText.match(/^(Previous|Next|Part \d|Back)$/i)
      ) {
        return;
      }
      currentRegText.push(rawText);
    }
  });

  // Flush the last regulation
  flushRegulation();

  return provisions;
}

// ---------------------------------------------------------------------------
// Phase 2: Crawl Corporate Governance codes (PDF title pages -> provisions)
// ---------------------------------------------------------------------------

async function crawlCorporateGovernanceCodes(): Promise<ParsedProvision[]> {
  log("=== Phase 2: Corporate Governance Codes ===");

  // The Corporate Governance codes are published as PDFs. We cannot parse
  // PDF content with cheerio alone. Instead, we crawl the /codes index page
  // to extract metadata and create provisions from the code overview page
  // descriptions. PDF deep parsing would require a separate PDF pipeline.
  const provisions: ParsedProvision[] = [];

  log(`Fetching codes index: ${CODES_INDEX_URL}`);
  let $: cheerio.CheerioAPI;
  try {
    $ = await fetchHtml(CODES_INDEX_URL);
  } catch (err) {
    error(
      `Failed to fetch codes index: ${err instanceof Error ? err.message : String(err)}`,
    );
    return provisions;
  }

  // Extract all PDF links and their context from the codes page
  const pdfLinks: Array<{
    title: string;
    href: string;
    context: string;
  }> = [];

  $("a[href$='.pdf']").each((_i, el) => {
    const href = $(el).attr("href");
    const title = $(el).text().trim();
    if (!href || !title) return;

    // Grab the surrounding context (parent paragraph or section)
    const parentText = $(el).parent().text().trim();
    const context =
      parentText.length > title.length ? parentText : title;

    pdfLinks.push({
      title,
      href: href.startsWith("http") ? href : `${BASE_URL}${href}`,
      context: cleanBodyText(context),
    });
  });

  log(`  Found ${pdfLinks.length} PDF documents on codes page`);

  // Create a provision for each major code document
  for (const pdf of pdfLinks) {
    // Skip FAQ docs and compliance statement guidelines — those are supplementary
    if (pdf.title.toLowerCase().includes("faq")) continue;
    if (pdf.title.toLowerCase().includes("guidelines on the compliance")) continue;

    const reference = deriveCodeReference(pdf.title);
    provisions.push({
      sourcebookId: "Corporate_Governance",
      reference,
      title: pdf.title,
      text: `${pdf.title}.\n\n${pdf.context}\n\nSource document: ${pdf.href}`,
      type: "Code",
      status: "in_force",
      effectiveDate: extractYearFromTitle(pdf.title),
      chapter: categoriseGovernanceCode(pdf.title),
      section: null,
    });
  }

  // Also add the Related Party Lending code
  const rplPdf = pdfLinks.find((p) =>
    p.title.toLowerCase().includes("related party lending"),
  );
  if (rplPdf) {
    provisions.push({
      sourcebookId: "Related_Party_Lending",
      reference: "RPL-2013",
      title: rplPdf.title,
      text: `${rplPdf.title}.\n\n${rplPdf.context}\n\nSource document: ${rplPdf.href}`,
      type: "Code",
      status: "in_force",
      effectiveDate: "2013-06-01",
      chapter: "Related Party Lending",
      section: null,
    });
  }

  // Add the Auditor Protocol
  const auditorPdf = pdfLinks.find((p) =>
    p.title.toLowerCase().includes("auditor protocol"),
  );
  if (auditorPdf) {
    provisions.push({
      sourcebookId: "Corporate_Governance",
      reference: "AUD-PROTOCOL",
      title: auditorPdf.title,
      text: `${auditorPdf.title}.\n\n${auditorPdf.context}\n\nSource document: ${auditorPdf.href}`,
      type: "Protocol",
      status: "in_force",
      effectiveDate: null,
      chapter: "Auditor Protocol",
      section: null,
    });
  }

  log(`  Corporate Governance: ${provisions.length} provisions extracted`);
  return provisions;
}

function deriveCodeReference(title: string): string {
  // "Corporate Governance Requirements for Credit Institutions 2015" -> "CGR-CI-2015"
  if (title.includes("Credit Institutions") && title.includes("2015"))
    return "CGR-CI-2015";
  if (title.includes("Insurance Undertakings") && title.includes("2015"))
    return "CGR-IU-2015";
  if (title.includes("Captive") && title.includes("2015"))
    return "CGR-CAP-2015";
  if (title.includes("Investment Firms") && title.includes("2018"))
    return "CGR-IF-2018";
  if (title.includes("Credit Institutions") && title.includes("2013"))
    return "CGC-2013";
  if (title.includes("Related Party")) return "RPL-2013";
  if (title.includes("Auditor")) return "AUD-PROTOCOL";
  // Generic fallback
  return `CGR-${title.replace(/[^A-Za-z0-9]/g, "").slice(0, 20)}`;
}

function extractYearFromTitle(title: string): string | null {
  const m = title.match(/\b(20\d{2})\b/);
  return m ? `${m[1]}-01-01` : null;
}

function categoriseGovernanceCode(title: string): string {
  if (title.includes("Credit Institutions")) return "Credit Institutions";
  if (title.includes("Insurance Undertakings")) return "Insurance Undertakings";
  if (title.includes("Captive")) return "Captive Insurance";
  if (title.includes("Investment Firms")) return "Investment Firms";
  return "General";
}

// ---------------------------------------------------------------------------
// Phase 3: Crawl Fitness and Probity Standards
// ---------------------------------------------------------------------------

async function crawlFitnessProbity(): Promise<ParsedProvision[]> {
  log("=== Phase 3: Fitness and Probity Standards ===");
  const provisions: ParsedProvision[] = [];

  // Crawl the guidance legal framework page for structured content
  log(`Fetching F&P guidance: ${FP_GUIDANCE_URL}`);
  let $: cheerio.CheerioAPI;
  try {
    $ = await fetchHtml(FP_GUIDANCE_URL);
  } catch (err) {
    error(
      `Failed to fetch F&P guidance: ${err instanceof Error ? err.message : String(err)}`,
    );
    return provisions;
  }

  // Extract sections from the guidance page
  const contentSelectors = [
    ".sf-content-block",
    ".page-content",
    "#page-main-content",
    '[role="main"]',
    "main",
    "article",
  ];

  let $content: cheerio.Cheerio<AnyNode> | null = null;
  for (const sel of contentSelectors) {
    const el = $(sel);
    if (el.length > 0 && el.text().length > 200) {
      $content = el;
      break;
    }
  }

  if ($content) {
    let sectionNum = 0;
    let currentHeading = "";
    let currentText: string[] = [];

    const flush = (): void => {
      if (currentHeading && currentText.length > 0) {
        sectionNum++;
        const text = currentText.join("\n").trim();
        if (text.length > 20) {
          provisions.push({
            sourcebookId: "Fitness_Probity",
            reference: `FP-G-${sectionNum}`,
            title: currentHeading,
            text,
            type: "Guidance",
            status: "in_force",
            effectiveDate: "2025-11-01",
            chapter: "Fitness and Probity Guidance",
            section: String(sectionNum),
          });
        }
      }
      currentText = [];
    };

    $content.find("h2, h3, h4, p, ol, ul").each((_i, el) => {
      const tag = $(el).prop("tagName")?.toLowerCase() ?? "";
      const text = $(el).text().trim();
      if (!text || text.length < 5) return;

      if (tag === "h2" || tag === "h3" || tag === "h4") {
        flush();
        currentHeading = text;
      } else if (currentHeading) {
        currentText.push(text);
      }
    });
    flush();
  }

  // Add a top-level provision for the F&P Standards document itself
  provisions.push({
    sourcebookId: "Fitness_Probity",
    reference: "FP-STD-2025",
    title: "Fitness and Probity Standards 2025",
    text: "The Fitness and Probity Standards 2025 issued by the Central Bank of Ireland under the Central Bank Reform Act 2010. A person performing a controlled function must be: (1) competent and capable, having the qualifications, experience and knowledge appropriate to the function; (2) honest, ethical and acting with integrity; and (3) financially sound. These standards apply to all regulated financial service providers and persons performing controlled functions (CFs) and pre-approval controlled functions (PCFs).",
    type: "Standard",
    status: "in_force",
    effectiveDate: "2025-11-01",
    chapter: "Standards",
    section: null,
  });

  log(`  Fitness and Probity: ${provisions.length} provisions extracted`);
  return provisions;
}

// ---------------------------------------------------------------------------
// Phase 4: Crawl Individual Accountability Framework
// ---------------------------------------------------------------------------

async function crawlIAF(): Promise<ParsedProvision[]> {
  log("=== Phase 4: Individual Accountability Framework ===");
  const provisions: ParsedProvision[] = [];

  log(`Fetching IAF page: ${IAF_URL}`);
  let $: cheerio.CheerioAPI;
  try {
    $ = await fetchHtml(IAF_URL);
  } catch (err) {
    error(
      `Failed to fetch IAF page: ${err instanceof Error ? err.message : String(err)}`,
    );
    return provisions;
  }

  // Extract sections from the IAF page
  const contentSelectors = [
    ".sf-content-block",
    ".page-content",
    "#page-main-content",
    '[role="main"]',
    "main",
    "article",
  ];

  let $content: cheerio.Cheerio<AnyNode> | null = null;
  for (const sel of contentSelectors) {
    const el = $(sel);
    if (el.length > 0 && el.text().length > 200) {
      $content = el;
      break;
    }
  }

  if ($content) {
    let sectionNum = 0;
    let currentHeading = "";
    let currentText: string[] = [];

    const flush = (): void => {
      if (currentHeading && currentText.length > 0) {
        sectionNum++;
        const text = currentText.join("\n").trim();
        if (text.length > 20) {
          provisions.push({
            sourcebookId: "IAF",
            reference: `IAF-${sectionNum}`,
            title: currentHeading,
            text,
            type: "Framework",
            status: "in_force",
            effectiveDate: "2023-12-29",
            chapter: "Individual Accountability Framework",
            section: String(sectionNum),
          });
        }
      }
      currentText = [];
    };

    $content.find("h2, h3, h4, p, ol, ul").each((_i, el) => {
      const tag = $(el).prop("tagName")?.toLowerCase() ?? "";
      const text = $(el).text().trim();
      if (!text || text.length < 5) return;

      if (tag === "h2" || tag === "h3" || tag === "h4") {
        flush();
        currentHeading = text;
      } else if (currentHeading) {
        currentText.push(text);
      }
    });
    flush();
  }

  // Also crawl linked sub-pages (SEAR, Conduct Standards, etc.)
  const subPages = [
    {
      path: "/regulation/how-we-regulate/individual-accountability-framework",
      topic: "IAF Overview",
    },
  ];

  // Discover linked sub-pages from IAF page
  if ($content) {
    $("a[href*='individual-accountability-framework']").each((_i, el) => {
      const href = $(el).attr("href");
      const linkText = $(el).text().trim();
      if (
        href &&
        linkText.length > 10 &&
        !href.endsWith(".pdf") &&
        href !== IAF_URL &&
        !subPages.some((p) => p.path === href)
      ) {
        subPages.push({
          path: href.startsWith("http")
            ? href.replace(BASE_URL, "")
            : href,
          topic: linkText,
        });
      }
    });
  }

  for (const sub of subPages.slice(1)) {
    // Skip the main page (already processed)
    log(`  Fetching IAF sub-page: ${sub.topic}`);
    try {
      const $sub = await fetchHtml(sub.path);
      let sectionNum = provisions.length;

      const $subContent =
        $sub(".sf-content-block").length > 0
          ? $sub(".sf-content-block")
          : $sub("main").length > 0
            ? $sub("main")
            : $sub("body");

      let currentHeading = sub.topic;
      let currentText: string[] = [];

      const flush = (): void => {
        if (currentHeading && currentText.length > 0) {
          sectionNum++;
          const text = currentText.join("\n").trim();
          if (text.length > 20) {
            provisions.push({
              sourcebookId: "IAF",
              reference: `IAF-${sectionNum}`,
              title: currentHeading,
              text,
              type: "Framework",
              status: "in_force",
              effectiveDate: "2023-12-29",
              chapter: sub.topic,
              section: String(sectionNum),
            });
          }
        }
        currentText = [];
      };

      $subContent.find("h2, h3, h4, p, ol, ul").each((_i, el) => {
        const tag = $sub(el).prop("tagName")?.toLowerCase() ?? "";
        const text = $sub(el).text().trim();
        if (!text || text.length < 5) return;

        if (tag === "h2" || tag === "h3" || tag === "h4") {
          flush();
          currentHeading = text;
        } else if (currentHeading) {
          currentText.push(text);
        }
      });
      flush();
    } catch (err) {
      warn(
        `Failed to fetch IAF sub-page ${sub.topic}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  log(`  Individual Accountability Framework: ${provisions.length} provisions extracted`);
  return provisions;
}

// ---------------------------------------------------------------------------
// Phase 5: Crawl Standards for Business Regulations
// ---------------------------------------------------------------------------

async function crawlStandardsForBusiness(): Promise<ParsedProvision[]> {
  log("=== Phase 5: Standards for Business Regulations 2025 ===");
  const provisions: ParsedProvision[] = [];

  const url =
    "/regulation/consumer-protection/consumer-protection-code/section-17a-regulations/standards-for-business";

  log(`Fetching Standards for Business: ${url}`);
  let $: cheerio.CheerioAPI;
  try {
    $ = await fetchHtml(url);
  } catch (err) {
    error(
      `Failed to fetch Standards for Business: ${err instanceof Error ? err.message : String(err)}`,
    );
    return provisions;
  }

  // Parse using the same heading-based extraction as CPC
  const contentSelectors = [
    ".sf-content-block",
    ".page-content",
    "#page-main-content",
    '[role="main"]',
    "main",
    "article",
  ];

  let $content: cheerio.Cheerio<AnyNode> | null = null;
  for (const sel of contentSelectors) {
    const el = $(sel);
    if (el.length > 0 && el.text().length > 200) {
      $content = el;
      break;
    }
  }

  if (!$content) {
    $content = $("body");
  }

  let currentRegNum: string | null = null;
  let currentRegTitle = "";
  let currentRegText: string[] = [];

  const flushRegulation = (): void => {
    if (currentRegNum && currentRegText.length > 0) {
      const text = currentRegText.join("\n").trim();
      if (text.length > 10) {
        provisions.push({
          sourcebookId: "Standards_Business",
          reference: `SFB Reg. ${currentRegNum}`,
          title: currentRegTitle || `Regulation ${currentRegNum}`,
          text,
          type: "Regulation",
          status: "in_force",
          effectiveDate: "2026-03-24",
          chapter: "Standards for Business",
          section: currentRegNum,
        });
      }
    }
    currentRegNum = null;
    currentRegTitle = "";
    currentRegText = [];
  };

  $content.find("h2, h3, h4, h5, p, ol, ul").each((_i, el) => {
    const tagName = $(el).prop("tagName")?.toLowerCase() ?? "";
    const rawText = $(el).text().trim();
    if (!rawText) return;

    const regMatch = rawText.match(
      /^(?:Regulation\s+)?(\d{1,3})[\.\s:–—-]+\s*(.*)$/i,
    );
    const regExplicit = rawText.match(
      /^Regulation\s+(\d{1,3})(?:[\s:–—-]+(.*))?$/i,
    );

    if (
      (tagName === "h2" || tagName === "h3" || tagName === "h4" || tagName === "h5") &&
      (regExplicit ?? regMatch)
    ) {
      flushRegulation();
      const match = regExplicit ?? regMatch;
      currentRegNum = match![1]!;
      currentRegTitle = (match![2] ?? "").trim();
      return;
    }

    if (currentRegNum) {
      if (rawText.length >= 5 && !rawText.match(/^(Previous|Next|Part \d|Back)$/i)) {
        currentRegText.push(rawText);
      }
    }
  });
  flushRegulation();

  log(`  Standards for Business: ${provisions.length} provisions extracted`);
  return provisions;
}

// ---------------------------------------------------------------------------
// Phase 6: Crawl Enforcement Actions
// ---------------------------------------------------------------------------

async function crawlEnforcementActions(): Promise<ParsedEnforcement[]> {
  log("=== Phase 6: Enforcement Actions ===");

  // The CBI enforcement actions page at /news-media/legal-notices/enforcement-actions
  // uses a Vue.js dynamic table. We fetch the page and extract what the
  // server-rendered HTML provides. The table lists enforcement action PDFs
  // with type, date, and document name columns.
  log(`Fetching enforcement actions: ${ENFORCEMENT_URL}`);

  let $: cheerio.CheerioAPI;
  try {
    $ = await fetchHtml(ENFORCEMENT_URL);
  } catch (err) {
    error(
      `Failed to fetch enforcement page: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  const actions: ParsedEnforcement[] = [];

  // Extract enforcement action entries from the page.
  // The page renders rows with links to PDF public statements/settlement notices.
  // Each entry has a date and document name containing the firm name.
  $("a[href*='settlement-agreements'], a[href*='enforcement-action'], a[href*='settlement-notice'], a[href*='public-statement']").each(
    (_i, el) => {
      const href = $(el).attr("href");
      const linkText = $(el).text().trim();
      if (!href || !linkText) return;
      if (!href.endsWith(".pdf")) return;

      // Extract firm name from the link text or PDF filename
      const firmName = extractFirmNameFromCbi(linkText, href);
      if (!firmName) return;

      // Try to find a date near this link
      const parentRow = $(el).closest("tr, li, div");
      let dateStr: string | null = null;
      if (parentRow.length > 0) {
        const rowText = parentRow.text();
        const dateMatch = rowText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (dateMatch) {
          dateStr = dateMatch[1]!;
        }
      }

      const actionType = classifyEnforcementType(linkText, href);

      actions.push({
        firmName,
        referenceNumber: null,
        actionType,
        amount: null,
        date: dateStr ? parseDate(dateStr) : null,
        summary: linkText,
        sourcebookReferences: null,
      });
    },
  );

  // Deduplicate by firm name + date
  const seen = new Set<string>();
  const uniqueActions = actions.filter((a) => {
    const key = `${a.firmName}|${a.date ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  log(`  Found ${uniqueActions.length} unique enforcement entries from listing page`);

  // Enrich enforcement actions by fetching individual PDF detail pages.
  // We fetch the news article pages (not PDFs) to get richer summaries.
  const enrichedActions: ParsedEnforcement[] = [];

  for (let i = 0; i < uniqueActions.length; i++) {
    const action = uniqueActions[i]!;
    log(
      `  Processing enforcement ${i + 1}/${uniqueActions.length}: ${action.firmName}`,
    );

    // Try to find a news article about this enforcement action
    try {
      const enriched = await enrichEnforcementFromNews(action, $);
      enrichedActions.push(enriched);
    } catch (err) {
      warn(
        `Failed to enrich ${action.firmName}: ${err instanceof Error ? err.message : String(err)}`,
      );
      enrichedActions.push(action);
    }
  }

  log(`  Enforcement actions total: ${enrichedActions.length} entries`);
  return enrichedActions;
}

function extractFirmNameFromCbi(
  linkText: string,
  href: string,
): string | null {
  // Try to extract firm name from PDF filename slug
  // Pattern: "enforcement-action-against-{firm-name}.pdf"
  // Pattern: "settlement-notice-{firm-name}.pdf"
  // Pattern: "public-statement-relating-to-enforcement-action-against-{firm-name}.pdf"
  const filenameMatch = href.match(
    /(?:enforcement-action-(?:against-|between-central-bank-of-ireland-and-)?|settlement-(?:notice-|agreement-.*?-and-)|public-statement-.*?(?:against-|and-))([^.]+?)(?:---.*)?\.pdf/i,
  );
  if (filenameMatch) {
    return slugToTitle(filenameMatch[1]!.replace(/--/g, "-"))
      .replace(/\s+/g, " ")
      .trim();
  }

  // Try from link text — look for common patterns
  // "Enforcement Action: Firm Name..."
  const colonMatch = linkText.match(
    /(?:Enforcement Action|Settlement Notice|Public Statement)[:\s]+(.+)/i,
  );
  if (colonMatch) {
    return colonMatch[1]!.slice(0, 100).trim();
  }

  // Use first 80 chars of link text
  if (linkText.length > 10) {
    return linkText.slice(0, 80).trim();
  }

  return null;
}

function classifyEnforcementType(text: string, href: string): string {
  const lower = (text + " " + href).toLowerCase();
  if (lower.includes("settlement")) return "settlement";
  if (lower.includes("fine") || lower.includes("fined")) return "fine";
  if (lower.includes("reprimand")) return "reprimand";
  if (lower.includes("prohibition") || lower.includes("disqualification"))
    return "prohibition";
  if (lower.includes("public warning")) return "public_warning";
  if (lower.includes("public statement")) return "public_statement";
  if (lower.includes("direction")) return "direction";
  if (lower.includes("revocation")) return "revocation";
  return "enforcement_action";
}

async function enrichEnforcementFromNews(
  action: ParsedEnforcement,
  $listing: cheerio.CheerioAPI,
): Promise<ParsedEnforcement> {
  // Search for a news article link about this firm on the enforcement page
  // or by constructing a search URL
  const firmSlug = action.firmName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  // Try to find a news article link on the listing page
  let newsUrl: string | null = null;
  $listing("a[href*='/news/article/']").each((_i, el) => {
    const href = $listing(el).attr("href");
    const text = $listing(el).text().trim().toLowerCase();
    if (
      href &&
      (href.includes(firmSlug) ||
        text.includes(action.firmName.toLowerCase().slice(0, 20)))
    ) {
      newsUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    }
  });

  if (!newsUrl) return action;

  try {
    const $ = await fetchHtml(newsUrl);

    const contentSelectors = [
      ".sf-content-block",
      ".page-content",
      "#page-main-content",
      "article",
      "main",
    ];

    let bodyText = "";
    for (const sel of contentSelectors) {
      const el = $(sel);
      if (el.length > 0) {
        bodyText = el.text().trim();
        break;
      }
    }

    bodyText = cleanBodyText(bodyText);

    if (bodyText.length > 50) {
      action.summary =
        bodyText.length > 3000 ? bodyText.slice(0, 3000) + "..." : bodyText;
    }

    // Extract fine amount from news article
    const amountMatch = bodyText.match(
      /(?:fined|fine of|penalty of|reprimanded and fined)\s*[€EUR\s]*([\d,]+(?:\.\d+)?)/i,
    );
    if (amountMatch) {
      action.amount =
        parseFloat(amountMatch[1]!.replace(/,/g, "")) || null;
    }

    // Extract sourcebook references
    const refs: string[] = [];
    const cpcMatches = bodyText.matchAll(
      /(?:Regulation|Consumer Protection Code|CPC)\s+(\d+)/gi,
    );
    for (const m of cpcMatches) {
      refs.push(`CPC Reg. ${m[1]}`);
    }
    if (refs.length > 0) {
      action.sourcebookReferences = [...new Set(refs)].join(", ");
    }

    // Extract reference number
    const refMatch = bodyText.match(
      /(?:reference|ref\.?|case)\s*(?:number|no\.?)?\s*[:\s]*([\w\-/]+)/i,
    );
    if (refMatch && refMatch[1]!.length > 3) {
      action.referenceNumber = refMatch[1]!;
    }
  } catch {
    // Enrichment is best-effort
  }

  return action;
}

// ---------------------------------------------------------------------------
// Database insertion
// ---------------------------------------------------------------------------

interface InsertStats {
  provisions: { inserted: number; skipped: number };
  enforcement: { inserted: number; skipped: number };
}

function insertProvisions(
  db: Database.Database,
  provisions: ParsedProvision[],
): { inserted: number; skipped: number } {
  const insert = db.prepare(`
    INSERT INTO provisions (sourcebook_id, reference, title, text, type, status, effective_date, chapter, section)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const checkExists = db.prepare(
    "SELECT 1 FROM provisions WHERE sourcebook_id = ? AND reference = ? LIMIT 1",
  );

  let inserted = 0;
  let skipped = 0;

  const insertAll = db.transaction(() => {
    for (const p of provisions) {
      if (FLAG_RESUME) {
        const exists = checkExists.get(p.sourcebookId, p.reference);
        if (exists) {
          skipped++;
          continue;
        }
      }

      insert.run(
        p.sourcebookId,
        p.reference,
        p.title,
        p.text,
        p.type,
        p.status,
        p.effectiveDate,
        p.chapter,
        p.section,
      );
      inserted++;
    }
  });

  insertAll();
  return { inserted, skipped };
}

function insertEnforcementActions(
  db: Database.Database,
  actions: ParsedEnforcement[],
): { inserted: number; skipped: number } {
  const insert = db.prepare(`
    INSERT INTO enforcement_actions (firm_name, reference_number, action_type, amount, date, summary, sourcebook_references)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const checkExists = db.prepare(
    "SELECT 1 FROM enforcement_actions WHERE firm_name = ? AND date = ? LIMIT 1",
  );

  let inserted = 0;
  let skipped = 0;

  const insertAll = db.transaction(() => {
    for (const e of actions) {
      if (FLAG_RESUME) {
        const exists = checkExists.get(e.firmName, e.date);
        if (exists) {
          skipped++;
          continue;
        }
      }

      insert.run(
        e.firmName,
        e.referenceNumber,
        e.actionType,
        e.amount,
        e.date,
        e.summary,
        e.sourcebookReferences,
      );
      inserted++;
    }
  });

  insertAll();
  return { inserted, skipped };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log("Central Bank of Ireland (CBI) ingestion crawler");
  log(`  Database:  ${DB_PATH}`);
  log(`  Flags:     ${[FLAG_RESUME && "--resume", FLAG_DRY_RUN && "--dry-run", FLAG_FORCE && "--force"].filter(Boolean).join(" ") || "(none)"}`);
  log("");

  const db = FLAG_DRY_RUN ? null : initDb();

  if (db) {
    ensureSourcebooks(db);
  }

  // -- Crawl all sources --
  const allProvisions: ParsedProvision[] = [];
  const allEnforcement: ParsedEnforcement[] = [];

  // Phase 1: Consumer Protection Code 2025
  try {
    const cpcProvisions = await crawlConsumerProtectionCode();
    allProvisions.push(...cpcProvisions);
  } catch (err) {
    error(`Phase 1 (CPC) failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Phase 2: Corporate Governance codes
  try {
    const govProvisions = await crawlCorporateGovernanceCodes();
    allProvisions.push(...govProvisions);
  } catch (err) {
    error(`Phase 2 (Corporate Governance) failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Phase 3: Fitness and Probity Standards
  try {
    const fpProvisions = await crawlFitnessProbity();
    allProvisions.push(...fpProvisions);
  } catch (err) {
    error(`Phase 3 (F&P) failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Phase 4: Individual Accountability Framework
  try {
    const iafProvisions = await crawlIAF();
    allProvisions.push(...iafProvisions);
  } catch (err) {
    error(`Phase 4 (IAF) failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Phase 5: Standards for Business
  try {
    const sfbProvisions = await crawlStandardsForBusiness();
    allProvisions.push(...sfbProvisions);
  } catch (err) {
    error(`Phase 5 (Standards for Business) failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Phase 6: Enforcement actions
  try {
    const enforcement = await crawlEnforcementActions();
    allEnforcement.push(...enforcement);
  } catch (err) {
    error(`Phase 6 (Enforcement) failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // -- Insert into database --
  log("");
  log("=== Insertion ===");

  if (FLAG_DRY_RUN) {
    log("DRY RUN — no database writes");
    log(`  Would insert ${allProvisions.length} provisions`);
    log(`  Would insert ${allEnforcement.length} enforcement actions`);

    // Print sample provisions by sourcebook
    const bySourcebook = new Map<string, number>();
    for (const p of allProvisions) {
      bySourcebook.set(
        p.sourcebookId,
        (bySourcebook.get(p.sourcebookId) ?? 0) + 1,
      );
    }
    log("  Provisions by sourcebook:");
    for (const [sb, count] of bySourcebook.entries()) {
      log(`    ${sb}: ${count}`);
    }
  } else if (db) {
    const provResult = insertProvisions(db, allProvisions);
    log(
      `  Provisions: ${provResult.inserted} inserted, ${provResult.skipped} skipped`,
    );

    const enfResult = insertEnforcementActions(db, allEnforcement);
    log(
      `  Enforcement: ${enfResult.inserted} inserted, ${enfResult.skipped} skipped`,
    );
  }

  // -- Summary --
  log("");
  log("=== Summary ===");

  if (db && !FLAG_DRY_RUN) {
    const provisionCount = (
      db.prepare("SELECT count(*) as cnt FROM provisions").get() as {
        cnt: number;
      }
    ).cnt;
    const sourcebookCount = (
      db.prepare("SELECT count(*) as cnt FROM sourcebooks").get() as {
        cnt: number;
      }
    ).cnt;
    const enforcementCount = (
      db.prepare("SELECT count(*) as cnt FROM enforcement_actions").get() as {
        cnt: number;
      }
    ).cnt;
    const ftsCount = (
      db.prepare("SELECT count(*) as cnt FROM provisions_fts").get() as {
        cnt: number;
      }
    ).cnt;

    log(`  Sourcebooks:          ${sourcebookCount}`);
    log(`  Provisions:           ${provisionCount}`);
    log(`  Enforcement actions:  ${enforcementCount}`);
    log(`  FTS entries:          ${ftsCount}`);
    log(`  Database:             ${DB_PATH}`);

    db.close();
  } else {
    log(`  Provisions crawled:    ${allProvisions.length}`);
    log(`  Enforcement crawled:   ${allEnforcement.length}`);
  }

  log("");
  log("Done.");
}

main().catch((err) => {
  error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
