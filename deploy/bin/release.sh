#!/usr/bin/env bash
#
# Purrenade frontend release management.
#
#   release.sh install  --root DIR --id ID --artifact FILE --sha256 SUM
#   release.sh activate --root DIR --id ID
#   release.sh rollback --root DIR
#   release.sh prune    --root DIR [--keep N]
#   release.sh current  --root DIR
#
# Every command operates on a release root laid out as:
#
#   <root>/releases/<id>/        an extracted, immutable build artifact
#   <root>/shared/session-store/ persistent BFF session state — NEVER a release
#   <root>/current -> releases/<id>
#
# `--root` is a parameter rather than a constant precisely so this script can be
# exercised against a temporary directory tree. The deployment tests in
# tests/deploy/release.test.sh do exactly that: the logic that switches
# production traffic is the logic the tests run, not a paraphrase of it.
#
# This script never touches the session store, never restarts a service, and
# never talks to systemd. It moves directories and one symlink. Service
# lifecycle belongs to the workflow, which can see the health check result.

set -euo pipefail

# A release id is a full Git commit SHA and nothing else.
#
# This is the single most important validation in the file. The id becomes a
# path segment, so anything permitting `/`, `.` or whitespace turns a release
# identifier into a directory traversal. Forty lowercase hex characters cannot.
readonly ID_PATTERN='^[0-9a-f]{40}$'

# How many releases to keep when pruning, unless told otherwise. Three is the
# active release, one rollback target, and one spare for diagnosis.
readonly DEFAULT_KEEP=3

die() { printf '\n  ERROR: %s\n\n' "$1" >&2; exit 1; }
info() { printf '  %s\n' "$1"; }

require_id() {
    [[ -n "${1:-}" ]] || die "missing --id"
    [[ "$1" =~ $ID_PATTERN ]] || die \
"unsafe release id: '$1'
  A release id must be a full 40-character lowercase Git commit SHA.
  It becomes a directory name, so nothing else is accepted."
}

require_root() {
    [[ -n "${1:-}" ]] || die "missing --root"
    [[ -d "$1" ]] || die "release root does not exist: $1"
}

# The release the `current` symlink points at, or the empty string if there is
# no current release yet (a first deployment).
current_id() {
    local root="$1" target
    [[ -L "$root/current" ]] || { printf ''; return 0; }
    target="$(readlink "$root/current")"
    printf '%s' "${target##*/}"
}

# ---------------------------------------------------------------------------
# install — extract an artifact into an immutable release directory
# ---------------------------------------------------------------------------
#
# Extraction happens into `<id>.incoming` and is renamed into place only once it
# has completed. A half-extracted directory is therefore never a release: if the
# transfer dies mid-way, what is left behind is named `.incoming` and neither
# `activate` nor `prune` will treat it as one.
cmd_install() {
    local root="" id="" artifact="" expected_sum=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --root)     root="${2:-}"; shift 2 ;;
            --id)       id="${2:-}"; shift 2 ;;
            --artifact) artifact="${2:-}"; shift 2 ;;
            --sha256)   expected_sum="${2:-}"; shift 2 ;;
            *) die "unknown argument: $1" ;;
        esac
    done

    require_root "$root"
    require_id "$id"
    [[ -n "$artifact" ]] || die "missing --artifact"
    [[ -f "$artifact" ]] || die "artifact not found: $artifact"
    [[ -n "$expected_sum" ]] || die "missing --sha256"

    # Integrity before anything is written. A filename claiming to contain a SHA
    # proves nothing; this proves the bytes are the bytes CI built.
    local actual_sum
    actual_sum="$(sha256sum "$artifact" | cut -d' ' -f1)"
    [[ "$actual_sum" == "$expected_sum" ]] || die \
