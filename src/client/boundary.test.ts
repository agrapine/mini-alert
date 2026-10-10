import { describe, expect, it } from 'vitest'

const sources = import.meta.glob('./**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('client import boundary', () => {
  it('does not import the server', () => {
    const files = Object.entries(sources)
    expect(files.length).toBeGreaterThan(0)
    for (const [file, text] of files) {
      expect(text, file).not.toMatch(/['"][^'"]*\/server\//)
    }
  })
})
