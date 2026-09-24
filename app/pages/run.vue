<script setup lang="ts">
import { HEARTS, PLAY_COLUMN_MAX_PX, PROGRESS } from '~~/game/bridge'
import { TUTORIAL_RUN_INIT } from '~/composables/useRunSurface'
import { DEFAULT_CHARACTER_ID } from '~/stores/run-session'
import type { RunSubmissionView } from '~/types/run'

/**
 * The run surface.
 *
 * Board 10 in the approved inventory, reached from the authenticated branch of
 * the navigation map. The engine boundary and the movement rules arrived at M5,
 * obstacles and hearts at M6, and the heads-up display with everything it shows
 * at M7. M9 made the run the server's: a normal run is **started by the
 * server before it is mounted** — its seed, its start time and its identity
 * come from `POST /api/game-runs` — and its result is submitted to the server,
 * which classifies it. The sequencing lives in the `runSession` store; this
 * page mounts what the store says is ready and shows what the server said.
 * The tutorial is untouched by any of it: it starts from a fixed seed and
 * submits nothing.
 *
 * **Client-only.** A canvas cannot be server-rendered and Phaser reads `window`
 * at import time, so `nuxt.config.ts` marks this route `ssr: false`.
 *
 * Thin on purpose. The lifetime of the engine — mounting, pausing when the tab
 * is hidden, and tearing the WebGL context down on leave — lives in
 * `useRunSurface`, where it can be driven by a fake engine in a test instead of
 * being verified by opening a browser and hoping.
 *
 * ---
 *
 * **The display is a heads-up display, not a page around a game.** v0.3's
 * gameplay boards float four small pieces of chrome over a full-bleed
 * playfield — a score card, a pause control, the hearts and Paw readouts, and
 * the SLAYYY meter along the bottom — and its desktop board keeps every one of
 * them in the same protected column, with the seaside spreading out behind. The
 * previous build put a bordered portrait frame in the middle of a page and a
 * white readout card beside it, which is a phone screenshot next to a web
 * widget. Everything below is one overlay on one canvas.
 */

definePageMeta({
  layout: false,
  middleware: 'verified',
  /*
   * Changing mode remounts the page.
   *
   * The mode is fixed for the life of a mounted engine, so moving from the
   * tutorial into a real run has to be a new page instance rather than a
   * reactive flag flipping under a live Phaser game. Keying on the query does
   * that through the ordinary route lifecycle: `stop()` tears the surface down
   * and `start()` builds a fresh one, which is the same teardown a route leave
   * and a replay already use.
   */
  key: route => String(route.query.mode ?? 'auto'),
})

const { t } = useI18n()

const auth = useAuthStore()
const route = useRoute()

/**
 * Which game this visit is.
 *
 * Read **once**, into a plain const rather than a computed, and that matters:
 * the mode is fixed for the life of a mounted engine, so a reactive value could
 * change what the player is playing without remounting it. Changing mode is a
 * navigation, and a navigation remounts this page.
 *
 * Three cases, in order of authority:
 *
 *  - `?mode=tutorial` — the Settings replay. An explicit request, honoured even
 *    for a player who has already finished.
 *  - `?mode=run` — where the tutorial hands over when it completes. Explicit so
 *    the handover does not depend on the store having already updated.
 *  - no query — the server decides. A player who has not been through the
 *    tutorial gets it; everyone else goes straight to a run.
 *
 * Nothing redirects, so there is no loop to get into: PLAY always points at
 * `/run` and this page chooses what to mount.
 */
const requestedMode = route.query.mode
const tutorialMode = requestedMode === 'tutorial'
  || (requestedMode !== 'run' && !auth.tutorialCompleted)

const surface = useTemplateRef<HTMLElement>('surface')
const {
  phase, loading, failed, isPaused, hasEnded, hearts, start, stop, restart, togglePause,
  score, runPaws, cyclePaws, loliActive, slayyy, slayyyPercent, activateSlayyy,
  lesson, lessonIndex, lessonTotal, correction, correctionAttempt, tutorialOutcome,
  skipTutorial, summary,
} = useRunSurface({ mode: tutorialMode ? 'tutorial' : 'run' })

/* --- the server run (M9) ------------------------------------------------ */

const runSession = useRunSessionStore()

/**
 * Mount the run the server started — only ever that one.
 *
 * Keyed on the store's start counter rather than the run id, so resuming the
 * *same* run (a restart from pause, a reload mid-run) still remounts it from
 * its own seed. There is no mid-run state to restore without an input log:
 * a resumed run replays from its start, and the page says so.
 */
function mountServerRun(): void {
  const run = runSession.run

  if (tutorialMode || run === null || surface.value === null) return

  stop()
  void start(surface.value, { seed: run.seed, loliCyclePaws: run.loli_cycle_paws })
}

watch(() => runSession.starts, () => {
  if (runSession.phase === 'ready') mountServerRun()
})

/**
 * The run ended: propose its result. Exactly once — `summary` is set once per
 * mounted run, and the store refuses a second submission for the same run.
 */
watch(summary, (ended) => {
  if (!tutorialMode && ended !== null) void runSession.submit(ended)
})

/** What the page is waiting on before there is a run to play, if anything. */
const startStatus = computed(() => {
  if (tutorialMode) return null

  switch (runSession.phase) {
    case 'resolving': return runSession.proposed !== null ? t('run.start.resolvingPrevious') : t('run.start.starting')
    case 'starting': return t('run.start.starting')
    default: return null
  }
})

