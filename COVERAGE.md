# Data Coverage

This MCP server covers **Central Bank of Ireland (CBI)** regulatory sourcebooks and
enforcement actions.

## Sourcebooks

| ID | Name | Description |
|----|------|-------------|
| `Consumer_Protection` | Consumer Protection Code | Rules and guidance for consumer-facing regulated firms |
| `Fitness_Probity` | Fitness & Probity Standards | Individual accountability standards for PCFs and CFs |
| `Corporate_Governance` | Corporate Governance Code | Board and senior management governance requirements |
| `IT_Cybersecurity` | IT & Cybersecurity Guidelines | Technology risk and cyber resilience requirements |
| `AML_CFT` | AML/CFT Requirements | Anti-money laundering and counter-financing of terrorism rules |
| `Prudential` | Prudential Requirements | Capital, liquidity, and solvency requirements |

## Enforcement actions

CBI enforcement actions including settlement agreements, fines, revocations, and
public statements.

## Data freshness

| Data type | Last ingested | Source |
|-----------|--------------|--------|
| Sourcebook provisions | ~2025-04-01 | <https://www.centralbank.ie/regulation/> |
| Enforcement actions | ~2025-04-01 | <https://www.centralbank.ie/regulation/enforcement/> |

Data is refreshed monthly via the scheduled ingest workflow (`.github/workflows/ingest.yml`).
Run `npm run ingest` to trigger a manual refresh.

## Naming note

The tool for listing sourcebooks is named `ie_fin_list_sourcebooks` (not
`ie_fin_list_sources`). This is intentional to reflect CBI terminology; the
discrepancy from the golden-standard naming is documented here to avoid confusion.
