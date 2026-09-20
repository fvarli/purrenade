#!/usr/bin/env bash
#
# Tests for deploy/bin/health-check.sh.
#
#   tests/deploy/health-check.test.sh
#
# The real script is driven against a throwaway HTTP server serving canned
# responses. Nothing here touches production, a service, or the network beyond
# loopback.
#
# These exist because of a specific production incident. The gate asserted the
# class `home__play`, a production build inlines the stylesheet, and the string
# therefore lived in the `<head>` whether or not anything rendered — so the gate
# passed for reasons unrelated to the page. When the product shell removed the
# class, a healthy release was rolled back and the pipeline had, for the first
# time, told the truth by accident.
#
# Two kinds of case follow from that. The behavioural ones prove the script
# still refuses what it must refuse; the contract ones prove the marker it
# looks for is the marker the home page actually serves — which is the half
# nothing was checking.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT_DIR/deploy/bin/health-check.sh"
HOME_PAGE="$ROOT_DIR/app/pages/index.vue"

PASS=0
FAIL=0

pass() { printf '  ok   %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

# The marker is read out of the script rather than repeated here. A test
# carrying its own copy of the contract cannot detect the two halves drifting
# apart, which is the failure being guarded against.
MARKER="$(sed -n "s/^readonly EXPECT_MARKER='\(.*\)'\$/\1/p" "$CHECK")"
REJECT="$(sed -n "s/^readonly REJECT_MARKER='\(.*\)'\$/\1/p" "$CHECK")"

# --- a canned origin ---------------------------------------------------------

HELPER="$(mktemp)"
cat > "$HELPER" <<'PY'
import sys, http.server

status = int(sys.argv[1])
body = open(sys.argv[2], 'rb').read()
port_file = sys.argv[3]


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(status)
        if status in (301, 302, 307, 308):
            self.send_header('Location', 'http://127.0.0.1:1/elsewhere')
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
with open(port_file, 'w') as handle:
    handle.write(str(server.server_address[1]))
server.serve_forever()
PY

SERVER_PID=""
PORT=""

start_origin() {  # start_origin <status> <body-file>
    local port_file; port_file="$(mktemp)"
    python3 "$HELPER" "$1" "$2" "$port_file" &
    SERVER_PID=$!
    local waited=0
    while [[ $waited -lt 50 ]]; do
        PORT="$(cat "$port_file" 2>/dev/null)"
        [[ -n "$PORT" ]] && return 0
        sleep 0.1
        waited=$((waited + 1))
    done
    return 1
}

stop_origin() {
    [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
    SERVER_PID=""
}

trap 'stop_origin; rm -f "$HELPER"' EXIT

body_file() { local f; f="$(mktemp)"; printf '%s' "$1" > "$f"; printf '%s' "$f"; }

# The rendered template only. The `<script setup>` block documents both hooks
# at length, including the one that caused the incident — a check that grepped
# the whole file would be satisfied by the explanation of a hook that no longer
# exists, which is a test passing for the reason it was written to catch.
template_of() { sed -n '/^<template>/,/^<\/template>/p' "$HOME_PAGE"; }

# A response shaped like the real thing: an inlined stylesheet in the head, then
# the guest body carrying the contract.
guest_home() {
    printf '%s' "<!DOCTYPE html><html><head><style>.home__entry{display:grid}</style></head>\
<body><div class=\"product-shell home\"><section class=\"home__entry\" ${MARKER} \
aria-labelledby=\"entry-title\"><h1>Purrenade</h1></section></div></body></html>"
}

# Runs the check against a canned origin and reports its exit status + output.
run_against() {  # run_against <status> <body>
    local out
    start_origin "$1" "$(body_file "$2")" || { echo "origin failed to start"; return 99; }
    out="$($CHECK --url "http://127.0.0.1:${PORT}/" --attempts 1 --interval 1 2>&1)"
    local code=$?
    stop_origin
    printf '%s' "$out"
    return $code
}

# --- behaviour ---------------------------------------------------------------

t_guest_home_is_healthy() {
    local out; out="$(run_against 200 "$(guest_home)")"
    if [[ $? -eq 0 ]]; then pass "a guest home carrying the contract is healthy"
    else fail "a guest home carrying the contract is healthy" "$out"; fi
}

t_missing_marker_is_rejected() {
    local out; out="$(run_against 200 '<!DOCTYPE html><html><body><h1>Welcome to nginx</h1></body></html>')"
    if [[ $? -ne 0 ]] && [[ "$out" == *"did not carry"* ]]; then
        pass "a 200 without the contract is refused"
    else fail "a 200 without the contract is refused" "$out"; fi
}

t_resolving_branch_is_rejected() {
    local out
    out="$(run_against 200 "<html><body><p class=\"${REJECT}\">…</p><section ${MARKER}></section></body></html>")"
    if [[ $? -ne 0 ]] && [[ "$out" == *"unresolved-session"* ]]; then
        pass "a page that could not resolve its session is refused, contract or not"
    else fail "a page that could not resolve its session is refused, contract or not" "$out"; fi
}

t_redirect_is_not_healthy() {
    local out; out="$(run_against 301 "$(guest_home)")"
    if [[ $? -ne 0 ]] && [[ "$out" == *"expected exactly 200"* ]]; then
        pass "a 301 is not healthy, even carrying the contract"
    else fail "a 301 is not healthy, even carrying the contract" "$out"; fi
}

t_server_error_is_not_healthy() {
    local out; out="$(run_against 500 '<html><body>error</body></html>')"
    if [[ $? -ne 0 ]]; then pass "a 500 is not healthy"
    else fail "a 500 is not healthy" "$out"; fi
}

t_nothing_listening_is_not_healthy() {
    local out
    out="$($CHECK --url 'http://127.0.0.1:9/' --attempts 1 --interval 1 2>&1)"
    if [[ $? -ne 0 ]]; then pass "a closed port is not healthy"
    else fail "a closed port is not healthy" "$out"; fi
}

# --- the contract ------------------------------------------------------------

t_marker_is_not_the_old_class() {
    # Comments are excluded on purpose: the script explains the incident at
    # length and naming the old class there is the point of the explanation.
    # What must not come back is an executable dependency on it.
    if grep -v '^[[:space:]]*#' "$CHECK" | grep -q 'home__play'; then
        fail "the gate no longer depends on the signed-in play button" \
             "home__play appears in executable code in health-check.sh"
    else
        pass "the gate no longer depends on the signed-in play button"
    fi
}

t_marker_is_served_by_the_home_page() {
    if [[ -z "$MARKER" ]]; then
        fail "the marker the gate wants is the marker the home page serves" "could not read EXPECT_MARKER"
    elif grep -qF -- "$MARKER" <<<"$(template_of)"; then
        pass "the marker the gate wants is the marker the home page serves"
    else
        fail "the marker the gate wants is the marker the home page serves" \
             "$MARKER is not in app/pages/index.vue — deployment would roll back"
    fi
}

t_marker_is_on_the_guest_branch() {
    # Below `v-else`, i.e. the branch an unauthenticated request renders. A
    # marker that drifted into the signed-in branch would make the gate
    # unsatisfiable, which is precisely how the previous one failed.
    local guest; guest="$(template_of | sed -n '/<template v-else>/,/<\/template>/p')"
    if grep -qF -- "$MARKER" <<<"$guest"; then
        pass "the marker sits on the branch an anonymous request renders"
    else
        fail "the marker sits on the branch an anonymous request renders" \
             "$MARKER is not inside the guest template"
    fi
}

t_marker_has_no_style_rule() {
    # The original defect: a marker with a style rule is inlined into the head
    # by a production build, and the gate then matches the stylesheet rather
    # than the page — passing whatever the body contains.
    local styles; styles="$(sed -n '/<style/,/<\/style>/p' "$HOME_PAGE")"
    local bare="${MARKER%%=*}"
    if grep -qF -- "$bare" <<<"$styles"; then
        fail "the marker carries no style rule, so it cannot appear in the inlined head" \
             "$bare is styled in app/pages/index.vue"
    else
        pass "the marker carries no style rule, so it cannot appear in the inlined head"
    fi
}

t_reject_marker_has_no_style_rule() {
    local styles; styles="$(sed -n '/<style/,/<\/style>/p' "$HOME_PAGE")"
    if grep -qF -- "$REJECT" <<<"$styles"; then
        fail "the reject marker carries no style rule either" \
             "$REJECT is styled, so every production response would look unresolved"
    else
        pass "the reject marker carries no style rule either"
    fi
}

t_play_hook_still_exists_for_the_browser_specs() {
    # Not the gate's business, but the same removal broke both. The signed-in
    # specs that select it need a session and do not run in CI, so nothing else
    # would notice it going.
    if grep -q 'class="home__play"' <<<"$(template_of)"; then
        pass "the signed-in play button still carries its interaction hook"
    else
        fail "the signed-in play button still carries its interaction hook" \
             "home__play is gone from app/pages/index.vue; tests/e2e selects it"
    fi
}

printf '\nhealth-check.sh\n'

t_guest_home_is_healthy
t_missing_marker_is_rejected
t_resolving_branch_is_rejected
t_redirect_is_not_healthy
t_server_error_is_not_healthy
t_nothing_listening_is_not_healthy
t_marker_is_not_the_old_class
t_marker_is_served_by_the_home_page
t_marker_is_on_the_guest_branch
t_marker_has_no_style_rule
t_reject_marker_has_no_style_rule
t_play_hook_still_exists_for_the_browser_specs

printf '\n  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