/** A start that could not happen, and why, in the player's language. */
const startProblem = computed(() => {
  if (tutorialMode) return null

  if (runSession.phase === 'blocked') return t('run.start.blocked')

  if (runSession.phase === 'start_failed') {
    return runSession.problemCode === 'client_network_error'
      ? t('run.start.offline')
      : t('run.start.failed')
  }

  return null
})

/** The run-complete screen's view of the submission. */
const submissionView = computed<RunSubmissionView>(() => {
  if (tutorialMode) return 'local'

  switch (runSession.phase) {
    case 'retry_wait': return 'retrying'
    case 'outcome': return 'outcome'
    case 'closed': return 'closed'
    default: return 'saving'
  }
})

function retryStart(): void {
  void runSession.begin(runSession.characterId)
}

function retrySubmission(): void {
  void runSession.retryNow()
}

/**
 * The paw readout switches to `n / 200` near the threshold.
 *
 * `paw.hudThresholdProximity` is PROPOSED at 25, and the v0.3 boards show both
 * presentations — a bare count most of the time, the fraction when a bonus is
 * close enough to play for.
 *
 * **Both presentations show `loliCyclePaws`**, which is what
 * `scoring-and-progression.md` §2.3 specifies: progress toward the next bonus
 * is the thing the readout is for, and the fraction near the threshold is the
 * same number in a different dress. This showed `runPaws` until the M7 review —
 * identical until the first bonus, and then permanently wrong, because a player
 * on their second cycle saw a total that no longer had anything to do with the
 * `/ 200` they were about to see.
 */
const nearThreshold = computed(
  () => cyclePaws.value >= PROGRESS.loliThreshold - PROGRESS.hudThresholdProximity,
)

/**
 * How full the Paw counter is, as a percentage, for the desktop goal card.
 *
 * `cyclePaws` for the same reason the readout above uses it: progress toward
 * the *next* bonus is the thing being shown, and `runPaws` stops meaning that
 * the moment the first bonus lands. Clamped because a threshold crossing is
 * handled by the domain on its own clock, and a meter briefly over 100% would
 * paint outside its own track.
 */
const goalPercent = computed(
  () => Math.min(100, (cyclePaws.value / PROGRESS.loliThreshold) * 100),
)

/**
 * One key for the label, the state name never reaches the player.
 *
 * While charging the label carries the percentage, because `accessibility.md`
 * §3.1 requires the control to communicate progress and §4.1 forbids that cue
 * from resting on the fill's colour. Armed and active have no number: there is
 * nothing left to fill, and "100%" beside "ready" reads as noise.
 */
const slayyyLabel = computed(() => (
  slayyy.value === 'ready'
    ? t('run.slayyyReady')
    : slayyy.value === 'active'
      ? t('run.slayyyActive')
      : t('run.slayyyCharging', { percent: slayyyPercent.value })
))

/**
 * What a screen reader is told, and when.
 *
 * The accessible *name* changing does not announce anything — a name is read
 * when the control is reached, and a player watching the road is not on it. So
 * the two moments that matter get a polite live region of their own, and the
 * charging percentage deliberately stays out of it: announcing every tick of a
 * meter that takes a minute to fill would make the run unusable.
 */
const slayyyAnnouncement = computed(() => (
  slayyy.value === 'charging' ? '' : slayyyLabel.value
))

/**
 * Hand the keyboard back to the game after using an on-screen control.
 *
 * Gameplay keys are suppressed while a control has focus — `shouldHandleKey`
 * refuses every binding but Escape when `document.activeElement` claims
 * activation — and a `<button>` keeps focus after a click. So tapping Pause,
 * Resume or SLAYYY left the player unable to move, jump or fire until they
 * clicked the canvas, and the SLAYYY case did it for the five seconds the power
 * was running. Escape alone stayed reachable, which is why this survived M6: the
 * exemption that rescued the pause trap hid the rest of it.
 *
 * One function for all the controls rather than a per-button workaround. It
 * moves focus, never removes it, so there is no moment with nothing focused and
 * no trap — the surface is `tabindex="0"` and Tab still reaches every control
 * from there. `preventScroll` keeps the page from jumping on a short viewport,
 * and the surface's ring is `:focus-visible`, so a mouse click restores play
 * silently while a keyboard activation still shows where focus went.
 */
function returnFocusToSurface(): void {
  surface.value?.focus({ preventScroll: true })
}

/** Pause or resume, then give the keyboard back. */
function pauseFromControl(): void {
  togglePause()
  returnFocusToSurface()
}

/** Fire SLAYYY, then give the keyboard back — before the window starts running. */
function slayyyFromControl(): void {
  activateSlayyy()
  returnFocusToSurface()
}

/** Back to the menu, board 08. */
function leaveToMenu(): void {
  void navigateTo('/')
}

/** The run was accepted: see where it landed, board 15 (M10). */
function leaveToLeaderboard(): void {
  void navigateTo('/leaderboard')
}

/**
 * Leaving pauses first.
 *
 * This control used to be a link straight to the menu, one tap from the top
 * corner of a phone screen, with a live run behind it and nothing between the
 * two. Abandoning a run is not undoable — there is no revive and no continue —
 * so it should take more than a mistimed thumb.
 *
 * The confirmation is the approved pause screen rather than a dialog invented
 * for the purpose: board 12 already offers *return to menu* beside *resume*,
 * so pausing here reaches a decision the player can reverse, using UX that was
 * approved for exactly this moment.
 *
 * A run that never started is exempt. There is nothing to pause while the
 * engine is loading or after it has failed, and a control that did nothing
 * there would strand the player on a blank screen.
 */
