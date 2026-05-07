import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import http from "http";

const FDA = "https://api.fda.gov";
const PORT = process.env.PORT || 3000;

async function fdaFetch(path) {
  try {
    const res = await fetch(FDA + path);
    if (!res.ok) return null;
    return res.json();
  } catch (e) {
    return null;
  }
}

async function checkDrugInteractions({ drugs, patient_id }) {
  const results = [];
  for (const drug of drugs) {
    const q = encodeURIComponent('openfda.brand_name:"' + drug + '" OR openfda.generic_name:"' + drug + '"');
    const data = await fdaFetch("/drug/label.json?search=" + q + "&limit=1");
    if (!data || !data.results || !data.results[0]) {
      results.push({ drug: drug, found: false });
      continue;
    }
    const L = data.results[0];
    results.push({
      drug: drug,
      found: true,
      boxed_warning: L.boxed_warning ? L.boxed_warning[0].substring(0, 400) : null,
      warnings: L.warnings ? L.warnings[0].substring(0, 400) : null,
      drug_interactions: L.drug_interactions ? L.drug_interactions[0].substring(0, 400) : null,
      brand_names: L.openfda && L.openfda.brand_name ? L.openfda.brand_name.slice(0, 3) : []
    });
  }
  return { tool: "check_drug_interactions", drugs_checked: drugs, patient_id: patient_id || null, results: results };
}

async function getDrugRecalls({ drug_name, limit, patient_id }) {
  const n = limit || 5;
  const q = encodeURIComponent('product_description:"' + drug_name + '"');
  const data = await fdaFetch("/drug/enforcement.json?search=" + q + "&limit=" + n);
  if (!data || !data.results || !data.results.length) {
    return { tool: "get_drug_recalls", drug_name: drug_name, recalls_found: 0, recalls: [] };
  }
  return {
    tool: "get_drug_recalls",
    drug_name: drug_name,
    patient_id: patient_id || null,
    recalls_found: data.results.length,
    recalls: data.results.map(function(r) {
      return {
        classification: r.classification,
        status: r.status,
        reason: r.reason_for_recall ? r.reason_for_recall.substring(0, 300) : null,
        product: r.product_description ? r.product_description.substring(0, 200) : null,
        date: r.recall_initiation_date,
        company: r.recalling_firm
      };
    })
  };
}

async function lookupAdverseEvents({ drug_name, limit, patient_id }) {
  const n = limit || 10;
  const q = encodeURIComponent('patient.drug.medicinalproduct:"' + drug_name + '"');
  const data = await fdaFetch("/drug/event.json?search=" + q + "&count=patient.reaction.reactionmeddrapt.exact&limit=" + n);
  if (!data || !data.results || !data.results.length) {
    return { tool: "lookup_adverse_events", drug_name: drug_name, events_found: 0, top_events: [] };
  }
  return {
    tool: "lookup_adverse_events",
    drug_name: drug_name,
    patient_id: patient_id || null,
    events_found: data.results.length,
    top_events: data.results.slice(0, n).map(function(e) {
      return { reaction: e.term, report_count: e.count };
    })
  };
}

function buildServer() {
  const server = new Server(
    { name: "medsafe-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async function() {
    return {
      tools: [
        {
          name: "check_drug_interactions",
          description: "Check FDA drug label warnings and interactions for a list of medications. Accepts optional SHARP context (patient_id, fhir_token).",
          inputSchema: {
            type: "object",
            properties: {
              drugs: { type: "array", items: { type: "string" }, description: "List of drug names" },
              patient_id: { type: "string" },
              fhir_token: { type: "string" }
            },
            required: ["drugs"]
          }
        },
        {
          name: "get_drug_recalls",
          description: "Search the FDA enforcement database for drug recalls matching a drug name.",
          inputSchema: {
            type: "object",
            properties: {
              drug_name: { type: "string" },
              limit: { type: "number" },
              patient_id: { type: "string" }
            },
            required: ["drug_name"]
          }
        },
        {
          name: "lookup_adverse_events",
          description: "Look up the most reported adverse events for a drug using FDA FAERS database.",
          inputSchema: {
            type: "object",
            properties: {
              drug_name: { type: "string" },
              limit: { type: "number" },
              patient_id: { type: "string" }
            },
            required: ["drug_name"]
          }
        }
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async function(request) {
    const name = request.params.name;
    const args = request.params.arguments;
    try {
      var result;
      if (name === "check_drug_interactions") result = await checkDrugInteractions(args);
      else if (name === "get_drug_recalls") result = await getDrugRecalls(args);
      else if (name === "lookup_adverse_events") result = await lookupAdverseEvents(args);
      else throw new Error("Unknown tool: " + name);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: "Error: " + err.message }], isError: true };
    }
  });

  return server;
}

const httpServer = http.createServer(async function(req, res) {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", name: "medsafe-mcp" }));
    return;
  }

  if (req.url === "/mcp") {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", function() { transport.close(); });
    const server = buildServer();
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Use POST /mcp" }));
});

httpServer.listen(PORT, function() {
  console.log("MedSafe MCP server running on port " + PORT);
});
