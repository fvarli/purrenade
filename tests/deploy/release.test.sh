#!/usr/bin/env bash
#
# Tests for deploy/bin/release.sh.
#
#   tests/deploy/release.test.sh
#
# Every case builds a throwaway release root under $TMPDIR and drives the real
# script against it. Nothing here touches production, a service, or the network.
#
# The cases are not arbitrary: each one is an invariant that, if broken, breaks
# production in a specific way. The session-store cases matter most — a release
# mechanism that loses the store signs every player out, and does it silently.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE="$SCRIPT_DIR/deploy/bin/release.sh"

PASS=0
FAIL=0

pass() { printf '  ok   %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

# Two distinguishable, well-formed release ids.
readonly SHA_A='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
readonly SHA_B='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
readonly SHA_C='cccccccccccccccccccccccccccccccccccccccc'

# A release root with a session store holding a sentinel we can look for later.
make_root() {
    local root; root="$(mktemp -d)"
    mkdir -p "$root/releases" "$root/shared/session-store"
    printf 'a-live-session-record' > "$root/shared/session-store/sentinel"
    printf '%s' "$root"
}

# A tarball shaped like a real artifact: a .output tree with the entrypoint.
make_artifact() {
    local id="$1" dir; dir="$(mktemp -d)"
    mkdir -p "$dir/.output/server"
    printf 'export default %s\n' "$id" > "$dir/.output/server/index.mjs"
    tar -czf "$dir/artifact.tar.gz" -C "$dir" .output
    printf '%s' "$dir/artifact.tar.gz"
}

sum_of() { sha256sum "$1" | cut -d' ' -f1; }

install_release() {
    local root="$1" id="$2" art
    art="$(make_artifact "$id")"
    "$RELEASE" install --root "$root" --id "$id" --artifact "$art" --sha256 "$(sum_of "$art")" >/dev/null
}

# --- first release -----------------------------------------------------------
t_first_release() {
    local root; root="$(make_root)"
    install_release "$root" "$SHA_A"
    "$RELEASE" activate --root "$root" --id "$SHA_A" >/dev/null

    [[ "$("$RELEASE" current --root "$root")" == "$SHA_A" ]] \
        && pass "first release becomes current" \
        || fail "first release becomes current" "current is not $SHA_A"

    [[ -f "$root/current/.output/server/index.mjs" ]] \
        && pass "current resolves to the entrypoint" \
        || fail "current resolves to the entrypoint" "entrypoint missing through current"
    rm -rf "$root"
}

# --- second release and the atomic switch ------------------------------------
t_second_release() {
    local root; root="$(make_root)"
    install_release "$root" "$SHA_A"; "$RELEASE" activate --root "$root" --id "$SHA_A" >/dev/null
    install_release "$root" "$SHA_B"; "$RELEASE" activate --root "$root" --id "$SHA_B" >/dev/null

    [[ "$("$RELEASE" current --root "$root")" == "$SHA_B" ]] \
        && pass "second release switches current" \
        || fail "second release switches current" "current is not $SHA_B"

    [[ -d "$root/releases/$SHA_A" ]] \
        && pass "previous release stays on disk" \
        || fail "previous release stays on disk" "$SHA_A was removed"

    # `current` is a symlink at every observable moment; it is never a directory
    # and never absent.
    [[ -L "$root/current" ]] \
        && pass "current remains a symlink after switching" \
        || fail "current remains a symlink after switching" "current is not a symlink"
    rm -rf "$root"
}

# --- the session store survives everything -----------------------------------
t_session_store_survives() {
    local root; root="$(make_root)"
    install_release "$root" "$SHA_A"; "$RELEASE" activate --root "$root" --id "$SHA_A" >/dev/null
    install_release "$root" "$SHA_B"; "$RELEASE" activate --root "$root" --id "$SHA_B" >/dev/null
    "$RELEASE" rollback --root "$root" >/dev/null
    "$RELEASE" prune --root "$root" --keep 2 >/dev/null

    [[ "$(cat "$root/shared/session-store/sentinel" 2>/dev/null)" == 'a-live-session-record' ]] \
        && pass "session store survives install, activate, rollback and prune" \
        || fail "session store survives install, activate, rollback and prune" "sentinel lost"
    rm -rf "$root"
}

t_session_store_not_in_release() {
    local root; root="$(make_root)"
    install_release "$root" "$SHA_A"
    [[ ! -e "$root/releases/$SHA_A/shared" && ! -e "$root/releases/$SHA_A/session-store" ]] \
        && pass "a release never contains the session store" \
        || fail "a release never contains the session store" "store material inside the release"
    rm -rf "$root"
}

# --- failure before activation leaves production alone -----------------------
t_failure_before_activation() {
    local root; root="$(make_root)"
    install_release "$root" "$SHA_A"; "$RELEASE" activate --root "$root" --id "$SHA_A" >/dev/null

    # A corrupt artifact for the incoming release: install must refuse.
    local art; art="$(make_artifact "$SHA_B")"
    "$RELEASE" install --root "$root" --id "$SHA_B" --artifact "$art" \
        --sha256 '0000000000000000000000000000000000000000000000000000000000000000' >/dev/null 2>&1
    local rc=$?

    [[ $rc -ne 0 ]] \
        && pass "a checksum mismatch refuses to install" \
        || fail "a checksum mismatch refuses to install" "install returned 0"

    [[ "$("$RELEASE" current --root "$root")" == "$SHA_A" ]] \
        && pass "failure before activation leaves current untouched" \
        || fail "failure before activation leaves current untouched" "current moved"

    [[ ! -d "$root/releases/$SHA_B" ]] \
        && pass "a refused install creates no release" \
        || fail "a refused install creates no release" "$SHA_B exists"
    rm -rf "$root"
}

# --- rollback ----------------------------------------------------------------
t_rollback() {
    local root; root="$(make_root)"
    install_release "$root" "$SHA_A"; "$RELEASE" activate --root "$root" --id "$SHA_A" >/dev/null
    install_release "$root" "$SHA_B"; "$RELEASE" activate --root "$root" --id "$SHA_B" >/dev/null
    "$RELEASE" rollback --root "$root" >/dev/null

    [[ "$("$RELEASE" current --root "$root")" == "$SHA_A" ]] \
        && pass "rollback returns to the previous release" \
        || fail "rollback returns to the previous release" "current is not $SHA_A"

    [[ -d "$root/releases/$SHA_B" ]] \
        && pass "rollback keeps the failed release for diagnosis" \
        || fail "rollback keeps the failed release for diagnosis" "$SHA_B was deleted"
    rm -rf "$root"
}

t_rollback_without_target_refuses() {
    local root; root="$(make_root)"
    install_release "$root" "$SHA_A"; "$RELEASE" activate --root "$root" --id "$SHA_A" >/dev/null
    "$RELEASE" rollback --root "$root" >/dev/null 2>&1
    [[ $? -ne 0 ]] \
        && pass "rollback with no recorded target refuses instead of guessing" \
        || fail "rollback with no recorded target refuses instead of guessing" "returned 0"
    rm -rf "$root"
}

# --- immutability ------------------------------------------------------------
t_existing_release_not_overwritten() {
    local root; root="$(make_root)"
    install_release "$root" "$SHA_A"
    printf 'marker' > "$root/releases/$SHA_A/.output/server/marker"
    install_release "$root" "$SHA_A"
    [[ -f "$root/releases/$SHA_A/.output/server/marker" ]] \
        && pass "re-installing an existing release does not overwrite it" \
        || fail "re-installing an existing release does not overwrite it" "release was replaced"
    rm -rf "$root"
}

t_partial_release_never_activates() {
    local root; root="$(make_root)"
    mkdir -p "$root/releases/$SHA_A.incoming/.output/server"
    "$RELEASE" activate --root "$root" --id "$SHA_A" >/dev/null 2>&1
    [[ $? -ne 0 ]] \
        && pass "a partial .incoming directory cannot be activated" \
        || fail "a partial .incoming directory cannot be activated" "activate returned 0"
    rm -rf "$root"
}

t_artifact_without_entrypoint_refused() {
    local root; root="$(make_root)"
    local dir; dir="$(mktemp -d)"
    mkdir -p "$dir/.output/public"
    printf 'x' > "$dir/.output/public/only-static"
    tar -czf "$dir/bad.tar.gz" -C "$dir" .output
    "$RELEASE" install --root "$root" --id "$SHA_A" --artifact "$dir/bad.tar.gz" \
        --sha256 "$(sum_of "$dir/bad.tar.gz")" >/dev/null 2>&1
    [[ $? -ne 0 && ! -d "$root/releases/$SHA_A" ]] \
        && pass "an artifact without the server entrypoint is refused" \
        || fail "an artifact without the server entrypoint is refused" "it was installed"
    rm -rf "$root" "$dir"
}

# --- unsafe ids --------------------------------------------------------------
t_unsafe_ids_rejected() {
    local root; root="$(make_root)"
    local bad rejected=1
    for bad in '../escape' 'main' 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' \
               'aaaa' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/x' '' '$(id)'; do
        if "$RELEASE" activate --root "$root" --id "$bad" >/dev/null 2>&1; then
            rejected=0
            fail "unsafe release ids are rejected" "accepted: '$bad'"
            break
        fi
    done
    [[ $rejected -eq 1 ]] && pass "unsafe release ids are rejected"
    rm -rf "$root"
}

# --- prune -------------------------------------------------------------------
t_prune_protects_current_and_rollback() {
    local root; root="$(make_root)"
    install_release "$root" "$SHA_A"; "$RELEASE" activate --root "$root" --id "$SHA_A" >/dev/null
    sleep 0.01
    install_release "$root" "$SHA_B"; "$RELEASE" activate --root "$root" --id "$SHA_B" >/dev/null
    sleep 0.01
    install_release "$root" "$SHA_C"

    # Keep the minimum. The active release and the rollback target must survive
    # regardless, even though SHA_A is the oldest directory on disk.
    "$RELEASE" prune --root "$root" --keep 2 >/dev/null

    [[ -d "$root/releases/$SHA_B" ]] \
        && pass "prune never deletes the active release" \
        || fail "prune never deletes the active release" "$SHA_B removed"

    [[ -d "$root/releases/$SHA_A" ]] \
        && pass "prune never deletes the rollback target" \
        || fail "prune never deletes the rollback target" "$SHA_A removed"

    [[ -d "$root/shared/session-store" ]] \
        && pass "prune never touches shared state" \
        || fail "prune never touches shared state" "shared/ was removed"
    rm -rf "$root"
}

t_prune_removes_stale_staging() {
    local root; root="$(make_root)"
    install_release "$root" "$SHA_A"; "$RELEASE" activate --root "$root" --id "$SHA_A" >/dev/null
    mkdir -p "$root/releases/$SHA_C.incoming/.output"
    "$RELEASE" prune --root "$root" --keep 2 >/dev/null
    [[ ! -d "$root/releases/$SHA_C.incoming" ]] \
        && pass "prune sweeps stale staging directories" \
        || fail "prune sweeps stale staging directories" "leftover .incoming remains"
    rm -rf "$root"
}

t_prune_refuses_unsafe_keep() {
    local root; root="$(make_root)"
    "$RELEASE" prune --root "$root" --keep 1 >/dev/null 2>&1
    local one=$?
    "$RELEASE" prune --root "$root" --keep 'x' >/dev/null 2>&1
    local bad=$?
    [[ $one -ne 0 && $bad -ne 0 ]] \
        && pass "prune refuses a --keep that would leave no rollback target" \
        || fail "prune refuses a --keep that would leave no rollback target" "accepted"
    rm -rf "$root"
}


# --- adversarial archives ----------------------------------------------------
#
# Regression coverage for the redteam finding that extraction trusted the
# archive's shape. Provenance proves the bytes; it does not prove the layout.

# Build an archive from a prepared directory and try to install it.
try_install() {
    local root="$1" art="$2" id="${3:-$SHA_A}"
    "$RELEASE" install --root "$root" --id "$id" --artifact "$art" \
        --sha256 "$(sum_of "$art")" >/dev/null 2>&1
}

t_archive_symlink_entrypoint_refused() {
    local root; root="$(make_root)"
    local d; d="$(mktemp -d)"
    mkdir -p "$d/.output/server"
    ln -s /etc/hostname "$d/.output/server/index.mjs"
    tar -czf "$d/a.tar.gz" -C "$d" .output
    try_install "$root" "$d/a.tar.gz"
    [[ $? -ne 0 && ! -d "$root/releases/$SHA_A" ]] \
        && pass "an archive whose entrypoint is a symlink is refused" \
        || fail "an archive whose entrypoint is a symlink is refused" "it installed"
    rm -rf "$root" "$d"
}

t_archive_escaping_symlink_refused() {
    local root; root="$(make_root)"
    local d; d="$(mktemp -d)"
    mkdir -p "$d/.output/server"
    printf 'x' > "$d/.output/server/index.mjs"
    ln -s ../../../../shared/session-store "$d/.output/ESCAPE"
    tar -czf "$d/a.tar.gz" -C "$d" .output
    try_install "$root" "$d/a.tar.gz"
    [[ $? -ne 0 && ! -d "$root/releases/$SHA_A" ]] \
        && pass "an archive containing a symlink out of the tree is refused" \
        || fail "an archive containing a symlink out of the tree is refused" "it installed"
    rm -rf "$root" "$d"
}

t_archive_hardlink_refused() {
    local root; root="$(make_root)"
    local d; d="$(mktemp -d)"
    mkdir -p "$d/.output/server"
    printf 'x' > "$d/.output/server/index.mjs"
    ln "$d/.output/server/index.mjs" "$d/.output/server/HARD" 2>/dev/null || { rm -rf "$root" "$d"; return; }
    tar -czf "$d/a.tar.gz" -C "$d" .output
    try_install "$root" "$d/a.tar.gz"
    [[ $? -ne 0 && ! -d "$root/releases/$SHA_A" ]] \
        && pass "an archive containing a hard link is refused" \
        || fail "an archive containing a hard link is refused" "it installed"
    rm -rf "$root" "$d"
}

t_archive_traversal_member_refused() {
    local root; root="$(make_root)"
    local d; d="$(mktemp -d)"
    mkdir -p "$d/.output/server" "$d/evil"
    printf 'x' > "$d/.output/server/index.mjs"
    printf 'pwned' > "$d/evil/ESCAPED"
    # A member literally named ../ESCAPED.
    tar -czf "$d/a.tar.gz" -C "$d" .output --transform='s|^evil/ESCAPED|../ESCAPED|' evil/ESCAPED 2>/dev/null
    try_install "$root" "$d/a.tar.gz"
    [[ $? -ne 0 && ! -e "$root/releases/ESCAPED" && ! -e "$root/ESCAPED" ]] \
        && pass "an archive with a traversal member is refused" \
        || fail "an archive with a traversal member is refused" "it installed or escaped"
    rm -rf "$root" "$d"
}

t_archive_absolute_member_refused() {
    local root; root="$(make_root)"
    local d; d="$(mktemp -d)"
    mkdir -p "$d/.output/server"
    printf 'x' > "$d/.output/server/index.mjs"
    tar -czPf "$d/a.tar.gz" -C "$d" .output /etc/hostname 2>/dev/null
    try_install "$root" "$d/a.tar.gz"
    [[ $? -ne 0 && ! -d "$root/releases/$SHA_A" ]] \
        && pass "an archive with an absolute member is refused" \
        || fail "an archive with an absolute member is refused" "it installed"
    rm -rf "$root" "$d"
}

t_archive_unexpected_toplevel_refused() {
    local root; root="$(make_root)"
    local d; d="$(mktemp -d)"
    mkdir -p "$d/.output/server" "$d/extra"
    printf 'x' > "$d/.output/server/index.mjs"
    printf 'y' > "$d/extra/thing"
    tar -czf "$d/a.tar.gz" -C "$d" .output extra
    try_install "$root" "$d/a.tar.gz"
    [[ $? -ne 0 && ! -d "$root/releases/$SHA_A" ]] \
        && pass "an archive with a member outside .output/ is refused" \
        || fail "an archive with a member outside .output/ is refused" "it installed"
    rm -rf "$root" "$d"
}

t_valid_artifact_still_installs() {
    local root; root="$(make_root)"
    install_release "$root" "$SHA_A"
    [[ -f "$root/releases/$SHA_A/.output/server/index.mjs" ]] \
        && pass "a well-formed artifact still installs after hardening" \
        || fail "a well-formed artifact still installs after hardening" "install regressed"
    rm -rf "$root"
}

# --- rollback marker semantics ----------------------------------------------
t_second_rollback_fails_explicitly() {
    local root; root="$(make_root)"
    install_release "$root" "$SHA_A"; "$RELEASE" activate --root "$root" --id "$SHA_A" >/dev/null
    install_release "$root" "$SHA_B"; "$RELEASE" activate --root "$root" --id "$SHA_B" >/dev/null
    "$RELEASE" rollback --root "$root" >/dev/null

    # The second rollback must refuse rather than report a transition that did
    # not happen. Before the fix it printed "rolled back to A" while A was
    # already current.
    "$RELEASE" rollback --root "$root" >/dev/null 2>&1
    local rc=$?
    local still; still="$("$RELEASE" current --root "$root")"
    [[ $rc -ne 0 && "$still" == "$SHA_A" ]] \
        && pass "a second rollback fails explicitly instead of faking a transition" \
        || fail "a second rollback fails explicitly instead of faking a transition" "rc=$rc current=$still"
    rm -rf "$root"
}


t_dotted_filenames_are_not_traversal() {
    # Nitro emits chunks like `_...unmatched_.mjs`. An earlier hardening pass
    # rejected any member containing "..", which would have blocked every real
    # deployment. `..` is only traversal when it is a whole path component.
    local root; root="$(make_root)"
    local d; d="$(mktemp -d)"
    mkdir -p "$d/.output/server/chunks/routes"
    printf 'x' > "$d/.output/server/index.mjs"
    printf 'x' > "$d/.output/server/chunks/routes/_...unmatched_.mjs"
    printf 'x' > "$d/.output/server/chunks/a..b.mjs"
    tar -czf "$d/a.tar.gz" -C "$d" .output
    try_install "$root" "$d/a.tar.gz"
    [[ -d "$root/releases/$SHA_A" ]] \
        && pass "filenames containing dots are not treated as traversal" \
        || fail "filenames containing dots are not treated as traversal" "a legitimate artifact was refused"
    rm -rf "$root" "$d"
}

printf '\nrelease.sh\n'
t_first_release
t_second_release
t_session_store_survives
t_session_store_not_in_release
t_failure_before_activation
t_rollback
t_rollback_without_target_refuses
t_existing_release_not_overwritten
t_partial_release_never_activates
t_artifact_without_entrypoint_refused
t_unsafe_ids_rejected
t_prune_protects_current_and_rollback
t_prune_removes_stale_staging
t_prune_refuses_unsafe_keep
t_archive_symlink_entrypoint_refused
t_archive_escaping_symlink_refused
t_archive_hardlink_refused
t_archive_traversal_member_refused
t_archive_absolute_member_refused
t_archive_unexpected_toplevel_refused
t_valid_artifact_still_installs
t_second_rollback_fails_explicitly
t_dotted_filenames_are_not_traversal

printf '\n  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
