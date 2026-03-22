/**
 * Seed the CBI regulatory database with sample provisions for testing.
 *
 * Inserts representative provisions from the main CBI codes and guidance
 * documents so MCP tools can be tested without running the full ingestion.
 *
 * Usage:
 *   npx tsx scripts/seed-sample.ts
 *   npx tsx scripts/seed-sample.ts --force   # drop and recreate
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

const DB_PATH = process.env["CBI_DB_PATH"] ?? "data/cbi.db";
const force = process.argv.includes("--force");

// -- Bootstrap database --

const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

if (force && existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
  console.log(`Deleted existing database at ${DB_PATH}`);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA_SQL);

console.log(`Database initialised at ${DB_PATH}`);

// -- Sourcebooks --

interface SourcebookRow {
  id: string;
  name: string;
  description: string;
}

const sourcebooks: SourcebookRow[] = [
  {
    id: "Consumer_Protection",
    name: "Consumer Protection Code",
    description:
      "The CBI Consumer Protection Code (CPC) — rules governing how regulated entities must treat consumers, covering disclosure, suitability, complaints handling, and switching.",
  },
  {
    id: "Fitness_Probity",
    name: "Fitness and Probity Standards",
    description:
      "Standards under the Central Bank Reform Act 2010 for persons in controlled functions (CF) and pre-approval controlled functions (PCF) at regulated financial service providers.",
  },
  {
    id: "Corporate_Governance",
    name: "Corporate Governance Code for Credit Institutions",
    description:
      "Requirements for the board, senior management, and governance structures of credit institutions regulated by the CBI.",
  },
  {
    id: "IT_Cybersecurity",
    name: "Cross-Industry Guidance on IT and Cybersecurity Risks",
    description:
      "CBI guidance on IT risk management frameworks, cybersecurity controls, operational resilience, and incident reporting obligations for regulated firms.",
  },
  {
    id: "AML_CFT",
    name: "Anti-Money Laundering and Counter-Terrorism Financing",
    description:
      "CBI guidance on AML/CFT obligations under the Criminal Justice (Money Laundering and Terrorist Financing) Act 2010 (as amended), covering CDD, transaction monitoring, and suspicious transaction reporting.",
  },
  {
    id: "Prudential",
    name: "Prudential Requirements",
    description:
      "Prudential rules for credit institutions and investment firms, covering capital adequacy, liquidity requirements, and regulatory reporting under CRD/CRR frameworks as implemented in Ireland.",
  },
];

const insertSourcebook = db.prepare(
  "INSERT OR IGNORE INTO sourcebooks (id, name, description) VALUES (?, ?, ?)",
);

for (const sb of sourcebooks) {
  insertSourcebook.run(sb.id, sb.name, sb.description);
}

console.log(`Inserted ${sourcebooks.length} sourcebooks`);

// -- Sample provisions --

interface ProvisionRow {
  sourcebook_id: string;
  reference: string;
  title: string;
  text: string;
  type: string;
  status: string;
  effective_date: string;
  chapter: string;
  section: string;
}

const provisions: ProvisionRow[] = [
  // -- Consumer Protection Code --
  {
    sourcebook_id: "Consumer_Protection",
    reference: "CPC 2.1",
    title: "General Principle — Act honestly and fairly",
    text: "A regulated entity must act honestly, fairly and professionally in the best interests of its customers and the integrity of the market.",
    type: "Rule",
    status: "in_force",
    effective_date: "2012-01-01",
    chapter: "2",
    section: "2.1",
  },
  {
    sourcebook_id: "Consumer_Protection",
    reference: "CPC 2.2",
    title: "General Principle — Act with due skill, care and diligence",
    text: "A regulated entity must act with due skill, care and diligence in the best interests of its customers.",
    type: "Rule",
    status: "in_force",
    effective_date: "2012-01-01",
    chapter: "2",
    section: "2.2",
  },
  {
    sourcebook_id: "Consumer_Protection",
    reference: "CPC 2.3",
    title: "General Principle — Information to be clear and accurate",
    text: "A regulated entity must not mislead a consumer, whether by act, omission or presentation of information. Information provided to a consumer must be clear, accurate and up-to-date.",
    type: "Rule",
    status: "in_force",
    effective_date: "2012-01-01",
    chapter: "2",
    section: "2.3",
  },
  {
    sourcebook_id: "Consumer_Protection",
    reference: "CPC 4.1",
    title: "Suitability — Know your consumer",
    text: "Before providing a product or service to a consumer, a regulated entity must gather sufficient information from that consumer to enable it to assess the suitability of the product or service for that consumer.",
    type: "Rule",
    status: "in_force",
    effective_date: "2012-01-01",
    chapter: "4",
    section: "4.1",
  },
  {
    sourcebook_id: "Consumer_Protection",
    reference: "CPC 6.1",
    title: "Complaints handling — Requirement to have a written complaints procedure",
    text: "A regulated entity must have in place a written procedure for the proper handling of complaints from consumers. The procedure must be made available to consumers on request at any time.",
    type: "Rule",
    status: "in_force",
    effective_date: "2012-01-01",
    chapter: "6",
    section: "6.1",
  },
  {
    sourcebook_id: "Consumer_Protection",
    reference: "CPC 10.1",
    title: "Tracker mortgages — Obligation to offer tracker rate",
    text: "A regulated entity must offer a tracker mortgage interest rate to a consumer who is entitled to one, and must not take actions that would result in a consumer losing entitlement to a tracker mortgage interest rate.",
    type: "Rule",
    status: "in_force",
    effective_date: "2019-07-01",
    chapter: "10",
    section: "10.1",
  },

  // -- Fitness and Probity Standards --
  {
    sourcebook_id: "Fitness_Probity",
    reference: "FP 1.1",
    title: "Competence requirement",
    text: "A person performing a controlled function must be competent. A person is competent if they have the qualifications, experience and knowledge appropriate to the controlled function they perform.",
    type: "Standard",
    status: "in_force",
    effective_date: "2011-12-01",
    chapter: "1",
    section: "1.1",
  },
  {
    sourcebook_id: "Fitness_Probity",
    reference: "FP 1.2",
    title: "Honesty and integrity requirement",
    text: "A person performing a controlled function must be honest and must have integrity. In assessing honesty and integrity, regard must be had to whether the person has been convicted of any criminal offence, whether the person has been found to have engaged in dishonest or fraudulent conduct, and whether the person has made a false statement.",
    type: "Standard",
    status: "in_force",
    effective_date: "2011-12-01",
    chapter: "1",
    section: "1.2",
  },
  {
    sourcebook_id: "Fitness_Probity",
    reference: "FP 1.3",
    title: "Financial soundness requirement",
    text: "A person performing a controlled function must be financially sound. A person is financially sound if they are capable of meeting their financial obligations as and when they fall due, and have not engaged in financial conduct that calls into question their suitability.",
    type: "Standard",
    status: "in_force",
    effective_date: "2011-12-01",
    chapter: "1",
    section: "1.3",
  },
  {
    sourcebook_id: "Fitness_Probity",
    reference: "FP 2.1",
    title: "Due diligence obligation on regulated financial service providers",
    text: "A regulated financial service provider must take reasonable steps to satisfy itself on an ongoing basis that persons performing controlled functions on its behalf comply with the Fitness and Probity Standards.",
    type: "Obligation",
    status: "in_force",
    effective_date: "2011-12-01",
    chapter: "2",
    section: "2.1",
  },

  // -- Corporate Governance Code --
  {
    sourcebook_id: "Corporate_Governance",
    reference: "CGC 3.1",
    title: "Board composition",
    text: "The board of a credit institution must have a sufficient number of independent non-executive directors to exercise independent judgment on issues where the potential for conflicts of interest exists. The majority of board members must be non-executive directors.",
    type: "Requirement",
    status: "in_force",
    effective_date: "2015-01-01",
    chapter: "3",
    section: "3.1",
  },
  {
    sourcebook_id: "Corporate_Governance",
    reference: "CGC 4.1",
    title: "Risk committee",
    text: "The board of a credit institution designated as a significant institution must establish a dedicated risk committee composed of non-executive directors. The risk committee must advise the board on the institution's overall current and future risk appetite and strategy.",
    type: "Requirement",
    status: "in_force",
    effective_date: "2015-01-01",
    chapter: "4",
    section: "4.1",
  },
  {
    sourcebook_id: "Corporate_Governance",
    reference: "CGC 5.1",
    title: "Internal audit function",
    text: "A credit institution must have an effective internal audit function that is independent, objective and has sufficient resources to carry out its mandate. The internal audit function must have unfettered access to all activities, records, property, and personnel.",
    type: "Requirement",
    status: "in_force",
    effective_date: "2015-01-01",
    chapter: "5",
    section: "5.1",
  },

  // -- IT and Cybersecurity Risks --
  {
    sourcebook_id: "IT_Cybersecurity",
    reference: "ITCS 1.1",
    title: "IT risk management framework",
    text: "A regulated firm must have a comprehensive and effective IT risk management framework as part of its overall risk management framework. The IT risk management framework must identify, assess, manage, monitor and report IT risks, including cybersecurity risks, on an ongoing basis.",
    type: "Guidance",
    status: "in_force",
    effective_date: "2016-09-01",
    chapter: "1",
    section: "1.1",
  },
  {
    sourcebook_id: "IT_Cybersecurity",
    reference: "ITCS 2.1",
    title: "Cybersecurity controls",
    text: "A regulated firm must have appropriate cybersecurity controls in place that are commensurate with the nature, scale and complexity of its operations and the level of risk posed by its IT systems and data. Controls must include access management, encryption of sensitive data, vulnerability management, network security, and security monitoring.",
    type: "Guidance",
    status: "in_force",
    effective_date: "2016-09-01",
    chapter: "2",
    section: "2.1",
  },
  {
    sourcebook_id: "IT_Cybersecurity",
    reference: "ITCS 3.1",
    title: "Incident management and reporting",
    text: "A regulated firm must have effective IT incident management procedures that cover incident detection, classification, response, recovery, and post-incident review. Major IT-related incidents must be reported to the Central Bank as soon as practicable and not later than the timeframe specified in applicable regulatory requirements.",
    type: "Guidance",
    status: "in_force",
    effective_date: "2016-09-01",
    chapter: "3",
    section: "3.1",
  },
  {
    sourcebook_id: "IT_Cybersecurity",
    reference: "ITCS 4.1",
    title: "Third-party IT risk",
    text: "A regulated firm must manage IT risks arising from the use of third-party service providers, including cloud service providers. This includes conducting due diligence before engagement, maintaining written contractual arrangements that address security and data protection requirements, and monitoring third-party performance on an ongoing basis.",
    type: "Guidance",
    status: "in_force",
    effective_date: "2016-09-01",
    chapter: "4",
    section: "4.1",
  },

  // -- AML/CFT --
  {
    sourcebook_id: "AML_CFT",
    reference: "AML 1.1",
    title: "Customer due diligence obligation",
    text: "A designated person must apply customer due diligence measures when establishing a business relationship with a customer, when carrying out an occasional transaction at or above the threshold, when there is a suspicion of money laundering or terrorist financing, or when there is doubt about the veracity or adequacy of previously obtained customer identification data.",
    type: "Obligation",
    status: "in_force",
    effective_date: "2013-03-15",
    chapter: "1",
    section: "1.1",
  },
  {
    sourcebook_id: "AML_CFT",
    reference: "AML 2.1",
    title: "Transaction monitoring",
    text: "A designated person must monitor transactions undertaken by its customers to ensure that transactions are consistent with the designated person's knowledge of the customer, the customer's business and risk profile, including the source of funds. Complex, unusual or large transactions, or unusual patterns of transactions that have no apparent or visible economic or lawful purpose, must receive enhanced scrutiny.",
    type: "Obligation",
    status: "in_force",
    effective_date: "2013-03-15",
    chapter: "2",
    section: "2.1",
  },
  {
    sourcebook_id: "AML_CFT",
    reference: "AML 3.1",
    title: "Suspicious transaction reporting",
    text: "A designated person must as soon as practicable make a report to the Financial Intelligence Unit of An Garda Siochana and to the Revenue Commissioners where the designated person knows, suspects, or has reasonable grounds to suspect that another person has been or is engaged in an offence under the Criminal Justice (Money Laundering and Terrorist Financing) Act 2010.",
    type: "Obligation",
    status: "in_force",
    effective_date: "2013-03-15",
    chapter: "3",
    section: "3.1",
  },

  // -- Prudential --
  {
    sourcebook_id: "Prudential",
    reference: "PRU 1.1",
    title: "Capital adequacy — Minimum capital requirements",
    text: "Credit institutions authorised by the Central Bank must meet the minimum capital requirements set out in Regulation (EU) No 575/2013 (CRR) on an ongoing basis. The minimum Common Equity Tier 1 (CET1) capital ratio is 4.5%, the minimum Tier 1 capital ratio is 6%, and the minimum total capital ratio is 8%.",
    type: "Requirement",
    status: "in_force",
    effective_date: "2014-01-01",
    chapter: "1",
    section: "1.1",
  },
  {
    sourcebook_id: "Prudential",
    reference: "PRU 2.1",
    title: "Liquidity coverage ratio",
    text: "Credit institutions must maintain a liquidity coverage ratio (LCR) of at least 100% on an ongoing basis. The LCR requires institutions to hold sufficient high-quality liquid assets (HQLA) to cover net cash outflows over a 30-day stress period.",
    type: "Requirement",
    status: "in_force",
    effective_date: "2018-01-01",
    chapter: "2",
    section: "2.1",
  },
];

const insertProvision = db.prepare(`
  INSERT INTO provisions (sourcebook_id, reference, title, text, type, status, effective_date, chapter, section)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertAll = db.transaction(() => {
  for (const p of provisions) {
    insertProvision.run(
      p.sourcebook_id,
      p.reference,
      p.title,
      p.text,
      p.type,
      p.status,
      p.effective_date,
      p.chapter,
      p.section,
    );
  }
});

insertAll();

console.log(`Inserted ${provisions.length} sample provisions`);

// -- Sample enforcement actions --

interface EnforcementRow {
  firm_name: string;
  reference_number: string;
  action_type: string;
  amount: number;
  date: string;
  summary: string;
  sourcebook_references: string;
}

const enforcements: EnforcementRow[] = [
  {
    firm_name: "Ulster Bank Ireland DAC",
    reference_number: "ENF-2020-001",
    action_type: "fine",
    amount: 37_774_520,
    date: "2020-10-14",
    summary:
      "Fined for breaches of the Consumer Protection Code in relation to the tracker mortgage examination. Ulster Bank failed to identify and compensate all affected tracker mortgage customers, applied incorrect interest rates, and failed to maintain adequate records to demonstrate compliance with tracker mortgage entitlements.",
    sourcebook_references: "CPC 2.1, CPC 2.3, CPC 10.1",
  },
  {
    firm_name: "Permanent TSB plc",
    reference_number: "ENF-2019-002",
    action_type: "fine",
    amount: 21_000_000,
    date: "2019-05-22",
    summary:
      "Fined for tracker mortgage related failures. Permanent TSB improperly denied over 2,000 customers their contractual entitlements to tracker mortgage interest rates, causing significant financial harm to affected customers. The bank failed to maintain adequate systems and controls to identify customers entitled to tracker rates.",
    sourcebook_references: "CPC 2.1, CPC 10.1",
  },
  {
    firm_name: "Bank of Ireland",
    reference_number: "ENF-2020-003",
    action_type: "settlement",
    amount: 100_000_000,
    date: "2020-09-07",
    summary:
      "Settlement agreement in relation to tracker mortgage examination failures. Bank of Ireland improperly removed over 14,900 customers from tracker mortgage interest rates or failed to offer tracker rates to customers who were entitled to them. The settlement included redress and compensation payments to affected customers.",
    sourcebook_references: "CPC 2.1, CPC 10.1",
  },
  {
    firm_name: "An Post Money",
    reference_number: "ENF-2022-004",
    action_type: "fine",
    amount: 1_550_000,
    date: "2022-06-30",
    summary:
      "Fined for breaches of AML/CFT obligations. An Post Money failed to implement adequate customer due diligence procedures, had deficiencies in its transaction monitoring systems, and did not maintain adequate policies and procedures for identifying and reporting suspicious transactions.",
    sourcebook_references: "AML 1.1, AML 2.1, AML 3.1",
  },
  {
    firm_name: "Allied Irish Banks plc",
    reference_number: "ENF-2021-005",
    action_type: "fine",
    amount: 83_300_000,
    date: "2021-07-13",
    summary:
      "Fined for tracker mortgage related failures affecting approximately 5,900 customer accounts. AIB failed to identify all customers entitled to tracker interest rates and failed to maintain adequate records demonstrating compliance. This was the largest fine imposed by the Central Bank at the time.",
    sourcebook_references: "CPC 2.1, CPC 2.3, CPC 10.1",
  },
];

const insertEnforcement = db.prepare(`
  INSERT INTO enforcement_actions (firm_name, reference_number, action_type, amount, date, summary, sourcebook_references)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertEnforcementsAll = db.transaction(() => {
  for (const e of enforcements) {
    insertEnforcement.run(
      e.firm_name,
      e.reference_number,
      e.action_type,
      e.amount,
      e.date,
      e.summary,
      e.sourcebook_references,
    );
  }
});

insertEnforcementsAll();

console.log(`Inserted ${enforcements.length} sample enforcement actions`);

// -- Summary --

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

console.log(`\nDatabase summary:`);
console.log(`  Sourcebooks:          ${sourcebookCount}`);
console.log(`  Provisions:           ${provisionCount}`);
console.log(`  Enforcement actions:  ${enforcementCount}`);
console.log(`  FTS entries:          ${ftsCount}`);
console.log(`\nDone. Database ready at ${DB_PATH}`);

db.close();
