#!/usr/bin/env bash
#
# Purrenade frontend host operations, run over the audited transport.
#
#   remote-ops.sh restart
#   remote-ops.sh cleanup --path /tmp/purrenade-web-<sha>.tar.gz
#
# Deliberately tiny and deliberately fixed. `restart` takes no arguments at all,
# so the single privileged operation this deployment performs has no argv the
# caller can reach through: the sudoers contract names one exact unit.

set -euo pipefail

readonly SERVICE='purrenade-web.service'

die() { printf '\n  ERROR: %s\n\n' "$1" >&2; exit 1; }
info() { printf '  %s\n' "$1"; }

command="${1:-}"
[[ -n "$command" ]] || die "usage: remote-ops.sh {restart|cleanup} [...]"
shift

case "$command" in
    restart)
        [[ $# -eq 0 ]] || die "restart takes no arguments"
        # -n: never prompt. Without it a missing sudoers rule would block on a
        # password read that no CI session can ever answer, holding the
        # deployment lock until the job times out.
        sudo -n systemctl restart "$SERVICE"
        info "restarted ${SERVICE}"
        ;;

    cleanup)
        path=""
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --path) path="${2:-}"; shift 2 ;;
                *) die "unknown argument: $1" ;;
            esac
        done
        [[ -n "$path" ]] || die "missing --path"
        # Narrow by construction: only this deployment's own transfer artifact.
        [[ "$path" =~ ^/tmp/purrenade-web-[0-9a-f]{40}\.tar\.gz$ ]] \
            || die "refusing to remove an unexpected path: ${path}"
        rm -f "$path"
        info "removed ${path}"
        ;;

    *) die "unknown command: ${command}" ;;
esac
