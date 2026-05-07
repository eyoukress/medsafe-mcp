# MedSafe MCP Server
**Agents Assemble Hackathon submission — Option 1: Superpower (MCP)**

## What it does
A healthcare MCP server exposing 3 tools that any agent can call to check medication safety using the free OpenFDA API (no API key needed).

### Tools
| Tool | What it does |
|------|-------------|
| `check_drug_interactions` | Fetches FDA drug label warnings & interaction data for a list of drugs |
| `get_drug_recalls` | Searches FDA enforcement database for active drug recalls |
| `lookup_adverse_events` | Queries FAERS for top adverse event reports for a drug |

All tools accept optional `patient_id` and `fhir_token` parameters for SHARP context propagation.

## Setup

```bash
npm install
npm start
```

Requires Node.js 18+. No API keys needed.

## MCP Config (for Prompt Opinion platform)

```json
{
  "mcpServers": {
    "medsafe": {
      "command": "node",
      "args": ["/path/to/medsafe-mcp/index.js"]
    }
  }
}
```

## Example tool calls

**Check interactions:**
```json
{
  "tool": "check_drug_interactions",
  "arguments": {
    "drugs": ["warfarin", "aspirin"],
    "patient_id": "Patient/12345"
  }
}
```

**Recall lookup:**
```json
{
  "tool": "get_drug_recalls",
  "arguments": { "drug_name": "metformin" }
}
```

**Adverse events:**
```json
{
  "tool": "lookup_adverse_events",
  "arguments": { "drug_name": "ibuprofen", "limit": 10 }
}
```

## API
Uses [OpenFDA](https://open.fda.gov/apis/) — free, no key, 1,000 requests/day.
- `/drug/label.json` — drug labels and warnings
- `/drug/enforcement.json` — recall database
- `/drug/event.json` — FAERS adverse events

## Demo video script
1. Show the MCP server running locally
2. Call `check_drug_interactions` with warfarin + aspirin → show boxed warning response
3. Call `get_drug_recalls` → show recall data
4. Call `lookup_adverse_events` → show bar chart of top reactions
5. Show it registered in Prompt Opinion marketplace
