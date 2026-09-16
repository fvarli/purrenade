#!/usr/bin/env bash
#
# Purrenade frontend health assertion.
#
#   health-check.sh --url URL [--attempts N] [--interval SECONDS]
#
# One implementation, two call sites: the runner uses it against the public
# HTTPS origin, and it is piped to the host to check the loopback port. Rollback
# verification uses the identical assertion, so "healthy" means the same thing
# before and after a rollback.
#
# ---------------------------------------------------------------------------
# What counts as healthy, and why the obvious check did not
# ---------------------------------------------------------------------------
#
# The first version of this check was `curl -fsS -o /dev/null "$URL"`. That
# passes on a 301: `-f` only fails from 400 upwards, and without `-L` curl
# reports success for the redirect itself. A misrouted virtual host, a redirect
# loop, or nginx answering for the wrong site would all have been recorded as a
# successful deployment.
#
# So this asserts three things instead:
#
#   1. the status is exactly 200 — no redirect, and redirects are not followed,
#      because following one would prove something about a different URL;
#   2. the body carries a Purrenade-specific marker, which a default nginx page,
#      an error page, or another application on this shared host cannot satisfy;
#   3. the body does NOT carry the unresolved-session marker, so a page that
#      rendered but could not resolve its own auth state is not called healthy.

set -euo pipefail

# A class emitted by the home page in its resolved state. `home__resolving` is
# the branch that renders when the session could not be resolved; CI already
# asserts an anonymous page must not contain it.
readonly EXPECT_MARKER='home__play'
readonly REJECT_MARKER='home__resolving'

die() { printf '\n  ERROR: %s\n\n' "$1" >&2; exit 1; }

url=""; attempts=30; interval=2

while [[ $# -gt 0 ]]; do
    case "$1" in
        --url)      url="${2:-}"; shift 2 ;;
        --attempts) attempts="${2:-}"; shift 2 ;;
        --interval) interval="${2:-}"; shift 2 ;;
        *) die "unknown argument: $1" ;;
    esac
done

[[ -n "$url" ]] || die "missing --url"
[[ "$url" =~ ^https?://[A-Za-z0-9._~:/?#@!$\&()*+,\;=%-]+$ ]] || die "unsafe or malformed URL: ${url}"
[[ "$attempts" =~ ^[0-9]+$ && "$attempts" -ge 1 && "$attempts" -le 120 ]] || die "--attempts must be 1-120"
[[ "$interval" =~ ^[0-9]+$ && "$interval" -ge 1 && "$interval" -le 30 ]] || die "--interval must be 1-30"

body="$(mktemp)"
trap 'rm -f "$body"' EXIT

last_status="none"
for _ in $(seq 1 "$attempts"); do
    # No -f and no -L: the status is read explicitly so a redirect is visible
    # rather than silently accepted or silently followed.
    last_status="$(curl -sS -o "$body" -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo '000')"

    if [[ "$last_status" == "200" ]] \
       && grep -qF -- "$EXPECT_MARKER" "$body" \
       && ! grep -qF -- "$REJECT_MARKER" "$body"; then
        printf '  healthy: %s returned 200 carrying %s\n' "$url" "$EXPECT_MARKER"
        exit 0
    fi
    sleep "$interval"
done

if [[ "$last_status" != "200" ]]; then
    die "unhealthy: ${url} last returned HTTP ${last_status}, expected exactly 200
  A 3xx is NOT healthy — it means something other than this deployment answered."
fi
if grep -qF -- "$REJECT_MARKER" "$body"; then
    die "unhealthy: ${url} returned 200 but rendered the unresolved-session branch"
fi
die "unhealthy: ${url} returned 200 but did not carry the '${EXPECT_MARKER}' marker
  Something answered, but it was not a working Purrenade home page."