"artifact checksum mismatch — refusing to install
  expected: $expected_sum
  actual:   $actual_sum"

    local release_dir="$root/releases/$id"
    local staging_dir="$root/releases/$id.incoming"

    # An existing release is immutable. Re-running a deployment of a SHA that is
    # already installed is a no-op, not an overwrite: the bytes on disk are
    # already the bytes that were verified when they arrived, and rewriting them
    # under a running service is a way to make a rerun mean something different
    # from the run it repeats.
    if [[ -d "$release_dir" ]]; then
        info "release $id is already installed; leaving it untouched"
        return 0
    fi

    # -----------------------------------------------------------------------
    # Inspect the archive before extracting a single byte of it.
    #
    # Provenance and a checksum prove the bytes are the bytes CI produced. They
    # say nothing about the SHAPE of what is inside, and the extraction target
    # sits beside `shared/session-store` and the live `current` symlink.
    #
    # GNU tar happens to refuse `..` members and strip leading slashes, but that
    # is a property of one implementation's defaults, not a contract. It also
    # restores symlinks quite happily — a symlinked entrypoint, or a link
    # pointing out of the tree, survives extraction. So the members are checked
    # here, explicitly, and anything that is not a plain file or directory under
    # `.output/` is refused.
    # -----------------------------------------------------------------------
    local member
    while IFS= read -r member; do
        [[ -n "$member" ]] || continue
        case "$member" in
            /*) die "unsafe archive: absolute member path: ${member}" ;;
        esac
        # `..` as a PATH COMPONENT, not as a substring. Matching `*..*` rejected
        # Nitro's own `_...unmatched_.mjs` route chunk and would have blocked
        # every real deployment — caught by rehearsing with a genuine artifact
        # rather than a synthetic one. Wrapping in slashes makes `/../` the only
        # thing that matches.
        case "/${member}/" in
            */../*) die "unsafe archive: path traversal in member: ${member}" ;;
        esac
        case "$member" in
            .output|.output/*) ;;
            *) die "unsafe archive: member outside .output/: ${member}" ;;
        esac
    done < <(tar -tzf "$artifact")

    # Type check. The first column of a verbose listing is the member type:
    # `-` regular, `d` directory. Anything else — `l` symlink, `h` hardlink,
    # `c`/`b` device, `p` fifo, `s` socket — is refused.
    local type_line
    while IFS= read -r type_line; do
        [[ -n "$type_line" ]] || continue
        case "${type_line:0:1}" in
            -|d) ;;
            l)   die "unsafe archive: contains a symbolic link: ${type_line}" ;;
            h)   die "unsafe archive: contains a hard link: ${type_line}" ;;
            *)   die "unsafe archive: contains a special file: ${type_line}" ;;
        esac
    done < <(tar -tvzf "$artifact")

    rm -rf "$staging_dir"
    mkdir -p "$staging_dir"

    # --no-same-owner and --no-same-permissions: the archive does not get to
    # choose who owns a production release or how readable it is.
    tar -xzf "$artifact" -C "$staging_dir" --no-same-owner --no-same-permissions

    # The artifact must carry the Nitro server entrypoint, and it must be a real
    # regular file. `-f` alone follows symlinks, so a link named index.mjs
    # pointing anywhere readable would have satisfied the old check and made the
    # executed entrypoint indirect.
    local entrypoint="$staging_dir/.output/server/index.mjs"
    if [[ -L "$entrypoint" ]] || [[ ! -f "$entrypoint" ]]; then
        rm -rf "$staging_dir"
        die "artifact does not contain a regular file at .output/server/index.mjs"
    fi

    # `mv -T` on the same filesystem is atomic: the release either exists
    # complete or does not exist.
    mv -T "$staging_dir" "$release_dir"
    info "installed release $id"
}

# ---------------------------------------------------------------------------
# activate — point `current` at a release, atomically
# ---------------------------------------------------------------------------
cmd_activate() {
    local root="" id=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --root) root="${2:-}"; shift 2 ;;
            --id)   id="${2:-}"; shift 2 ;;
            *) die "unknown argument: $1" ;;
        esac
    done

    require_root "$root"
    require_id "$id"
    [[ -d "$root/releases/$id" ]] || die "release not installed: $id"

    local previous
    previous="$(current_id "$root")"

    # Record the outgoing release before switching, so rollback has a target
    # that does not depend on directory timestamps.
    if [[ -n "$previous" && "$previous" != "$id" ]]; then
        mkdir -p "$root/shared"
        printf '%s\n' "$previous" > "$root/shared/previous-release"
    fi

    # `ln -sfn` beside the live link, then `mv -Tf` over it. `rename(2)` is
    # atomic, so `current` is never absent — not even for an instant. Removing
    # the link first and recreating it would open a window in which a request
    # arrives at a service whose working directory does not exist.
    ln -sfn "releases/$id" "$root/current.new"
    mv -Tf "$root/current.new" "$root/current"

    info "activated release $id${previous:+ (previous: $previous)}"
}

# ---------------------------------------------------------------------------
# rollback — return to the release that was active before the last activation
# ---------------------------------------------------------------------------
#
# The failed release is deliberately left on disk. Whatever went wrong is worth
# looking at, and deleting the evidence during an incident is how the same
# incident happens twice.
cmd_rollback() {
    local root=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --root) root="${2:-}"; shift 2 ;;
            *) die "unknown argument: $1" ;;
        esac
    done

    require_root "$root"

    local marker="$root/shared/previous-release"
    [[ -f "$marker" ]] || die \
"no previous release recorded — cannot roll back automatically.
  This is expected for a first deployment. Investigate and activate a known
  good release by hand."

    local previous
    previous="$(tr -d '[:space:]' < "$marker")"
    require_id "$previous"
    [[ -d "$root/releases/$previous" ]] || die \
"recorded rollback target is not installed: $previous"

    local failed
    failed="$(current_id "$root")"

    ln -sfn "releases/$previous" "$root/current.new"
    mv -Tf "$root/current.new" "$root/current"

    # Consume the marker.
    #
    # Leaving it in place made a second rollback a no-op that still reported
    # success — the marker and `current` both named the same release, so the
    # operator was told a transition had happened when nothing moved. One
    # rollback is one step back; a further step is a deliberate act with a named
    # release, not a repeat of the same command.
    rm -f "$marker"

    info "rolled back to $previous${failed:+ (kept failed release $failed for diagnosis)}"
    info "rollback marker consumed: a further step back must name a release explicitly"
}

# ---------------------------------------------------------------------------
# prune — remove old releases, protecting the ones that matter
# ---------------------------------------------------------------------------
cmd_prune() {
    local root="" keep="$DEFAULT_KEEP"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --root) root="${2:-}"; shift 2 ;;
            --keep) keep="${2:-}"; shift 2 ;;
            *) die "unknown argument: $1" ;;
        esac
    done

    require_root "$root"
    [[ "$keep" =~ ^[0-9]+$ ]] || die "--keep must be a number, got: $keep"
    [[ "$keep" -ge 2 ]] || die "--keep must be at least 2, so a rollback target always survives"

    local active previous
    active="$(current_id "$root")"
    previous=""
    [[ -f "$root/shared/previous-release" ]] && \
        previous="$(tr -d '[:space:]' < "$root/shared/previous-release")"

    # Newest first, by modification time. Only well-formed release directories
    # are considered: `.incoming` leftovers are not releases and are not counted
    # toward `--keep`, so a failed transfer cannot push a good release out.
    local -a releases=()
    local entry name
    while IFS= read -r entry; do
        name="$(basename "$entry")"
        [[ "$name" =~ $ID_PATTERN ]] || continue
        releases+=("$name")
    done < <(find "$root/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null \
             | sort -rn | cut -d' ' -f2-)

    local kept=0 removed=0
    for name in "${releases[@]}"; do
        # Three protections, checked before the counter. The active release and
        # the rollback target are never candidates however old they are.
        if [[ "$name" == "$active" ]]; then
            info "keeping $name (active)"
            kept=$((kept + 1)); continue
        fi
        if [[ -n "$previous" && "$name" == "$previous" ]]; then
            info "keeping $name (rollback target)"
            kept=$((kept + 1)); continue
        fi
        if [[ "$kept" -lt "$keep" ]]; then
            kept=$((kept + 1)); continue
        fi
        rm -rf "${root:?}/releases/$name"
        info "removed $name"
        removed=$((removed + 1))
    done

    # Stale staging directories are swept here and nowhere else, so that a
    # concurrent install is never racing this cleanup for a live release path.
    while IFS= read -r entry; do
        rm -rf "$entry"
        info "removed stale staging directory $(basename "$entry")"
    done < <(find "$root/releases" -mindepth 1 -maxdepth 1 -type d -name '*.incoming' 2>/dev/null)

    info "prune complete: $kept kept, $removed removed"
}

cmd_current() {
    local root=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --root) root="${2:-}"; shift 2 ;;
            *) die "unknown argument: $1" ;;
        esac
    done
    require_root "$root"
    printf '%s\n' "$(current_id "$root")"
}

main() {
    local command="${1:-}"
    [[ -n "$command" ]] || die "usage: release.sh {install|activate|rollback|prune|current} --root DIR [...]"
    shift

    case "$command" in
        install)  cmd_install "$@" ;;
        activate) cmd_activate "$@" ;;
        rollback) cmd_rollback "$@" ;;
        prune)    cmd_prune "$@" ;;
        current)  cmd_current "$@" ;;
        *) die "unknown command: $command" ;;
    esac
}

main "$@"
