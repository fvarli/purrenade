import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type Messages = Record<string, string | Messages>

function messages(locale: string): Messages {
  return JSON.parse(readFileSync(resolve(`i18n/locales/${locale}.json`), 'utf8')) as Messages
}

function keys(value: Messages, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => (
    typeof child === 'string' ? [`${prefix}${key}`] : keys(child, `${prefix}${key}.`)
  ))
}

describe('Milestone A locale messages', () => {
  it('keeps the Turkish source key set available in English and Spanish', () => {
    const source = keys(messages('tr')).sort()

    for (const locale of ['en', 'es']) {
      expect(keys(messages(locale)).sort()).toEqual(source)
    }
  })

  it('describes locked characters without inventing an unlock condition', () => {
    const notes = ['tr', 'en', 'es'].map(locale => (
      (messages(locale).characters as Messages).artNote as string
    ))

    expect(notes).toEqual([
      'Yeni karakterler yakında gelecek.',
      'More characters are coming later.',
      'Próximamente llegarán más personajes.',
    ])
  })
})
