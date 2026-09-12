# Security Policy — Purrenade Frontend

## Reporting a vulnerability

Report suspected vulnerabilities privately to the repository owner. Do not open
a public issue, and do not include working exploit code in the initial report.

**OPEN:** the published security contact address and disclosure timeline are not
yet decided. See `docs/product/open-decisions.md`.

## Scope

This repository is the browser client **and, since [ADR-0005](docs/decisions/ADR-0005-authentication-and-2fa-strategy.md), the Nuxt BFF**.

**This changes the security posture of this repository.** The Nuxt server is no longer a
rendering layer: it holds server-side sessions, stores the upstream API credential, and
enforces the CSRF boundary for every state-changing browser request. It is **inside the
security boundary** and must be deployed, monitored and patched accordingly.

The **authorization** authority still lives entirely in the backend (`purrenade-api`) — the BFF
handles credentials, Laravel decides permissions. Findings concerning authorization, score
validation, or data handling belong to that repository's `docs/security/` documentation;
findings concerning session handling, cookies, or CSRF belong here.

## Standing rules

- **The frontend is never trusted for authorization.** Any UI-level gating is a
  convenience, not a control. Every protected action is authorized server-side by Laravel.
  **The BFF is not an exception**: it carries credentials, it does not grant permissions.
- **No bearer token is ever stored in browser storage.** The browser's only credential is an
  `HttpOnly`, `Secure`, `SameSite` session cookie it cannot read.
- **The BFF enforces CSRF** on every state-changing request. Same-origin and `SameSite` are
  defence in depth, not the control.
- **BFF session state is server-side and revocable.** Logging out revokes the BFF session *and*
  the upstream credential; a BFF session that outlives its API credential is a bug.
- **Never commit secrets.** The browser bundle is public by definition; anything
  shipped to the client is disclosed. API keys that must remain secret never
  enter this repository.
- **Private source photographs** must never be committed, bundled, served, or
  referenced from a deployed artifact.
- **No sensitive data in logs or telemetry**, including correlation/diagnostic output.
- Client-side obfuscation is **not** an anti-cheat control. See the backend's
  `docs/security/anti-cheat.md`.

## Dependencies

Dependency and supply-chain policy is defined at M1, when dependencies first
exist. Until then this repository has no runtime dependencies.
