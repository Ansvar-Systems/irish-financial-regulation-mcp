# Irish Financial Regulation MCP

MCP server for the Central Bank of Ireland (CBI) regulatory framework. Provides tools to query CBI codes, guidance, requirements, and enforcement actions.

Tool prefix: `ie_fin_`

## Tools

| Tool | Description |
|------|-------------|
| `ie_fin_search_regulations` | Full-text search across CBI regulatory provisions |
| `ie_fin_get_regulation` | Get a specific provision by sourcebook + reference (e.g., Consumer_Protection CPC 2.1) |
| `ie_fin_list_sourcebooks` | List all CBI sourcebooks and codes with descriptions |
| `ie_fin_search_enforcement` | Search CBI enforcement actions (fines, settlements, revocations) |
| `ie_fin_check_currency` | Check if a provision reference is currently in force |
| `ie_fin_about` | Return server metadata and tool list |

## Sourcebooks

| ID | Name |
|----|------|
| `Consumer_Protection` | Consumer Protection Code (CPC) |
| `Fitness_Probity` | Fitness and Probity Standards |
| `Corporate_Governance` | Corporate Governance Code for Credit Institutions |
| `IT_Cybersecurity` | Cross-Industry Guidance on IT and Cybersecurity Risks |
| `AML_CFT` | Anti-Money Laundering and Counter-Terrorism Financing |
| `Prudential` | Prudential Requirements |

## Setup

### Prerequisites

- Node.js 20+
- A populated `data/cbi.db` SQLite database (run `npm run seed` for sample data)

### Build

```bash
npm install
npm run build
```

### Seed sample data

```bash
npm run seed
```

### Run (stdio)

```bash
node dist/src/index.js
```

### Run (HTTP server)

```bash
PORT=3000 node dist/src/http-server.js
```

The HTTP server exposes:
- `POST /mcp` — MCP Streamable HTTP endpoint
- `GET /health` — liveness probe

### Docker

```bash
docker build -t irish-financial-regulation-mcp .
docker run --rm -p 3000:3000 -e CBI_DB_PATH=/app/data/cbi.db irish-financial-regulation-mcp
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CBI_DB_PATH` | `data/cbi.db` | Path to the SQLite database |
| `PORT` | `3000` | HTTP server port |

## Data Source

Central Bank of Ireland: https://www.centralbank.ie/regulation/

## License

Apache-2.0 — Ansvar Systems AB
