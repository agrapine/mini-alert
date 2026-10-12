import { describe, expect, it } from 'vitest'
import { MotionResult, stepMotion, type MotionState } from './motion.ts'
import { SCOUT } from './unit-types.ts'

function body(): MotionState {
  return {
    x: 1.5,
    z: 2.5,
    facing: 0,
    speed: 0,
    tileX: 1,
    tileY: 2,
    path: [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ],
  }
}

describe('shared motion', () => {
  it('keeps two copies on the same path', () => {
    const left = body()
    const right = body()
    for (let i = 0; i < 40; i++) {
      stepMotion(left, SCOUT, 1 / 30)
      stepMotion(right, SCOUT, 1 / 30)
    }
    expect(left.x).toBeCloseTo(right.x)
    expect(left.z).toBeCloseTo(right.z)
    expect(left.facing).toBeCloseTo(right.facing)
    expect(left.speed).toBeCloseTo(right.speed)
    expect(left.path).toEqual(right.path)
    expect(left.x).toBeGreaterThan(1.5)
  })

  it('slows and stays put while the next tile is taken', () => {
    const state = body()
    state.speed = SCOUT.topSpeed
    const result = stepMotion(state, SCOUT, 1 / 30, (x, y) => x === 2 && y === 2)
    expect(result).toBe(MotionResult.Waiting)
    expect(state.x).toBe(1.5)
    expect(state.z).toBe(2.5)
    expect(state.speed).toBeLessThan(SCOUT.topSpeed)
    expect(state.path[0]).toEqual({ x: 2, y: 2 })
  })
})
