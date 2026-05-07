#!/usr/bin/env node
/**
 * MedSafe MCP Server
 * Hackathon: Agents Assemble — Healthcare AI Endgame
 * Tools: check_drug_interactions, get_drug_recalls, lookup_adverse_events
 * Free API: OpenFDA (no key needed)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const FDA_BASE = "https://api.fda.gov";

// ── helpers ──────────────────────────────────────────────────────────────────

async function fdaFetch(path) {
  const res = await fetch(`${FDA_BASE}${path}`);
  if (!res.ok) return null;
  return res.json();
}

// ── tool implementations ──────────────────────────────────────────────────────

async function checkDrugInteractions({ drugs, patient_id, fhir_token }) {
  const results = [];

  for (const drug of drugs) {
    const query = encodeURIComponent(`openfda.brand_name:"${drug}" OR openfda.generic_name:"${drug}"`);
    const data = await fdaFetch(`/drug/label.json?search=${query}&limit=1`);

    if (!data?.results?.[0]) {
      results.push({ drug, found: false, message: "No FDA label data found." });
      continue;
    }

    const label = data.results[0];
    results.push({
      drug,
      found: true,
      boxed_warning: label.boxed_warning?.[0]?.substring(0, 500) ?? null,
      warnings: label.warnings?.[0]?.substring(0, 500) ?? null,
      drug_interactions: label.drug_interactions?.[0]?.substring(0, 500) ?? null,
      contraindications: label.contraindications?.[0]?.substring(0, 300) ?? null,
      brand_names: label.openfda?.brand_name?.slice(0, 3) ?? [],
    });
  }

  return {
    tool: "check_drug_interactions",
    drugs_checked: drugs,
    patient_id: patient_id ?? null,
    results,
    disclaimer: "This is informational only. Always verify with a licensed pharmacist.",
  };
}

async function getDrugRecalls({ drug_name, limit = 5, patient_id }) {
  const query = encodeURIComponent(`product_description:"${drug_name}"`);
  const data = await fdaFetch(`/drug/enforcement.json?search=${query}&limit=${limit}`);

  if (!data?.results?.length) {
    return {
      tool: "get_drug_recalls",
      drug_name,
      patient_id: patient_id ?? null,
      recalls_found: 0,
      recalls: [],
      message: "No active recalls found for this drug.",
    };
  }

  return {
    tool: "get_drug_recalls",
    drug_name,
    patient_id: patient_id ?? null,
    recalls_found: data.results.length,
    recalls: data.results.map((r) => ({
      classification: r.classification,
      status: r.status,
      reason: r.reason_for_recall?.substring(0, 300),
      product: r.product_description?.substring(0, 200),
      date: r.recall_initiation_date,
      company: r.recalling_firm,
    })),
  };
}

async function lookupAdverseEvents({ drug_name, limit = 10, patient_id }) {
  const query = encodeURIComponent(`patient.drug.medicinalproduct:"${drug_name}"`);
  const data = await fdaFetch(
    `/drug/event.json?search=${query}&count=patient.reaction.reactionmeddrapt.exact&limit=${limit}`
  );

  if (!data?.results?.length) {
    return {
      tool: "lookup_adverse_events",
      drug_name,
      patient_id: patient_id ?? null,
      events_found: 0,
      top_events: [],
      message: "No adverse event data found.",
    };
  }

  return {
    tool: "lookup_adverse_events",
    drug_name,
    patient_id: patient_id ?? null,
    events_found: data.results.length,
    top_events: data.results.slice(0, limit).map((e) => ({
      reaction: e.term,
      report_count: e.count,
    })),
  };
}

// ── MCP server setup ──────────────────────────────────────────────────────────

const server = new Server(
  { name: "medsafe-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "check_drug_interactions",
      description:
        "Check FDA drug label warnings and known interactions for a list of medications. Accepts optional SHARP context (patient_id, fhir_token).",
      inputSchema: {
        type: "object",
        properties: {
          drugs: {
            type: "array",
            items: { type: "string" },
            description: "List of drug names (generic or brand) to check.",
          },
          patient_id: {
            type: "string",
            description: "FHIR Patient ID (SHARP context, optional).",
          },
          fhir_token: {
            type: "string",
            description: "FHIR bearer token (SHARP context, optional).",
          },
        },
        required: ["drugs"],
      },
    },
    {
      name: "get_drug_recalls",
      description:
        "Search the FDA enforcement database for drug recalls matching a drug name.",
      inputSchema: {
        type: "object",
        properties: {
          drug_name: { type: "string", description: "Drug name to search." },
          limit: { type: "number", description: "Max results (default 5)." },
          patient_id: { type: "string", description: "FHIR Patient ID (optional)." },
        },
        required: ["drug_name"],
      },
    },
    {
      name: "lookup_adverse_events",
      description:
        "Look up the most commonly reported adverse events for a drug using the FDA FAERS database.",
      inputSchema: {
        type: "object",
        properties: {
          drug_name: { type: "string", description: "Drug name to look up." },
          limit: { type: "number", description: "Number of top events (default 10)." },
          patient_id: { type: "string", description: "FHIR Patient ID (optional)." },
        },
        required: ["drug_name"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;
    if (name === "check_drug_interactions") result = await checkDrugInteractions(args);
    else if (name === "get_drug_recalls") result = await getDrugRecalls(args);
    else if (name === "lookup_adverse_events") result = await lookupAdverseEvents(args);
    else throw new Error(`Unknown tool: ${name}`);

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MedSafe MCP server running...");