function leaveFromControl(): void {
  if (loading.value || failed.value || isPaused.value || hasEnded.value) {
    leaveToMenu()

    return
  }

  togglePause()
}

/** Resume from the overlay. Focus returns with the dialog, not from here. */
function resumeFromOverlay(): void {
  togglePause()
}

/**
 * Play again.
 *
 * The tutorial replays itself. A normal run asks the server: a finished run
 * gets a new server run, with a new seed; a run abandoned from the pause
 * screen is still the active one, so the server resumes it and it replays
 * from its own start — which the page then says, rather than pretending it is
 * fresh.
 */
function replayRun(): void {
  if (tutorialMode) {
    void restart()

    return
  }

  runSession.acknowledge()
  void runSession.begin(runSession.characterId)
}

/* --- the tutorial ------------------------------------------------------- */

/**
 * Whether the skip confirmation is open, and how the persistence is going.
 *
 * `saveFailed` exists so the completion overlay can say so rather than routing
 * onward and pretending. The tutorial is finished when the *server* says it is.
 */
const confirmingSkip = ref(false)
const savingTutorial = ref(false)
const saveFailed = ref(false)

/** The prompt shows while a tutorial is being taught, and not once it is over. */
const showTutorialPrompt = computed(() =>
  lesson.value !== null
  && tutorialOutcome.value === null
  && !isPaused.value
  && !hasEnded.value,
)

/**
 * Ask before leaving, and stop the road while asking.
 *
 * Pausing first mirrors what leaving a run already does: a decision the player
 * can reverse should not be made against a world that is still moving, and a
 * cone arriving mid-question would be the tutorial arguing its own case.
 */
function requestSkip(): void {
  if (!isPaused.value) togglePause()

  confirmingSkip.value = true
}

function cancelSkip(): void {
  confirmingSkip.value = false

  if (isPaused.value) togglePause()

  returnFocusToSurface()
}

/**
 * Record the completion, and only then believe it.
 *
 * The store is updated **after** the request resolves, never before. Marking it
 * locally first would make PLAY stop offering the tutorial on this page load
 * and then start offering it again on the next sign-in, with nothing to explain
 * why — which is worse than the failure it would be hiding.
 *
 * Idempotent upstream, so a retry after a failure cannot double-record and
 * cannot move the stored completion.
 */
async function persistTutorialCompletion(): Promise<boolean> {
  if (savingTutorial.value) return false

  savingTutorial.value = true
  saveFailed.value = false

  try {
    await useBffClient().completeTutorial()
    auth.markTutorialCompleted()

    return true
  }
  catch {
    saveFailed.value = true

    return false
  }
  finally {
    savingTutorial.value = false
  }
}

/**
 * Confirmed the skip: tell the rules, then the server.
 *
 * The rules first, so the tutorial is terminal locally and the completion
 * overlay takes over from the prompt. The server call is the same one a
 * finished tutorial makes — skipping and finishing are the same fact, and the
 * API is deliberately not told which happened.
 */
async function confirmSkip(): Promise<void> {
  skipTutorial()
  confirmingSkip.value = false

  await persistTutorialCompletion()
}

/**
 * Into the real game, from the end of the tutorial.
 *
 * Refuses to move until the completion is actually stored. `restart()` is the
 * same full teardown and remount a replay uses — a new seed, a new run state,
 * one canvas — so nothing the tutorial did can reach the run that follows.
 */
async function playAfterTutorial(): Promise<void> {
  // A Settings replay by a player who already finished has nothing to store.
  if (!auth.tutorialCompleted && !(await persistTutorialCompletion())) return

  /*
   * `?mode=run` is explicit rather than an empty query, so the handover does
   * not depend on the store having updated first — and because the page key is
   * the query, changing it is what remounts the surface into a genuinely fresh
   * run: new seed, new run state, one canvas.
   */
  await navigateTo({ path: '/run', query: { mode: 'run' }, replace: true })
}

useHead({
  title: () => (tutorialMode ? t('tutorial.title') : t('run.title')),
})

/*
 * There is deliberately no viewport override here.
 *
 * This page used to set `maximum-scale=1, user-scalable=no`, justified as
 * stopping a pinch during a swipe from zooming the page. `.run__surface`
 * already sets `touch-action: none`, which by specification takes every
 * browser panning and zooming gesture — pinch included — away from that
 * element. So the meta bought nothing for the surface and took page zoom away
 * from everything else, including the small readouts, which are exactly what a
 * low-vision player would pinch to read. That is a WCAG 2.2 1.4.4 failure in
 * exchange for nothing.
 */

onMounted(() => {
  if (surface.value === null) return

  if (tutorialMode) {
    void start(surface.value, TUTORIAL_RUN_INIT)

    return
  }

  // Nothing mounts until the server has started the run.
  void runSession.begin(DEFAULT_CHARACTER_ID)
})

onBeforeUnmount(() => {
  stop()
  runSession.acknowledge()
})
</script>

