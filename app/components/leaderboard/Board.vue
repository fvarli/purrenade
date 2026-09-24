<script setup lang="ts">
import { useLeaderboardStore } from '~/stores/leaderboard'
import type { LeaderboardEntry, LeaderboardWindow } from '~/types/leaderboard'

/**
 * Board 15 — the leaderboard (M10).
 *
 * Two tabs, **Bu Hafta** (the default) and **Tüm Zamanlar**; a podium for the
 * top three with 👑 on #1; the ranked rows; and the player's own entry pinned
 * at the foot as "SEN ⭐", with its true rank — or a line saying they have no
 * score in this window yet.
 *
 * **Every number here is the server's.** Ranks, scores and the own entry are
 * shown exactly as the API computed them; nothing is sorted, ranked or
 * adjusted in the browser. A board is live while it is paged, so ranks across
 * "load more" may skip — never repeat — and the refresh action starts again
 * from the top rather than papering over it.
 *
 * The avatar is a placeholder: the player's initial in a circle. There is no
 * avatar system yet (SI-6), and the initial is upper-cased in the viewer's
 * locale, so a Turkish `i` becomes `İ`.
 *
 * Accessibility, at M10's baseline: a real tablist with roving focus and arrow
 * keys, ordered lists whose item numbers are the server's ranks, the crown
 * named rather than left as an emoji, and every state announced.
 */

const WINDOWS: readonly LeaderboardWindow[] = ['weekly', 'all_time']

const { t, locale } = useI18n()
const board = useLeaderboardStore()

const tabIds = { weekly: useId(), all_time: useId() } as Record<LeaderboardWindow, string>
const panelId = useId()
const tabRefs = ref<HTMLButtonElement[]>([])

const numberFormat = computed(() => new Intl.NumberFormat(locale.value))

/** The top three, when this page starts at the top of the board. */
const podium = computed(() => board.entries.filter(entry => entry.rank <= 3))
const rows = computed(() => board.entries.filter(entry => entry.rank > 3))

/** v0.3 draws the podium 2 · 1 · 3. The list stays in rank order for readers. */
function podiumPlace(rank: number): string {
  return `leaderboard__podium-place--${rank}`
}

function initial(entry: LeaderboardEntry): string {
  const first = Array.from(entry.display_name.trim())[0] ?? '?'

  return first.toLocaleUpperCase(locale.value)
}

function score(value: number): string {
  return numberFormat.value.format(value)
}

function tabLabel(tab: LeaderboardWindow): string {
  return t(tab === 'weekly' ? 'leaderboard.tabs.weekly' : 'leaderboard.tabs.allTime')
}

async function choose(tab: LeaderboardWindow): Promise<void> {
  await board.select(tab)
}

/** Arrow keys move between the two tabs and select, as a tablist should. */
async function onTabKey(event: KeyboardEvent, index: number): Promise<void> {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0

  if (step === 0) return

  event.preventDefault()

  const next = (index + step + WINDOWS.length) % WINDOWS.length

  tabRefs.value[next]?.focus()
  await choose(WINDOWS[next]!)
}

async function refreshToTop(): Promise<void> {
  globalThis.scrollTo?.({ top: 0, behavior: 'smooth' })
  await board.refresh()
}

onMounted(() => {
  void board.load('weekly')
})

onBeforeUnmount(() => {
  board.reset()
})
</script>

