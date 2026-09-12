/**
 * A second-by-second countdown, seeded by the server.
 *
 * Used by the verification resend (v0.3 board 04 renders `0:42`).
 *
 * The starting value always comes from the server — either from the response
 * that issued the code, or from the `retry_after` on a `429`. The client never
 * assumes 42: if it did, the countdown would drift from the server's actual
 * refusal, and a player would be told "try now" and refused.
 *
 * The interval is cleared on unmount, because a timer that outlives its
 * component keeps the page awake and writes to a dead ref.
 */
export function useCooldown() {
  const remaining = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function start(seconds: number): void {
    stop()

    remaining.value = Math.max(0, Math.floor(seconds))

    if (remaining.value === 0) return

    timer = setInterval(() => {
      remaining.value -= 1

      if (remaining.value <= 0) stop()
    }, 1000)
  }

  /** `m:ss`, matching the design's `0:42`. */
  const formatted = computed(() => {
    const total = Math.max(0, remaining.value)
    const minutes = Math.floor(total / 60)
    const seconds = total % 60

    return `${minutes}:${String(seconds).padStart(2, '0')}`
  })

  const active = computed(() => remaining.value > 0)

  onUnmounted(stop)

  return { remaining, formatted, active, start, stop }
}
