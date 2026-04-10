# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report security issues by emailing the maintainers or opening a private
security advisory via GitHub's **Security** tab in this repository.

Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested mitigations

We aim to acknowledge reports within 3 business days and provide a fix or mitigation
plan within 14 days.

## Security posture

- The server reads from a local SQLite file; it does not accept external database
  connections.
- The HTTP transport (`http-server.ts`) binds to `localhost` by default (port 3000).
  Expose it behind a reverse proxy or firewall if deployed remotely.
- No credentials or secrets are stored in the codebase. The database contains only
  publicly available regulatory text.
- Dependencies should be kept up to date. Run `npm audit` regularly.