<template>
  <section class="leaderboard">
    <div class="leaderboard__tabs" role="tablist" :aria-label="t('leaderboard.tabs.label')">
      <button
        v-for="(tab, index) in WINDOWS"
        :id="tabIds[tab]"
        :key="tab"
        ref="tabRefs"
        type="button"
        role="tab"
        class="leaderboard__tab"
        :class="{ 'leaderboard__tab--selected': board.currentWindow === tab }"
        :aria-selected="board.currentWindow === tab ? 'true' : 'false'"
        :aria-controls="panelId"
        :tabindex="board.currentWindow === tab ? 0 : -1"
        @click="choose(tab)"
        @keydown="onTabKey($event, index)"
      >
        {{ tabLabel(tab) }}
      </button>
    </div>

    <div
      :id="panelId"
      class="leaderboard__panel"
      role="tabpanel"
      :aria-labelledby="tabIds[board.currentWindow]"
      :aria-busy="board.status === 'loading' ? 'true' : 'false'"
    >
      <p v-if="board.status === 'loading' || board.status === 'idle'" class="leaderboard__state" role="status">
        {{ t('leaderboard.loading') }}
      </p>

      <div v-else-if="board.status === 'error'" class="leaderboard__state">
        <UiAuthNotice variant="error">{{ t('leaderboard.error') }}</UiAuthNotice>
        <UiAuthButton variant="secondary" class="leaderboard__retry" @click="board.refresh()">
          {{ t('leaderboard.retry') }}
        </UiAuthButton>
      </div>

      <p v-else-if="board.entries.length === 0" class="leaderboard__state leaderboard__empty" role="status">
        {{ t(board.currentWindow === 'weekly' ? 'leaderboard.empty.weekly' : 'leaderboard.empty.allTime') }}
      </p>

      <template v-else>
        <ol v-if="podium.length > 0" class="leaderboard__podium" :aria-label="t('leaderboard.podium')">
          <li
            v-for="entry in podium"
            :key="`podium-${entry.rank}-${entry.display_name}`"
            :value="entry.rank"
            class="leaderboard__podium-place"
            :class="[podiumPlace(entry.rank), { 'leaderboard__entry--self': entry.is_self }]"
          >
            <span
              v-if="entry.rank === 1"
              class="leaderboard__crown"
              role="img"
              :aria-label="t('leaderboard.crown')"
            >👑</span>
            <span class="leaderboard__avatar leaderboard__avatar--large" aria-hidden="true">{{ initial(entry) }}</span>
            <span class="leaderboard__podium-rank">{{ t('leaderboard.rank', { rank: entry.rank }) }}</span>
            <span class="leaderboard__name">
              {{ entry.display_name }}<span v-if="entry.is_self" class="leaderboard__star" :aria-label="t('leaderboard.you')" role="img"> ⭐</span>
            </span>
            <span class="leaderboard__score">{{ score(entry.score) }}</span>
          </li>
        </ol>

        <ol v-if="rows.length > 0" class="leaderboard__list" :aria-label="t('leaderboard.list')">
          <li
            v-for="entry in rows"
            :key="`row-${entry.rank}-${entry.display_name}`"
            :value="entry.rank"
            class="leaderboard__row"
            :class="{ 'leaderboard__entry--self': entry.is_self }"
          >
            <span class="leaderboard__rank">{{ entry.rank }}</span>
            <span class="leaderboard__avatar" aria-hidden="true">{{ initial(entry) }}</span>
            <span class="leaderboard__name">
              {{ entry.display_name }}<span v-if="entry.is_self" class="leaderboard__star" :aria-label="t('leaderboard.you')" role="img"> ⭐</span>
            </span>
            <span class="leaderboard__score">{{ score(entry.score) }}</span>
          </li>
        </ol>

        <div class="leaderboard__more">
          <UiAuthNotice v-if="board.moreProblem !== null" variant="error">{{ t('leaderboard.loadMoreFailed') }}</UiAuthNotice>

          <UiAuthButton
            v-if="board.hasMore"
            variant="secondary"
            class="leaderboard__load-more"
            :busy="board.loadingMore"
            :busy-label="t('leaderboard.loadingMore')"
            @click="board.loadMore()"
          >
            {{ t('leaderboard.loadMore') }}
          </UiAuthButton>

          <UiAuthButton variant="quiet" class="leaderboard__refresh" @click="refreshToTop()">
            {{ t('leaderboard.refresh') }}
          </UiAuthButton>
        </div>
      </template>
    </div>

    <!-- The player's own entry, pinned. Shown whenever the board has loaded. -->
    <aside
      v-if="board.status === 'ready'"
      class="leaderboard__own"
      :aria-label="t('leaderboard.ownLabel')"
    >
      <template v-if="board.ownEntry !== null">
        <span class="leaderboard__you">{{ t('leaderboard.you') }}</span>
        <span class="leaderboard__rank">{{ t('leaderboard.rank', { rank: board.ownEntry.rank }) }}</span>
        <span class="leaderboard__avatar" aria-hidden="true">{{ initial(board.ownEntry) }}</span>
        <span class="leaderboard__name">
          {{ board.ownEntry.display_name }}<span class="leaderboard__star" aria-hidden="true"> ⭐</span>
        </span>
        <span class="leaderboard__score">{{ score(board.ownEntry.score) }}</span>
      </template>
      <p v-else class="leaderboard__own-empty">
        {{ t(board.currentWindow === 'weekly' ? 'leaderboard.ownEmpty.weekly' : 'leaderboard.ownEmpty.allTime') }}
      </p>
    </aside>
  </section>