<template>
  <div
    class="run"
    :style="{ '--run-column': `${PLAY_COLUMN_MAX_PX}px` }"
  >
    <h1 class="run__heading">
      {{ tutorialMode ? t('tutorial.title') : t('run.title') }}
    </h1>

    <!--
      An interactive surface, not a picture.

      `role="img"` declared a static graphic, made every descendant
      presentational, and — because it carries no `tabindex` — left the element
      outside the tab order. That combination locked keyboard players out: the
      pause button is a `<button>`, gameplay keys are suppressed while a control
      has focus, and there was nothing focusable to move focus back to. It is a
      focusable group now, and Escape is exempt from the focus rule, so both
      halves of that trap are gone.
    -->
    <div
      ref="surface"
      class="run__surface"
      role="group"
      tabindex="0"
      :aria-label="tutorialMode ? t('tutorial.surfaceLabel') : t('run.surfaceLabel')"
    />

    <!--
      The heads-up display.

      One overlay over the whole canvas, held to the play column so it stays
      beside the game on a wide monitor instead of drifting to the window edges.
      It takes no touches; each genuinely interactive child opts back in.

      Every readout is real text as well as a shape: `accessibility.md` §4
      requires gameplay state to exist as DOM outside the canvas, and none of it
      may rest on hue alone.
    -->
    <div class="run__readouts">
      <div class="run__hud">
        <!--
          No score during the tutorial.

          The tutorial genuinely scores — it runs inside the real rules — but
          that number is thrown away with the run state and reaches nothing.
          Showing it would be offering a result the player might reasonably
          expect to be kept, which is the "tutorial paws must not become durable
          rewards" rule expressed in the HUD rather than only in the domain.
          Hearts stay: they are never spent here, and the row proves it.
        -->
        <p v-if="!tutorialMode" class="run__score">
          <span class="run__score-label">{{ t('run.scoreLabel') }}</span>
          <span class="run__score-value">{{ score }}</span>
        </p>

        <p class="run__phase" aria-live="polite">
          {{ t(`run.phase.${phase}`) }}
        </p>
      </div>

      <div class="run__chrome">
        <!--
          A plain button with an icon and a name.

          It was a text button that read "Pause"/"Resume" in three languages of
          differing length, which is why the top strip used to reflow. The state
          is in the accessible name and in the glyph, and the glyph is two
          shapes rather than an emoji so it cannot land on a font that has none.
        -->
        <button
          v-if="!failed"
          type="button"
          class="run__pause"
          :disabled="loading || hasEnded"
          :aria-label="isPaused ? t('run.resume') : t('run.pause')"
          @click="pauseFromControl"
        >
          <svg
            class="run__pause-glyph"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path v-if="isPaused" d="M8 5.5 18.5 12 8 18.5Z" />
            <template v-else>
              <rect x="7.5" y="5.5" width="3.6" height="13" rx="1.4" />
              <rect x="13" y="5.5" width="3.6" height="13" rx="1.4" />
            </template>
          </svg>
        </button>

        <button
          type="button"
          class="run__exit"
          @click="leaveFromControl"
        >
          {{ t('run.leave') }}
        </button>
      </div>

      <div class="run__meta">
        <!--
          Hearts and Paws, the two counters v0.3 pins under the pause control.

          The heart shapes are decorative and the count beside them is the
          accessible fact. Countable shapes rather than a colour bar, and spent
          hearts are hollow rather than merely faded, so nothing here depends on
          hue.
        -->
        <p class="run__hearts">
          <span aria-hidden="true" class="run__heart-row">
            <span
              v-for="index in HEARTS.max"
              :key="index"
              class="run__heart"
              :class="{ 'run__heart--spent': index > hearts }"
            >♥</span>
          </span>
          <span class="run__hearts-count">{{ t('run.hearts', { count: hearts, max: HEARTS.max }) }}</span>
        </p>

        <!--
          And no paw counter, for a sharper version of the same reason: it
          shows `loliCyclePaws`, which is progress toward a Loli Bonus. A
          tutorial paw earns none — the cycle starts at zero and one scripted
          token cannot reach two hundred — so a counter ticking to 1 here would
          be showing progression the tutorial does not grant.
        -->
        <p v-if="!tutorialMode" class="run__paws">
          <span aria-hidden="true" class="run__paw-glyph">🐾</span>
          <span>{{ nearThreshold
            ? t('run.cycleProgress', { count: cyclePaws, total: PROGRESS.loliThreshold })
            : t('run.paws', { count: cyclePaws })
          }}</span>
        </p>
      </div>

      <!--
        The two moments the world announces.

        Centred banners rather than rows in the counter stack, because they are
        events and not state: v0.3 shows "LOLİ GELDİ!" and "SLAYYY — her şey
        güzel!" arriving over the sea, and a player who is watching the road
        sees a banner there and would not see another chip in the corner.
      -->
      <div class="run__banners">
        <p v-if="slayyy === 'active'" class="run__slayyy-state" role="status">
          <span aria-hidden="true">✨</span>
          {{ t('run.slayyyMultiplier') }}
        </p>

        <p v-if="loliActive" class="run__loli" role="status">
          <span aria-hidden="true">🐈</span>
          {{ t('run.loliActive') }}
        </p>
      </div>

      <!--
        The lesson prompt, and it belongs **inside** the readouts.

        It is the one overlay on this route that must not take the viewport: the
        player keeps playing while it is up, so it is a card in the
        pointer-inert readout layer rather than a dialog with a scrim. Being a
        child of this grid is also what holds it to the play column — as a
        sibling it would span the whole window and sit above the game.
      -->
      <RunTutorialPrompt
        v-if="showTutorialPrompt && lesson !== null"
        :lesson="lesson"
        :index="lessonIndex"
        :total="lessonTotal"
        :correction="correction"
        :attempt="correctionAttempt"
        :busy="savingTutorial"
        @skip="requestSkip"
      />

      <div class="run__foot">
        <!--
          The server run first: nothing loads until the server has started one.
          A start that could not happen says why, and offers the one action
          that can help — trying again — rather than any local fallback.
        -->
        <p v-if="startStatus !== null" class="run__status" role="status">
          {{ startStatus }}
        </p>

        <template v-else-if="startProblem !== null">
          <UiAuthNotice variant="error">
            {{ startProblem }}
          </UiAuthNotice>
          <UiAuthButton variant="secondary" class="run__start-retry" @click="retryStart">
            {{ t('run.start.retry') }}
          </UiAuthButton>
        </template>

        <p v-else-if="loading" class="run__status">
          {{ t('run.loading') }}
        </p>

        <UiAuthNotice v-else-if="failed" variant="error">
          {{ t('run.failed') }}
        </UiAuthNotice>

        <!--
          A resumed run is never presented as fresh (api-client.md §6). It
          replays from its own start on its own course, because there is no
          input log from which to restore where it was.
        -->
        <p v-else-if="!tutorialMode && runSession.resumed && !hasEnded" class="run__status run__status--resumed" role="status">
          {{ t('run.start.resumed') }}
        </p>

        <!-- A finish left from before a reload was delivered on the way here. -->
        <p v-else-if="!tutorialMode && runSession.previousDelivered !== null && !hasEnded" class="run__status" role="status">
          {{ t('run.start.previousSaved') }}
        </p>
      </div>

      <div class="run__slayyy">
        <!--
          A real button, not a bar with a tap handler.

          `accessibility.md` §3.1 is explicit: the armed control is focusable and
          labelled, and its accessible name carries both state and action. The
          meter behind it is decorative — the state is in the text, so a player
          who cannot see the fill still knows the power is available.
        -->
        <button
          type="button"
          class="run__slayyy-button"
          :class="`run__slayyy-button--${slayyy}`"
          :style="{ '--slayyy-fill': `${slayyyPercent}%` }"
          :disabled="loading || hasEnded || slayyy !== 'ready'"
          :aria-label="slayyyLabel"
          @click="slayyyFromControl"
        >
          <span aria-hidden="true" class="run__slayyy-mark">✨</span>
          <span class="run__slayyy-text">{{ slayyyLabel }}</span>
        </button>

        <!--
          The global `sr-only` utility, not a page-local copy: this is exactly the
          case `base.css` documents it for — live-region text a screen reader
          needs and the design does not show.
        -->
        <p class="sr-only" role="status">
          {{ slayyyAnnouncement }}
        </p>
      </div>
    </div>

    <!--
      The two screens that interrupt a run.

      Siblings of the readouts rather than children of them: `.run__readouts` is
      clamped to the play column and takes no pointer events, so an overlay
      inside it would leave the seaside either side of the column live to
      touches, and a scrim that lets gameplay gestures through is not a scrim.
      These cover the viewport and take the taps; their panels are held to the
      column.

      `v-if` on the phase, so the overlay is mounted exactly when the domain
      says so and unmounted the moment it does not — which is what makes focus
      move in and back out without anything having to remember to do it.
    -->
    <!--
      The skip confirmation, however, *should* stop play — so it is a dialog,
      and it is mounted before the pause overlay so that pausing to ask the
      question does not also raise board 12 behind it.
    -->
    <RunTutorialSkipConfirm
      v-if="confirmingSkip"
      :busy="savingTutorial"
      :restore-focus-to="surface"
      @confirm="confirmSkip"
      @cancel="cancelSkip"
    />

    <RunTutorialCompleteOverlay
      v-else-if="tutorialOutcome !== null"
      :outcome="tutorialOutcome"
      :busy="savingTutorial"
      :failed="saveFailed"
      :restore-focus-to="surface"
      @play="playAfterTutorial"
      @menu="leaveToMenu"
    />

    <RunPauseOverlay
      v-if="isPaused && !confirmingSkip && tutorialOutcome === null"
      :score="score"
      :restore-focus-to="surface"
      @resume="resumeFromOverlay"
      @restart="replayRun"
      @menu="leaveToMenu"
    />

    <RunCompleteOverlay
      v-if="hasEnded"
      :score="score"
      :paws="runPaws"
      :busy="loading || runSession.busy"
      :submission="submissionView"
      :outcome="runSession.outcome"
      :restore-focus-to="surface"
      @replay="replayRun"
      @menu="leaveToMenu"
      @retry="retrySubmission"
      @leaderboard="leaveToLeaderboard"
    />

    <!--
      The desktop side cards.

      v0.3's desktop board puts exactly two things in the space beside the play
      column — the keyboard bindings on the left and the next goal on the right —
      and lets the seaside fill everything else. They are part of the same
      picture rather than a panel bolted to its edge, so they float on the
      promenade with no rail behind them, and they do not exist at all on a
      screen narrow enough for the column to fill it.
    -->
    <aside class="run__aside run__aside--keys" :aria-label="t('run.keysTitle')">
      <p class="run__aside-title">
        {{ t('run.keysTitle') }}
      </p>
      <ul class="run__keys">
        <li>{{ t('run.keysLanes') }}</li>
        <li>{{ t('run.keysJump') }}</li>
        <li>{{ t('run.keysSlayyy') }}</li>
        <li>{{ t('run.keysPause') }}</li>
      </ul>
    </aside>

    <!--
      The goal card renders `cycleProgress`, so it is hidden for the same reason
      the paw counter is: during the tutorial it would name a Loli Bonus the
      player is not making progress toward. The keyboard legend beside it stays
      — it is the one aside that is *more* useful while learning the keys.
    -->
    <aside v-if="!tutorialMode" class="run__aside run__aside--goal" :aria-label="t('run.nextGoalTitle')">
      <p class="run__aside-title">
        {{ t('run.nextGoalTitle') }}
      </p>
      <p class="run__goal-value">
        <span aria-hidden="true">🐾</span>
        {{ t('run.cycleProgress', { count: cyclePaws, total: PROGRESS.loliThreshold }) }}
      </p>

      <!--
        The fill is a second reading of the number above it, never the only one.
        `accessibility.md` §4 wants the fact in text and forbids it resting on
        colour, so this is decorative and hidden — remove it and the card still
        says exactly how many Paw Tokens are left.
      -->
      <div
        class="run__goal-meter"
        aria-hidden="true"
        :style="{ '--goal-fill': `${goalPercent}%` }"
      />

      <p class="run__goal-note">
        {{ t('run.nextGoalNote') }}
      </p>
    </aside>
  </div>
