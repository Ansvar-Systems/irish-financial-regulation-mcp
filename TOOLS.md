# Tool Reference

All tools are prefixed `ie_fin_` and query the Central Bank of Ireland (CBI)
regulatory database.

## ie_fin_search_regulations

Full-text search across CBI regulatory provisions.

**Arguments**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | Yes | Search terms (e.g., `consumer protection`, `cybersecurity`) |
| `sourcebook` | string | No | Filter by sourcebook ID (see COVERAGE.md) |
| `status` | `in_force` \| `deleted` \| `not_yet_in_force` | No | Filter by provision status |
| `limit` | number | No | Max results (default 20, max 100) |

**Response** — `{ results: Provision[], count: number, _meta }`

Each `Provision` item includes a `_citation` field for entity linking.

---

## ie_fin_get_regulation

Retrieve a specific CBI provision by sourcebook and reference.

**Arguments**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `sourcebook` | string | Yes | Sourcebook ID (e.g., `Consumer_Protection`) |
| `reference` | string | Yes | Provision reference (e.g., `CPC 2.1`, `FP 1.2`) |

**Response** — `Provision & { _citation, _meta }`

**Errors** — `{ error, _error_type: "not_found", _meta }` if provision does not exist.

---

## ie_fin_list_sourcebooks

List all available CBI sourcebooks.

> **Naming note:** This tool is named `ie_fin_list_sourcebooks` rather than
> `ie_fin_list_sources` to reflect CBI terminology. See COVERAGE.md.

**Arguments** — none

**Response** — `{ sourcebooks: Sourcebook[], count: number, _meta }`

---

## ie_fin_search_enforcement

Search CBI enforcement actions (fines, settlements, revocations).

**Arguments**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | Yes | Search terms (firm name, breach type, etc.) |
| `action_type` | `fine` \| `settlement` \| `revocation` \| `public_statement` \| `warning` | No | Filter by action type |
| `limit` | number | No | Max results (default 20, max 100) |

**Response** — `{ results: EnforcementAction[], count: number, _meta }`

Each `EnforcementAction` item includes a `_citation` field for entity linking.

---

## ie_fin_check_currency

Check whether a provision reference is currently in force.

**Arguments**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `reference` | string | Yes | Provision reference (e.g., `CPC 2.1`) |

**Response** — `{ reference, status, effective_date, found, _meta }`

---

## ie_fin_about

Return server metadata.

**Arguments** — none

**Response** — `{ name, version, description, data_source, tools[], _meta }`

---

## Missing mandatory meta-tool

The golden standard requires a `ie_fin_check_data_freshness` tool. This is not yet
implemented. Track progress in the issue tracker.
