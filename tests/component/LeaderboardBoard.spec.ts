import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import LeaderboardBoard from '~/components/leaderboard/Board.vue'
import { BffError } from '~/composables/useBffClient'
import type { LeaderboardEntry, LeaderboardPage, LeaderboardWindow } from '~/types/leaderboard'

/**
 * Board 15 (M10), mounted against a stubbed BFF client.
 *
 * Behaviour, not copy: translations are the harness's key echo. What matters
 * is that every state has a screen, that the numbers shown are the server's,
 * that the player's own entry is always pinned with its server rank, and the
 * baseline semantics — a real tablist, ordered lists whose numbers are the
 * ranks, a crown that is named rather than decorative.
 */

function entry(rank: number, overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return { rank, display_name: `player${rank}`, score: 10_000 - rank * 100, is_self: false, ...overrides }
}

function page(window: LeaderboardWindow, entries: LeaderboardEntry[], overrides: Partial<LeaderboardPage> = {}): LeaderboardPage {
  return {
    window,
    period: window === 'weekly' ? { starts_at: '2026-09-20T21:00:00.000Z', ends_at: '2026-09-27T21:00:00.000Z' } : null,
    data: entries,
    own_entry: null,
    meta: { next_cursor: null, has_more: false },
    ...overrides,
  }
}

let leaderboard: ReturnType<typeof vi.fn>
let locale: ReturnType<typeof ref<string>>

function translate(key: string, values?: Record<string, unknown>): string {
  if (!values) return key

  return `${key}(${Object.entries(values).map(([n, v]) => `${n}=${String(v)}`).join(',')})`
}

function render() {
  return mount(LeaderboardBoard, {
    attachTo: document.body,
    global: {
      stubs: {
        UiAuthButton: {
          inheritAttrs: false,
          props: ['busy', 'busyLabel', 'variant'],
          template: '<button v-bind="$attrs" :aria-busy="busy ? \'true\' : \'false\'"><slot v-if="!busy" /><template v-else>{{ busyLabel }}</template></button>',
        },
        UiAuthNotice: { template: '<p role="alert"><slot /></p>' },
      },
    },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  leaderboard = vi.fn()
  locale = ref('tr')
  ;(globalThis as Record<string, unknown>).useBffClient = () => ({ leaderboard })
  ;(globalThis as Record<string, unknown>).useI18n = () => ({ t: translate, te: () => true, locale, locales: ref([]), setLocale: () => {} })
  vi.stubGlobal('scrollTo', vi.fn())
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('states', () => {
  it('shows a loading state until the first page arrives', async () => {
    let release: (value: LeaderboardPage) => void = () => {}
    leaderboard.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve
    }))

    const board = render()
    await board.vm.$nextTick()

    expect(board.get('[role="tabpanel"]').attributes('aria-busy')).toBe('true')
    expect(board.get('.leaderboard__state[role="status"]').text()).toBe('leaderboard.loading')

    release(page('weekly', [entry(1)]))
    await flushPromises()

    expect(board.find('.leaderboard__state').exists()).toBe(false)
    expect(leaderboard).toHaveBeenCalledWith('weekly')
  })

  it('shows an empty board honestly, per window', async () => {
    leaderboard.mockResolvedValueOnce(page('weekly', []))
    const board = render()
    await flushPromises()

    expect(board.get('.leaderboard__empty').text()).toBe('leaderboard.empty.weekly')
    expect(board.find('.leaderboard__podium').exists()).toBe(false)
    expect(board.get('.leaderboard__own-empty').text()).toBe('leaderboard.ownEmpty.weekly')
  })

  it('shows a failure with a retry that loads again', async () => {
    leaderboard
      .mockRejectedValueOnce(new BffError({ type: 'x', title: 'x', status: 502, detail: 'x', code: 'bff_upstream_unavailable' }))
      .mockResolvedValueOnce(page('weekly', [entry(1)]))
    const board = render()
    await flushPromises()

    expect(board.get('[role="alert"]').text()).toBe('leaderboard.error')
    expect(board.find('.leaderboard__own').exists()).toBe(false)

    await board.get('.leaderboard__retry').trigger('click')
    await flushPromises()

    expect(leaderboard).toHaveBeenCalledTimes(2)
    expect(board.findAll('.leaderboard__podium li')).toHaveLength(1)
  })
})

