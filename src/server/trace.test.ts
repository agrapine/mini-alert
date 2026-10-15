import { describe, expect, it } from 'vitest'
import { TraceSlot } from '../shared/trace.ts'
import { traceBegin, traceClock, traceCommit, traceEnd, traceReset } from './trace.ts'

describe('server tick trace', () => {
  it('keeps nested path time out of the parent and reports idle left in the budget', () => {
    let t = 0
    traceClock(() => t)
    traceReset()
    traceBegin(TraceSlot.Units)
    t = 4
    traceBegin(TraceSlot.Path)
    t = 16
    traceEnd()
    t = 18
    traceEnd()
    const report = traceCommit(20, 33.3, 1)
    traceClock(null)
    const ms = (slot: number) => report?.samples.find((sample) => sample.slot === slot)?.ms ?? 0
    expect(ms(TraceSlot.Path)).toBe(12)
    expect(ms(TraceSlot.Units)).toBe(6)
    expect(ms(TraceSlot.Other)).toBeCloseTo(2, 5)
    expect(ms(TraceSlot.Idle)).toBeCloseTo(13.3, 5)
  })
})