</template>

<style scoped>
.run {
  position: relative;
  min-block-size: 100dvh;
  overflow: hidden;

  /*
   * The page ground is the sea's own colour, not a gradient standing in for
   * one. Everything a player sees is painted on the canvas; this exists only
   * for the moment before Phaser's first frame and for the strip a browser
   * paints under an overscroll bounce.
   */
  background: var(--color-sky-soft);

  /*
   * No pull-to-refresh anywhere on this page.
   *
   * `touch-action: none` covers the play surface, but the overlay sits above it
   * with its own stacking context and no touch-action of its own — so a
   * downward drag starting on the top strip reached the browser's overscroll
   * gesture and reloaded the run away. The milestone's own acceptance criterion
   * names refresh alongside scroll and zoom.
   */
  overscroll-behavior: none;

  /* Half the play column, for placing the desktop side cards against it. */
  --run-column-half: calc(min(100vw, var(--run-column)) / 2);
}

/*
 * The page needs a heading, and the canvas cannot be one.
 *
 * Visually hidden rather than absent: `layout: false` means this route bypasses
 * the shell that provides the app's only `<main>`, so without it a screen
 * reader arrives at four nested divs with nothing to orient by.
 */
.run__heading {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.run__surface {
  position: absolute;
  inset: 0;

  /*
   * The canvas owns its gestures. Without this the browser claims a vertical
   * swipe as a scroll and a horizontal one as a back-navigation, and neither
   * ever reaches the game.
   */
  touch-action: none;
  overscroll-behavior: none;
  user-select: none;
  -webkit-user-select: none;
}

/*
 * The global ring sits 2px *outside* its element. This one fills the viewport,
 * so an outside ring would be drawn off-screen and a keyboard player would have
 * no idea the surface had focus. Same width and colour, turned inwards.
 */
.run__surface:focus-visible {
  outline: 3px solid var(--color-ink);
  outline-offset: -3px;
  border-radius: 0;
}

/*
 * The overlay.
 *
 * Held to the play column, not the viewport: the playfield caps at the approved
 * column width and lets the seaside expand decoratively around it. Letting the
 * readouts span the whole window put them seven hundred pixels from the game on
 * a wide monitor, out in the decorative area, while the player's attention was
 * on the centre.
 *
 * It takes no touches, and the rule is on the container rather than on each
 * row: `.run__surface` is `position: absolute; inset: 0`, so the canvas is the
 * whole viewport and every readout is painted *over* the playfield. Without
 * this, each one is also a hit target — a touch starting on it has that element
 * as its `event.target`, Phaser's `pointerdown` only fires when the target is
 * the canvas, and the gesture never begins. At 360x640 that made roughly the
 * top quarter and the bottom third of the screen dead to swipes, including the
 * strip a thumb naturally rests on. Keyboard play was unaffected, which is why
 * it went unnoticed through two milestones. Anything added here is inert until
 * someone says otherwise, which is the safe default for a layer over a game.
 */
.run__readouts {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;

  inline-size: min(100%, var(--run-column));
  margin-inline: auto;

  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto auto 1fr auto auto auto;
  grid-template-areas:
    "score    .        chrome"
    ".        .        meta"
    "banners  banners  banners"
    "tutorial tutorial tutorial"
    "foot     foot     foot"
    "slayyy   slayyy   slayyy";
  gap: var(--space-2);

  padding:
    calc(env(safe-area-inset-top) + var(--space-2))
    var(--space-3)
    calc(env(safe-area-inset-bottom) + var(--space-3));
}

.run__exit,
.run__pause,
.run__slayyy-button {
  pointer-events: auto;
}

/* --- the score card, top left ------------------------------------------- */

.run__hud {
  grid-area: score;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
  min-inline-size: 0;
}

/*
 * v0.3's score card: ink, generous radius, a small gold caption over a large
 * cream number. It is the only dark shape in the display, which is what makes
 * the score the first thing read on a bright promenade.
 */
.run__score {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 0;
  padding: var(--space-1) var(--space-3) var(--space-2);
  border-radius: var(--radius-lg);
  background: var(--color-ink);
  box-shadow: var(--elevation-card);
}

.run__score-label {
  font-size: var(--type-micro);
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-yellow);
}

