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
# So this asserts four things instead:
#
#   1. the status is exactly 200 — no redirect, and redirects are not followed,
#      because following one would prove something about a different URL;
#   2. the body carries a Purrenade-specific marker, which a default nginx page,
#      an error page, or another application on this shared host cannot satisfy;
#   3. that marker is the *guest home* contract, so a 200 counts only when an
#      unauthenticated request rendered the real entry screen — not merely when
#      something Purrenade-shaped answered;
#   4. the body does NOT carry the unresolved-session marker, so a page that
#      rendered but could not resolve its own auth state is not called healthy.
#
# ---------------------------------------------------------------------------
# Why the marker is an attribute, and why this one
# ---------------------------------------------------------------------------
#
# It used to be the CSS class `home__play`. Two things were wrong with that, and
# they hid each other. A production build inlines the stylesheet, so the string
# sat in the `<head>` as a rule whether or not the element ever rendered; and
# `home__play` belonged to the *signed-in* play button, which an unauthenticated
# check can never legitimately see. The gate was matching a stylesheet rather
# than a page — passing while proving nothing about the body — right up until the
# product shell deleted the rule, at which point it rolled back a healthy
# release for the first honest reason it had ever given.
#
# `data-purrenade-health` exists in app/pages/index.vue for this and nothing
# else. It has no style rule and no behaviour, so it casts no shadow in the
# head, and it sits on the guest branch, so matching it proves the
# unauthenticated entry screen genuinely rendered. Both sides are one contract:
# see docs/production/ci-cd.md and tests/deploy/health-check.test.sh.

set -euo pipefail

readonly EXPECT_MARKER='data-purrenade-health="guest-home"'

# The branch the home page renders when it could not resolve the session. Still
# a class, because that is what the template carries and CI already asserts an
# anonymous page must not contain it. It has no CSS rule either, so it cannot
# appear in the inlined head.
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
  Something answered, but it was not the Purrenade guest home page."
