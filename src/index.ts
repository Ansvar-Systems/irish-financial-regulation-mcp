#!/usr/bin/env node

/**
 * Irish Financial Regulation MCP — stdio entry point.
 *
 * Provides MCP tools for querying Central Bank of Ireland (CBI) regulations:
 * provisions, sourcebooks, enforcement actions, and currency checks.
 *
 * Tool prefix: ie_fin_
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  listSourcebooks,
  searchProvisions,
  getProvision,
  searchEnforcement,
  checkProvisionCurrency,
} from "./db.js";
import { buildCitation } from "./utils/citation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8"),
  ) as { version: string };
  pkgVersion = pkg.version;
} catch {
  // fallback to default
}

const SERVER_NAME = "irish-financial-regulation-mcp";

// --- Tool definitions ---

const TOOLS = [
  {
    name: "ie_fin_search_regulations",
    description:
      "Full-text search across Central Bank of Ireland (CBI) regulatory provisions. Returns matching rules, guidance notes, requirements, and codes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., 'consumer protection', 'fitness and probity', 'cybersecurity')",
        },
        sourcebook: {
          type: "string",
          description: "Filter by sourcebook ID (e.g., Consumer_Protection, Fitness_Probity, AML_CFT). Optional.",
        },
        status: {
          type: "string",
          enum: ["in_force", "deleted", "not_yet_in_force"],
          description: "Filter by provision status. Defaults to all statuses.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "ie_fin_get_regulation",
    description:
      "Get a specific CBI regulatory provision by sourcebook and reference. Accepts references like 'CPC 2.1' or 'FP 1.2'.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sourcebook: {
          type: "string",
          description: "Sourcebook identifier (e.g., Consumer_Protection, Fitness_Probity, Corporate_Governance)",
        },
        reference: {
          type: "string",
          description: "Full provision reference (e.g., 'CPC 2.1', 'FP 1.2', 'CGC 3.1')",
        },
      },
      required: ["sourcebook", "reference"],
    },
  },
  {
    name: "ie_fin_list_sourcebooks",
    description:
      "List all CBI regulatory sourcebooks and codes with their names and descriptions.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "ie_fin_search_enforcement",
    description:
      "Search CBI enforcement actions — settlement agreements, fines, revocations, and public statements. Returns matching enforcement decisions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., firm name, type of breach, 'tracker mortgage', 'AML')",
        },
        action_type: {
          type: "string",
          enum: ["fine", "settlement", "revocation", "public_statement", "warning"],
          description: "Filter by action type. Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "ie_fin_check_currency",
    description:
      "Check whether a specific CBI regulatory provision reference is currently in force. Returns status and effective date.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference: {
          type: "string",
          description: "Full provision reference to check (e.g., 'CPC 2.1', 'FP 1.2')",
        },
      },
      required: ["reference"],
    },
  },
  {
    name: "ie_fin_about",
    description: "Return metadata about this MCP server: version, data source, tool list.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// --- Zod schemas for argument validation ---

const SearchRegulationsArgs = z.object({
  query: z.string().min(1),
  sourcebook: z.string().optional(),
  status: z.enum(["in_force", "deleted", "not_yet_in_force"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const GetRegulationArgs = z.object({
  sourcebook: z.string().min(1),
  reference: z.string().min(1),
});

const SearchEnforcementArgs = z.object({
  query: z.string().min(1),
  action_type: z.enum(["fine", "settlement", "revocation", "public_statement", "warning"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const CheckCurrencyArgs = z.object({
  reference: z.string().min(1),
});

// --- Helpers ---

function responseMeta() {
  return {
    disclaimer:
      "Derived from Central Bank of Ireland (CBI) regulatory publications. For informational purposes only — not legal advice. Verify at https://www.centralbank.ie/regulation/",
    data_age: "~2025-04-01",
    copyright: "© Central Bank of Ireland",
    source_url: "https://www.centralbank.ie/regulation/",
  };
}

function textContent(data: unknown) {
  const payload =
    typeof data === "object" && data !== null
      ? { ...(data as object), _meta: responseMeta() }
      : { data, _meta: responseMeta() };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function errorContent(
  message: string,
  errorType: "not_found" | "tool_error" = "tool_error",
) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { error: message, _error_type: errorType, _meta: responseMeta() },
          null,
          2,
        ),
      },
    ],
    isError: true as const,
  };
}

// --- Server setup ---

const server = new Server(
  { name: SERVER_NAME, version: pkgVersion },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "ie_fin_search_regulations": {
        const parsed = SearchRegulationsArgs.parse(args);
        const rawResults = searchProvisions({
          query: parsed.query,
          sourcebook: parsed.sourcebook,
          status: parsed.status,
          limit: parsed.limit,
        });
        const results = rawResults.map((r) => ({
          ...r,
          _citation: buildCitation(
            `${r.sourcebook_id} ${r.reference}`,
            String(r.title ?? `${r.sourcebook_id} ${r.reference}`),
            "ie_fin_get_regulation",
            { sourcebook: r.sourcebook_id, reference: r.reference },
          ),
        }));
        return textContent({ results, count: results.length });
      }

      case "ie_fin_get_regulation": {
        const parsed = GetRegulationArgs.parse(args);
        const provision = getProvision(parsed.sourcebook, parsed.reference);
        if (!provision) {
          return errorContent(
            `Provision not found: ${parsed.sourcebook} ${parsed.reference}`,
            "not_found",
          );
        }
        const prov = provision as Record<string, unknown>;
        return textContent({
          ...provision,
          _citation: buildCitation(
            `${parsed.sourcebook} ${parsed.reference}`,
            String(prov.title ?? `${parsed.sourcebook} ${parsed.reference}`),
            "ie_fin_get_regulation",
            { sourcebook: parsed.sourcebook, reference: parsed.reference },
          ),
        });
      }

      case "ie_fin_list_sourcebooks": {
        const sourcebooks = listSourcebooks();
        return textContent({ sourcebooks, count: sourcebooks.length });
      }

      case "ie_fin_search_enforcement": {
        const parsed = SearchEnforcementArgs.parse(args);
        const rawEnforcement = searchEnforcement({
          query: parsed.query,
          action_type: parsed.action_type,
          limit: parsed.limit,
        });
        const results = rawEnforcement.map((r) => ({
          ...r,
          _citation: buildCitation(
            r.firm_name,
            r.firm_name,
            "ie_fin_search_enforcement",
            { query: r.firm_name },
          ),
        }));
        return textContent({ results, count: results.length });
      }

      case "ie_fin_check_currency": {
        const parsed = CheckCurrencyArgs.parse(args);
        const currency = checkProvisionCurrency(parsed.reference);
        return textContent(currency);
      }

      case "ie_fin_about": {
        return textContent({
          name: SERVER_NAME,
          version: pkgVersion,
          description:
            "Central Bank of Ireland (CBI) regulatory MCP server. Provides access to CBI codes, guidance, requirements, and enforcement actions.",
          data_source: "Central Bank of Ireland (https://www.centralbank.ie/regulation/)",
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
        });
      }

      default:
        return errorContent(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorContent(`Error executing ${name}: ${message}`, "tool_error");
  }
});

// --- Main ---

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${SERVER_NAME} v${pkgVersion} running on stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