.run__score-value {
  font-family: var(--font-display);
  font-size: 1.6rem;
  line-height: 1.1;
  font-weight: 800;
  color: var(--color-cream);
  /* Tabular figures, so a rising score does not jitter the card's width. */
  font-variant-numeric: tabular-nums;
}

.run__phase {
  margin: 0;
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--color-cream) 82%, transparent);
  font-size: var(--type-micro);
  font-weight: 700;
  color: var(--color-ink);
}

/* --- pause and exit, top right ------------------------------------------- */

.run__chrome {
  grid-area: chrome;
  justify-self: end;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.run__pause {
  display: grid;
  place-items: center;
  inline-size: var(--touch-min);
  block-size: var(--touch-min);
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--color-cream);
  box-shadow: var(--elevation-card);
  color: var(--color-ink);
  cursor: pointer;
  touch-action: manipulation;
}

.run__pause:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.run__pause-glyph {
  inline-size: 20px;
  block-size: 20px;
  fill: currentcolor;
}

.run__exit {
  display: inline-flex;
  align-items: center;

  /* It is a `<button>` now, so it has a border and a font to unset. */
  border: none;
  cursor: pointer;
  font-family: inherit;

  /*
   * The label carries a leading arrow. Inside a flex container its intrinsic
   * width came out a few pixels under the text's own, so the arrow wrapped onto
   * a line of its own.
   */
  white-space: nowrap;
  min-block-size: var(--touch-min);
  padding-inline: var(--space-2);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--color-cream) 82%, transparent);
  font-size: var(--type-micro);
  font-weight: 700;
  color: var(--color-ink);
}

