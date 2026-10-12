import { describe, expect, it } from 'vitest'
import { flightProgress, flightTime, ROCKET_ACCEL, ROCKET_SPEED } from './ballistics.ts'

describe('ballistics', () => {
  it('lets a rocket speed up along its flight', () => {
    const distance = 12
    const time = flightTime(distance, ROCKET_SPEED, ROCKET_ACCEL)
    expect(time).toBeLessThan(distance / ROCKET_SPEED)
    const halfway = flightProgress(time / 2, time, ROCKET_SPEED, ROCKET_ACCEL)
    expect(halfway).toBeGreaterThan(0.2)
    expect(halfway).toBeLessThan(0.5)
    expect(flightProgress(time, time, ROCKET_SPEED, ROCKET_ACCEL)).toBe(1)
    expect(ROCKET_SPEED + ROCKET_ACCEL * time).toBeGreaterThan(ROCKET_SPEED)
  })
})
