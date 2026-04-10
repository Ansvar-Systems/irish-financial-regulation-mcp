# Privacy Policy

This MCP server (`irish-financial-regulation-mcp`) does **not** collect, store, or
transmit any personal data.

## Data processed

- **Tool call arguments** — query strings, sourcebook identifiers, and provision
  references passed by MCP clients. These are used only to fulfil the immediate
  tool request and are not logged or retained beyond the request lifecycle.
- **Session IDs** — for the HTTP transport, a session UUID is held in memory for
  the duration of a client session and discarded on disconnect.

## Data sources

The server reads from a local SQLite database populated with publicly available
regulatory text from the Central Bank of Ireland website. No personal data is
present in this database.

## Contact

For privacy concerns, open an issue in the project repository.
