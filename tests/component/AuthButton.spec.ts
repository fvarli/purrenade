import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AuthButton from '~/components/ui/AuthButton.vue'

/**
 * The primary action, and one thing the test suite leans on.
 *
 * `app/pages/index.vue` puts the E2E interaction hook `home__play` on this
 * component rather than on a plain element, which only works because a single
 * root element makes the class fall through and *merge* with the component's
 * own. If it ever replaced `btn` instead, the button would lose its styling;
 * if it were dropped, six browser assertions would stop selecting anything.
 *
 * Neither failure is visible from the specs that rely on it: they need a signed
 * -in session, so they do not run in CI. That is precisely the shape of the gap
 * that let the deployment health contract rot unnoticed, so the assumption is
 * held here, where it runs on every push.
 */

describe('a class given from outside', () => {
  it('reaches the button and joins its own, rather than replacing them', () => {
    const wrapper = mount(AuthButton, {
      attrs: { class: 'home__play' },
      slots: { default: 'PLAY' },
    })

    const button = wrapper.get('button')

    expect(button.classes()).toContain('home__play')
    expect(button.classes(), 'the component keeps its own styling').toContain('btn')
    expect(button.classes()).toContain('btn--primary')
  })
})
