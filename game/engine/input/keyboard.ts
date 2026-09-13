import type { InputEvent } from '../../bridge'

/**
 * Key codes to intent.
 *
 * Normalization happens **here**, in the engine, before anything crosses the
 * bridge. The domain reasons about `move_left`, not about `ArrowLeft` — which
 * is what lets a keyboard and a thumb drive one set of rules, and what keeps
 * `KeyboardEvent` out of a module that must run in Node.
 *
 * The approved desktop legend is `←`/`→`, `Space`/`↑`, `E` and `Esc`. `A`, `D`
 * and `W` are additive aliases; `E` was approved during specification review.
 * None of them contradicts the v0.3 board.
 *
 * `E` (activate SLAYYY) is deliberately absent: SLAYYY arrives at M7 and there
 * is nothing for the key to do. Mapping it to a silently-ignored event now
 * would be a control that appears to exist.
 */

/**
 * A null prototype, deliberately.
 *
 * With a plain object literal every key on `Object.prototype` answers `in` and
 * resolves to a function, so `isGameplayKey('constructor')` was `true` and
 * `inputForKeyCode('constructor')` returned `Object` itself — which then went
 * into the input queue as an event whose `type` was a function. Unreachable
 * from a real `KeyboardEvent.code`, but the lookup should not be the thing
 * standing between a synthetic event and the simulation.
 */
const BINDINGS: Readonly<Record<string, InputEvent['type']>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, InputEvent['type']>, {
    ArrowLeft: 'move_left',
    KeyA: 'move_left',
    ArrowRight: 'move_right',
    KeyD: 'move_right',
    ArrowUp: 'jump',
    KeyW: 'jump',
    Space: 'jump',
    Escape: 'pause',
  } as const),
)

/**
 * The intent for a physical key, or null if it is not ours.
 *
 * Keyed on `KeyboardEvent.code`, not `key`: `code` is the physical key and does
 * not change with the layout or with a modifier, so `A` still means left on an
 * AZERTY keyboard and `Space` is `Space` whether or not shift is held.
 */
export function inputForKeyCode(code: string): InputEvent['type'] | null {
  return BINDINGS[code] ?? null
}

/** Is this a key gameplay claims? Used to decide whether to prevent the default. */
export function isGameplayKey(code: string): boolean {
  return Object.hasOwn(BINDINGS, code)
}

/**
 * What currently has focus, as much as the decision needs to know.
 *
 * A tag name alone was not enough: a `contenteditable` div reports `DIV`, and a
 * field inside a web component reports the host element's tag, so both looked
 * like empty space to the old check.
 */
export interface FocusTarget {
  readonly tagName: string
  readonly isContentEditable: boolean
  readonly role: string | null
}

/** Elements whose own keyboard behaviour outranks gameplay. */
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
const ACTIVATABLE_TAGS = new Set(['BUTTON', 'A', 'SUMMARY'])
const ACTIVATABLE_ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch'])

/**
 * Should this key event be acted on at all?
 *
 * Three refusals, all of them about not stealing the browser or the page.
 *
 * A key with a modifier belongs to the browser or the operating system —
 * `Ctrl+W` closes the tab, `Alt+←` goes back, `Shift+←` selects text — and a
 * game that swallowed those would be a game people cannot leave.
 *
 * Auto-repeat is one physical press, not thirty.
 *
 * A key arriving while a control has focus belongs to that control: Space on a
 * focused button activates it, Space in a text field types a space.
 *
 * **Escape is exempt from the focus rule, and that exemption is the point.**
 * Blocking it alongside the movement keys meant that tabbing to the on-screen
 * pause button — the single most likely thing a keyboard player does — left
 * them unable to move, unable to jump *and* unable to pause, with no way back
 * because the play surface was not focusable. Pause must never be the thing
 * that cannot be reached. Escape types nothing into a field and activates no
 * button, so letting it through costs the focused control nothing.
 */
export function shouldHandleKey(event: {
  readonly code: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey?: boolean
  readonly repeat: boolean
}, focus: FocusTarget | string | null): boolean {
  if (!isGameplayKey(event.code)) return false
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey === true) return false
  if (event.repeat) return false

  const target = typeof focus === 'string'
    ? { tagName: focus, isContentEditable: false, role: null }
    : focus

  if (target === null) return true

  const tag = target.tagName.toUpperCase()
  const role = target.role?.toLowerCase() ?? null

  const claimsText = target.isContentEditable
    || TEXT_ENTRY_TAGS.has(tag)
    || role === 'textbox'
    || role === 'searchbox'

  const claimsActivation = ACTIVATABLE_TAGS.has(tag)
    || (role !== null && ACTIVATABLE_ROLES.has(role))

  if (!claimsText && !claimsActivation) return true

  // The one key a focused control never needs.
  return BINDINGS[event.code] === 'pause'
}