</template>

<style scoped>
.leaderboard { display: grid; gap: var(--space-4); }

.leaderboard__tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-1);
  padding: var(--space-1);
  border-radius: var(--radius-pill);
  background: var(--bg-field);
  box-shadow: var(--elevation-card);
}

.leaderboard__tab {
  min-height: var(--touch-min);
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.leaderboard__tab--selected { background: var(--color-coral); color: var(--color-white); }
.leaderboard__tab:focus-visible { outline: 3px solid var(--color-ink); outline-offset: 2px; }

.leaderboard__panel { display: grid; gap: var(--space-4); }
.leaderboard__state { display: grid; gap: var(--space-3); justify-items: center; text-align: center; padding: var(--space-6) var(--space-4); }

.leaderboard__podium {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: end;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.leaderboard__podium-place {
  display: grid;
  justify-items: center;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-2);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--elevation-card);
  text-align: center;
  min-width: 0;
}

.leaderboard__podium-place--1 { order: 2; padding-block: var(--space-6); background: var(--color-yellow); }
.leaderboard__podium-place--2 { order: 1; }
.leaderboard__podium-place--3 { order: 3; }

.leaderboard__crown { font-size: var(--type-title); line-height: 1; }
.leaderboard__podium-rank { font-size: var(--type-caption); font-weight: 800; }

.leaderboard__list {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.leaderboard__row, .leaderboard__own {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--touch-min);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--elevation-card);
}

.leaderboard__entry--self { outline: 3px solid var(--color-coral); outline-offset: -3px; }

.leaderboard__rank { min-width: 2ch; font-weight: 800; font-variant-numeric: tabular-nums; }

.leaderboard__avatar {
  display: grid;
  place-items: center;
  inline-size: 2.25rem;
  block-size: 2.25rem;
  border-radius: var(--radius-pill);
  background: var(--color-turquoise-soft);
  color: var(--color-ink);
  font-weight: 800;
}

.leaderboard__avatar--large { inline-size: 3rem; block-size: 3rem; font-size: var(--type-body-lg); }

.leaderboard__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; max-inline-size: 100%; }
.leaderboard__score { font-family: var(--font-display); font-weight: 800; font-variant-numeric: tabular-nums; }

.leaderboard__more { display: grid; gap: var(--space-2); }

.leaderboard__own {
  position: sticky;
  bottom: var(--space-2);
  grid-template-columns: auto auto auto minmax(0, 1fr) auto;
  background: var(--color-ink);
  color: var(--color-cream);
}

.leaderboard__own .leaderboard__avatar { background: var(--color-yellow); }
.leaderboard__you { padding: 0 var(--space-2); border-radius: var(--radius-pill); background: var(--color-coral); color: var(--color-white); font-size: var(--type-caption); font-weight: 800; }
.leaderboard__own-empty { grid-column: 1 / -1; margin: 0; text-align: center; }
</style>