/* --- hearts and paws, under the pause control ---------------------------- */

.run__meta {
  grid-area: meta;
  justify-self: end;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-1);
  min-inline-size: 0;
}

.run__hearts,
.run__paws {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--color-cream);
  box-shadow: var(--elevation-card);
  font-size: var(--type-micro);
  font-weight: 700;
  color: var(--color-ink);
}

.run__heart-row {
  display: inline-flex;
  gap: 2px;
}

.run__heart {
  color: var(--color-coral);
  font-size: 1.15em;
  line-height: 1;
}

/* Hollow, not merely faded: the difference must survive a greyscale display. */
.run__heart--spent {
  color: transparent;
  -webkit-text-stroke: 1px var(--color-border);
}

.run__hearts-count {
  font-variant-numeric: tabular-nums;
}

.run__paw-glyph {
  font-size: 1.1em;
}

/* --- the banners --------------------------------------------------------- */

.run__banners {
  grid-area: banners;
  align-self: start;
  justify-self: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  max-inline-size: 100%;
}

.run__loli,
.run__slayyy-state {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-pill);
  font-size: var(--type-caption);
  font-weight: 800;
  color: var(--color-ink);
  text-align: center;
  box-shadow: var(--elevation-card);
}

.run__slayyy-state {
  background: var(--color-pink);
  border: 2px solid var(--color-pink-deep);
}

.run__loli {
  background: var(--color-pink-soft);
  border: 2px solid var(--color-pink);
}

/* --- the foot and the meter ---------------------------------------------- */

.run__foot {
  grid-area: foot;
  /* Laid out even when empty, so nothing below it shifts when a status
     appears — and so the touch-transparency check has a box to aim at. */
  min-block-size: var(--space-2);
}

.run__status {
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-cream) 92%, transparent);
  font-size: var(--type-caption);
  color: var(--color-ink);
  text-align: center;
  box-shadow: var(--elevation-card);
}

.run__slayyy {
  grid-area: slayyy;
  align-self: end;
}

/*
 * The activation control.
 *
 * Three states, and each is distinguishable without colour: charging is
 * outlined and quiet, ready is filled and carries the sparkle, active is
 * filled and says so. The text changes in every state, which is what a screen
 * reader and a greyscale display both rely on.
 */
.run__slayyy-button {
  /*
   * The fill is a background layer, and it is deliberately the *second* cue.
   * `accessibility.md` §4.1 requires the meter to be readable without relying
   * on colour, so the percentage is in the label and this only reinforces it —
   * remove the fill entirely and the control still tells you where it is.
   */
  background-image: linear-gradient(
    to right,
    var(--color-pink) 0 var(--slayyy-fill, 0%),
    transparent var(--slayyy-fill, 0%)
  );
  background-repeat: no-repeat;

  /*
   * No double-tap zoom, no drag-scroll from the control.
   *
   * The surface sets `touch-action: none`; the button is its sibling and
   * inherits nothing. Two quick presses — which is exactly what a player does
   * when the first appears not to fire — zoomed the page mid-run, and a finger
   * that drifted vertically scrolled it. `manipulation` keeps the tap and drops
   * the gestures nobody asked for.
   */
  touch-action: manipulation;

  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  inline-size: 100%;
  min-block-size: var(--touch-min);
  padding: 0 var(--space-4);
  border: 2px solid var(--color-cream);
  border-radius: var(--radius-pill);
  /* `background-color`, never the shorthand: the shorthand would reset the
     fill layer declared above and the meter would silently stop showing. */
  background-color: color-mix(in srgb, var(--color-cream) 88%, transparent);
  box-shadow: var(--elevation-card);
  /*
   * Ink, not `--text-secondary`.
   *
   * The muted grey is 3.81:1 on the page and 3.34:1 over a filled meter, and
   * this is small bold text — WCAG 2.2 1.4.3 wants 4.5:1 and neither figure
   * reaches it. Ink is 13.4:1 and 11.7:1 respectively. The disabled state is
   * carried by the border, the fill and the word "charging", none of which
   * needs the text to be hard to read.
   */
  color: var(--color-ink);
  font: inherit;
  font-size: var(--type-caption);
  font-weight: 800;
  letter-spacing: 0.04em;
  cursor: not-allowed;
  transition: background var(--motion-base) var(--ease-out),
    color var(--motion-base) var(--ease-out),
    border-color var(--motion-base) var(--ease-out);
}

