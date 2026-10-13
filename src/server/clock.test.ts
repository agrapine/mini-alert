import { describe, expect, it } from 'vitest'
import { runFixedStep } from './clock.ts'

function fakeClock() {
  let time = 0
  let pending: (() => void) | null = null
  return {
    now: () => time,
    wait: (run: () => void) => {
      pending = run
    },
    advance(ms: number) {
      time += ms
      const run = pending
      pending = null
      run?.()
    },
  }
}

describe('fixed step clock', () => {
  it('makes up ticks lost to a slow step but drops a long stall', () => {
    const clock = fakeClock()
    let ticks = 0
    runFixedStep(10, () => ticks++, clock.now, clock.wait)
    expect(ticks).toBe(1)
    clock.advance(35)
    expect(ticks).toBe(4)
    clock.advance(1000)
    expect(ticks).toBe(15)
  })
})