describe('a populated board', () => {
  const TOP = [
    entry(1, { display_name: 'ilker', score: 5847 }),
    entry(2, { display_name: 'aysenur', is_self: true }),
    entry(3),
    entry(4),
    entry(5),
  ]

  it('puts the top three on a podium, with a named crown on #1 only', async () => {
    leaderboard.mockResolvedValueOnce(page('weekly', TOP))
    const board = render()
    await flushPromises()

    const podium = board.get('ol.leaderboard__podium')
    const places = podium.findAll('li')

    expect(places.map(li => li.attributes('value'))).toEqual(['1', '2', '3'])
    expect(podium.findAll('.leaderboard__crown')).toHaveLength(1)
    expect(places[0]!.get('.leaderboard__crown').attributes()).toMatchObject({ role: 'img', 'aria-label': 'leaderboard.crown' })
  })

  it('lists the rest in an ordered list numbered by the server\'s ranks', async () => {
    leaderboard.mockResolvedValueOnce(page('weekly', TOP))
    const board = render()
    await flushPromises()

    const rows = board.get('ol.leaderboard__list').findAll('li')

    expect(rows.map(li => li.attributes('value'))).toEqual(['4', '5'])
    expect(rows.map(li => li.get('.leaderboard__rank').text())).toEqual(['4', '5'])
  })

  it('formats scores in the viewer\'s locale and never recomputes them', async () => {
    leaderboard.mockResolvedValueOnce(page('weekly', TOP))
    const board = render()
    await flushPromises()

    expect(board.get('.leaderboard__podium-place--1 .leaderboard__score').text()).toBe('5.847')
  })

  it('upper-cases the initial in the viewer\'s locale: a Turkish i becomes İ', async () => {
    leaderboard.mockResolvedValueOnce(page('weekly', TOP))
    const board = render()
    await flushPromises()

    expect(board.get('.leaderboard__podium-place--1 .leaderboard__avatar').text()).toBe('İ')
    expect(board.get('.leaderboard__podium-place--1 .leaderboard__avatar').attributes('aria-hidden')).toBe('true')
  })

  it('upper-cases the same initial as I in English', async () => {
    locale.value = 'en'
    leaderboard.mockResolvedValueOnce(page('weekly', TOP))
    const board = render()
    await flushPromises()

    expect(board.get('.leaderboard__podium-place--1 .leaderboard__avatar').text()).toBe('I')
  })

  it('marks the player\'s own row with the self treatment and a named star', async () => {
    leaderboard.mockResolvedValueOnce(page('weekly', TOP))
    const board = render()
    await flushPromises()

    const self = board.findAll('.leaderboard__entry--self')

    expect(self).toHaveLength(1)
    expect(self[0]!.text()).toContain('aysenur')
    expect(self[0]!.get('.leaderboard__star').attributes()).toMatchObject({ role: 'img', 'aria-label': 'leaderboard.you' })
  })
})

describe('the pinned own entry', () => {
  it('shows SEN with the server\'s rank, even when far outside the page', async () => {
    leaderboard.mockResolvedValueOnce(page('all_time', [entry(1), entry(2)], {
      own_entry: entry(1234, { display_name: 'aysenur', is_self: true, score: 2500 }),
    }))
    const board = render()
    await flushPromises()

    const own = board.get('aside.leaderboard__own')

    expect(own.attributes('aria-label')).toBe('leaderboard.ownLabel')
    expect(own.get('.leaderboard__you').text()).toBe('leaderboard.you')
    expect(own.get('.leaderboard__rank').text()).toBe('leaderboard.rank(rank=1234)')
    expect(own.text()).toContain('aysenur')
    expect(own.text()).toContain('⭐')
    expect(own.get('.leaderboard__score').text()).toBe('2.500')
  })

  it('says the player has no score in this window when the server says so', async () => {
    leaderboard
      .mockResolvedValueOnce(page('weekly', [entry(1)], { own_entry: entry(9, { is_self: true }) }))
      .mockResolvedValueOnce(page('all_time', [entry(1)], { own_entry: null }))
    const board = render()
    await flushPromises()
    await board.findAll('[role="tab"]')[1]!.trigger('click')
    await flushPromises()

    expect(board.get('.leaderboard__own-empty').text()).toBe('leaderboard.ownEmpty.allTime')
  })
})