.run__slayyy-button--ready {
  border-color: var(--color-pink-deep);
  /* `background`, not `background-color`: the shorthand clears the fill layer,
     which is at 100% here and would otherwise draw over the flat colour. */
  background: var(--color-pink);
  color: var(--color-ink);
  cursor: pointer;
}

.run__slayyy-button--active {
  border-color: var(--color-lilac);
  /* Same reason as above: the meter is spent, and the shorthand clears it. */
  background: var(--color-lilac);
  color: var(--color-ink);
}

.run__slayyy-mark {
  font-size: 1.15em;
}

.run__slayyy-button:disabled {
  opacity: 0.92;
}

/* --- the desktop side cards ---------------------------------------------- */

.run__aside {
  display: none;
}

/*
 * Game UI, not web cards.
 *
 * They were a diffuse `--elevation-card` shadow under body text with no border,
 * which is the shape of every panel on every website. The app's own idiom —
 * v0.3's buttons and panels, and `--elevation-button` in the token file — is a
 * *solid pressed rim* under a soft shadow, with Baloo 2 on the label. Same
 * size, same place, same content; it just belongs to the same product as the
 * thing it is sitting next to now.
 *
 * `box-sizing: border-box` is global, so the border cannot widen them and the
 * geometry that keeps them out of the protected column is unchanged.
 */
@media (min-width: 1024px) {
  .run__aside {
    position: absolute;
    z-index: 1;
    display: block;
    inset-block-end: 7vh;
    inline-size: min(16rem, calc(50vw - var(--run-column-half) - 3rem));
    padding: var(--space-3) var(--space-4) var(--space-4);
    border: 2px solid var(--color-cream);
    border-radius: var(--radius-lg);
    pointer-events: none;
  }

  /*
   * Anchored to the column rather than to the window, so the gap beside the
   * playfield is the same at 1024px and at 2560px and neither card ever drifts
   * over the game.
   */
  .run__aside--keys {
    inset-inline-end: calc(50% + var(--run-column-half) + 1.5rem);
    background: color-mix(in srgb, var(--color-cream) 92%, transparent);
    box-shadow: 0 4px 0 var(--color-turquoise-soft), var(--elevation-card);
  }

  .run__aside--goal {
    inset-inline-start: calc(50% + var(--run-column-half) + 1.5rem);
    border-color: var(--color-pink);
    background: color-mix(in srgb, var(--color-pink-soft) 94%, transparent);
    box-shadow: 0 4px 0 var(--color-pink-deep), var(--elevation-card);
  }
}

/*
 * Ink, not `--color-pink-deep`.
 *
 * The pink label looked right and measured 3.07:1 on cream and 2.69:1 on
 * pink-soft. This is 11px, so WCAG 2.2 1.4.3 wants 4.5:1 and it is nowhere
 * near — the same failure `accessibility.md` §5A records for the locked
 * tokens, reintroduced by a new component. Ink is 13.4:1 and 11.7:1. The
 * card's identity is carried by its rim, its border and its ground, none of
 * which anyone has to read.
 */
.run__aside-title {
  margin: 0 0 var(--space-2);
  font-family: var(--font-display);
  font-size: var(--type-micro);
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-ink);
}

.run__keys {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: var(--space-1);
  font-size: var(--type-caption);
  font-weight: 700;
  color: var(--color-ink);
}

.run__keys li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/*
 * A brand marker rather than a bullet glyph. Empty content with a background,
 * so there is nothing for a screen reader to read out and nothing that depends
 * on a font having the character.
 */
.run__keys li::before {
  content: '';
  flex: none;
  inline-size: 6px;
  block-size: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-turquoise);
}

.run__goal-value {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-body-lg);
  font-weight: 800;
  color: var(--color-ink);
  font-variant-numeric: tabular-nums;
}

/*
 * The same fill idiom as the SLAYYY control, at a quarter of the height.
 *
 * Decorative and `aria-hidden`: the count above it is the fact, and
 * `accessibility.md` §4.1 forbids the progress resting on a colour. It is here
 * because "128 / 200" on its own is a line of text, and the card's job is to
 * be a glanceable target while the player is looking somewhere else.
 */
.run__goal-meter {
  block-size: 6px;
  margin-block: var(--space-2) 0;
  border-radius: var(--radius-pill);
  background-color: color-mix(in srgb, var(--color-white) 70%, transparent);
  background-image: linear-gradient(
    to right,
    var(--color-pink-deep) 0 var(--goal-fill, 0%),
    transparent var(--goal-fill, 0%)
  );
  background-repeat: no-repeat;
}

/* Ink for the same reason as the title above: 2.69:1 is not a readable line. */
.run__goal-note {
  margin: var(--space-2) 0 0;
  font-size: var(--type-micro);
  font-weight: 700;
  color: var(--color-ink);
}
</style>
