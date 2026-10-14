import { TraceSlot } from '../shared/trace.ts'

const flag = process.env.TRACE
export const __TRACE__ = flag === '1' || flag === 'true'

const WINDOW = 30
const SLOT_COUNT = TraceSlot.Idle + 1

const tickMs = new Float64Array(SLOT_COUNT)
const sumMs = new Float64Array(SLOT_COUNT)
const stack: { slot: number; t: number }[] = []
let ticks = 0
let now = () => performance.now()

export function traceClock(fn: (() => number) | null) {
  now = fn ?? (() => performance.now())
}

export type TraceReport = {
  samples: { slot: number; ms: number }[]
  budget: number
}

export function traceReset() {
  tickMs.fill(0)
  stack.length = 0
}

export function traceBegin(slot: number) {
  const mark = now()
  const parent = stack[stack.length - 1]
  if (parent) {
    tickMs[parent.slot] += mark - parent.t
    parent.t = mark
  }
  stack.push({ slot, t: mark })
}

export function traceEnd() {
  const mark = now()
  const top = stack.pop()
  if (!top) return
  tickMs[top.slot] += mark - top.t
  const parent = stack[stack.length - 1]
  if (parent) parent.t = mark
}

export function traceCommit(elapsed: number, budget: number, window = WINDOW): TraceReport | null {
  while (stack.length > 0) traceEnd()
  let accounted = 0
  for (let slot = 0; slot < TraceSlot.Other; slot++) accounted += tickMs[slot]
  tickMs[TraceSlot.Other] = Math.max(0, elapsed - accounted)
  tickMs[TraceSlot.Idle] = Math.max(0, budget - elapsed)
  for (let slot = 0; slot < SLOT_COUNT; slot++) sumMs[slot] += tickMs[slot]
  tickMs.fill(0)
  ticks += 1
  if (ticks < window) return null
  const samples: { slot: number; ms: number }[] = []
  for (let slot = 0; slot < SLOT_COUNT; slot++) samples.push({ slot, ms: sumMs[slot] / ticks })
  sumMs.fill(0)
  ticks = 0
  return { samples, budget }
}
