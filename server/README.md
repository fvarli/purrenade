# `server/` — Nitro, and the BFF security boundary

**This directory is inside the security boundary.** Per
[ADR-0005](../docs/decisions/ADR-0005-authentication-and-2fa-strategy.md), Nitro acts as a
**BFF**: it holds the server-side session, stores the upstream API credential, and enforces
the CSRF boundary for every state-changing browser request.

Two rules that hold from bootstrap onward:

1. **The browser never receives a bearer token.** Its only credential is an `HttpOnly`,
   `Secure`, `SameSite` session cookie it cannot read. Nothing writes a token to
   `localStorage` or `sessionStorage`.
2. **The BFF is not an authorization authority.** It carries credentials; **Laravel decides**
   every authentication and authorization question.

**No authentication is implemented in M1.** The directory exists so that the M2 session and
CSRF work slots in without an architectural rewrite.