describe('tabs', () => {
  it('is a labelled tablist whose selected tab controls the panel', async () => {
    leaderboard.mockResolvedValueOnce(page('weekly', [entry(1)]))
    const board = render()
    await flushPromises()

    const tablist = board.get('[role="tablist"]')
    const tabs = tablist.findAll('[role="tab"]')
    const panel = board.get('[role="tabpanel"]')

    expect(tablist.attributes('aria-label')).toBe('leaderboard.tabs.label')
    expect(tabs.map(tab => tab.text())).toEqual(['leaderboard.tabs.weekly', 'leaderboard.tabs.allTime'])
    expect(tabs.map(tab => tab.attributes('aria-selected'))).toEqual(['true', 'false'])
    expect(tabs.map(tab => tab.attributes('tabindex'))).toEqual(['0', '-1'])
    expect(tabs[0]!.attributes('aria-controls')).toBe(panel.attributes('id'))
    expect(panel.attributes('aria-labelledby')).toBe(tabs[0]!.attributes('id'))
  })

  it('switches to all time from the first page, resetting the cursor', async () => {
    leaderboard
      .mockResolvedValueOnce(page('weekly', [entry(1)], { meta: { next_cursor: 'weekly-cursor', has_more: true } }))
      .mockResolvedValueOnce(page('all_time', [entry(1), entry(2)]))
    const board = render()
    await flushPromises()

    await board.findAll('[role="tab"]')[1]!.trigger('click')
    await flushPromises()

    expect(leaderboard).toHaveBeenLastCalledWith('all_time')
    expect(board.findAll('[role="tab"]').map(tab => tab.attributes('aria-selected'))).toEqual(['false', 'true'])
    expect(board.find('.leaderboard__load-more').exists()).toBe(false)
  })

  it('moves between tabs with the arrow keys', async () => {
    leaderboard.mockResolvedValue(page('weekly', [entry(1)]))
    const board = render()
    await flushPromises()

    await board.findAll('[role="tab"]')[0]!.trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()

    expect(leaderboard).toHaveBeenLastCalledWith('all_time')
    expect(document.activeElement).toBe(board.findAll('[role="tab"]')[1]!.element)

    await board.findAll('[role="tab"]')[1]!.trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()

    expect(leaderboard).toHaveBeenLastCalledWith('weekly')
  })
})

describe('paging', () => {
  it('loads more from the server\'s cursor and hides the control at the end', async () => {
    leaderboard
      .mockResolvedValueOnce(page('weekly', [1, 2, 3, 4].map(r => entry(r)), { meta: { next_cursor: 'c1', has_more: true } }))
      .mockResolvedValueOnce(page('weekly', [7, 8].map(r => entry(r))))
    const board = render()
    await flushPromises()

    await board.get('.leaderboard__load-more').trigger('click')
    await flushPromises()

    expect(leaderboard).toHaveBeenLastCalledWith('weekly', 'c1')
    // Ranks as the server gave them: 4 then 7, never renumbered.
    expect(board.get('ol.leaderboard__list').findAll('li').map(li => li.attributes('value'))).toEqual(['4', '7', '8'])
    expect(board.find('.leaderboard__load-more').exists()).toBe(false)
  })

  it('starts again from the top when the server refuses the cursor', async () => {
    leaderboard
      .mockResolvedValueOnce(page('weekly', [1, 2].map(r => entry(r)), { meta: { next_cursor: 'stale', has_more: true } }))
      .mockRejectedValueOnce(new BffError({
        type: 'x', title: 'x', status: 422, detail: 'x', code: 'validation_failed',
        errors: { cursor: [{ code: 'cursor_invalid', message: 'x' }] },
      }))
      .mockResolvedValueOnce(page('weekly', [1, 2, 3].map(r => entry(r))))
    const board = render()
    await flushPromises()

    await board.get('.leaderboard__load-more').trigger('click')
    await flushPromises()

    expect(leaderboard.mock.calls).toEqual([['weekly'], ['weekly', 'stale'], ['weekly']])
    expect(board.findAll('.leaderboard__podium li')).toHaveLength(3)
    expect(board.find('[role="alert"]').exists()).toBe(false)
  })

  it('refreshes from the top and scrolls back up', async () => {
    leaderboard.mockResolvedValue(page('all_time', [entry(1)]))
    const board = render()
    await flushPromises()

    await board.get('.leaderboard__refresh').trigger('click')
    await flushPromises()

    expect(leaderboard).toHaveBeenCalledTimes(2)
    expect(leaderboard).toHaveBeenLastCalledWith('weekly')
    expect(globalThis.scrollTo).toHaveBeenCalled()
  })
})
