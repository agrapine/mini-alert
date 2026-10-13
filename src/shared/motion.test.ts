import { describe, expect, it } from 'vitest'
import { Flight, joinPaths, rollout, runwayEnd } from './flight.ts'
import { flightLine, MotionResult, stepMotion, type MotionState } from './motion.ts'
import { CRUISER, GUNSHIP, JET, SCOUT } from './unit-types.ts'

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

  it('rolls a jet along the strip before it climbs', () => {
    const state = body()
    state.x = 1.5
    state.z = 2.5
    state.facing = 0
    state.flight = Flight.Ground
    state.altitude = 0
    state.path = [
      { x: 1, y: 4 },
      { x: 1, y: 6 },
      { x: 8, y: 6 },
    ]
    for (let i = 0; i < 18; i++) stepMotion(state, JET, 1 / 30)
    expect(state.altitude ?? 0).toBeLessThan(0.25)
    expect(state.speed).toBeGreaterThan(1)
    for (let i = 0; i < 90; i++) stepMotion(state, JET, 1 / 30)
    expect(state.altitude ?? 0).toBeGreaterThan(1.5)
    expect(state.flight).toBe(Flight.Cruise)
  })

  it('circles a jet around the ordered tile', () => {
    const state = body()
    state.x = 8.5
    state.z = 8.5
    state.tileX = 8
    state.tileY = 8
    state.facing = 0
    state.speed = JET.topSpeed
    state.flight = Flight.Cruise
    state.altitude = 2.6
    state.path = [{ x: 9, y: 8 }]
    state.orbitX = 9
    state.orbitY = 8
    state.homeX = 1
    state.homeY = 2
    state.returning = false
    for (let i = 0; i < 30 * 8; i++) stepMotion(state, JET, 1 / 30)
    const dist = Math.hypot(state.x - 9.5, state.z - 8.5)
    expect(state.returning).toBe(false)
    expect(state.flight).toBe(Flight.Orbit)
    expect(dist).toBeGreaterThan(3)
    expect(dist).toBeLessThan(12)
    expect(state.path.length).toBeGreaterThan(0)
  })

  it('rolls a jet out from the north parking row', () => {
    const state = body()
    const home = { x: 4, y: 6 }
    state.x = 4.5
    state.z = 8.5
    state.tileX = 4
    state.tileY = 8
    state.facing = Math.PI / 2
    state.speed = 0
    state.altitude = 0
    state.flight = Flight.Taxi
    state.returning = false
    state.homeX = home.x
    state.homeY = home.y
    state.bay = 2
    state.path = joinPaths(rollout({ x: 4, y: 8 }, home), flightLine(runwayEnd(home), { x: 16, y: 8 }))
    for (let i = 0; i < 30 * 16; i++) stepMotion(state, JET, 1 / 30)
    expect(state.flight).toBe(Flight.Cruise)
    expect(state.altitude ?? 0).toBeGreaterThan(1.5)
    expect(state.x).toBeGreaterThan(8)
  })

  it('lands a jet and taxis it to its parking spot', () => {
    const state = body()
    state.x = 5.5
    state.z = 16.5
    state.tileX = 5
    state.tileY = 16
    state.facing = Math.PI
    state.speed = JET.topSpeed
    state.altitude = 2.6
    state.flight = Flight.Cruise
    state.returning = true
    state.homeX = 4
    state.homeY = 6
    state.bay = 3
    state.path = flightLine({ x: 5, y: 16 }, { x: 5, y: 8 })
    let taxied = false
    for (let i = 0; i < 30 * 20; i++) {
      stepMotion(state, JET, 1 / 30)
      if ((state.flight as Flight) === Flight.Taxi) taxied = true
    }
    expect(taxied).toBe(true)
    expect(state.altitude ?? 0).toBeLessThan(0.2)
    expect(state.flight).toBe(Flight.Ground)
    expect(state.returning).toBe(false)
    expect(Math.abs(state.speed)).toBeLessThan(0.4)
    expect(state.tileX).toBe(6)
    expect(state.tileY).toBe(6)
    expect(state.x).toBeCloseTo(6.5)
    expect(state.z).toBeCloseTo(6.5)
  })

  it('lets a gunship yaw while it is still hovering', () => {
    const state = body()
    state.facing = 0
    state.speed = 0
    state.path = [{ x: 8, y: 2 }]
    for (let i = 0; i < 12; i++) stepMotion(state, GUNSHIP, 1 / 30)
    expect(Math.abs(state.speed)).toBeLessThan(0.2)
    expect(Math.abs(state.facing)).toBeGreaterThan(0.4)
    expect(state.x).toBeCloseTo(1.5)
  })

  it('climbs a gunship off the pad and sets it back down', () => {
    const state = body()
    state.flight = Flight.Ground
    state.altitude = 0
    state.path = [{ x: 8, y: 2 }]
    for (let i = 0; i < 40; i++) stepMotion(state, GUNSHIP, 1 / 30)
    expect(state.altitude ?? 0).toBeGreaterThan(0.8)
    expect(state.flight).toBe(Flight.Cruise)
    state.returning = true
    state.homeX = 8
    state.homeY = 2
    state.x = 8.2
    state.z = 2.4
    state.speed = 0
    for (let i = 0; i < 30 * 3; i++) stepMotion(state, GUNSHIP, 1 / 30)
    expect(state.flight).toBe(Flight.Ground)
    expect(state.altitude ?? 0).toBeLessThan(0.1)
  })

  it('spins a cruiser before it builds speed', () => {
    const state = body()
    state.facing = 0
    state.speed = 0
    state.path = [{ x: 8, y: 2 }]
    for (let i = 0; i < 30; i++) stepMotion(state, CRUISER, 1 / 30)
    expect(state.speed).toBeLessThan(0.05)
    expect(Math.abs(state.facing)).toBeGreaterThan(0.3)
    for (let i = 0; i < 30 * 7; i++) stepMotion(state, CRUISER, 1 / 30)
    expect(state.speed).toBeGreaterThan(0.8)
    expect(state.x).toBeGreaterThan(1.5)
  })
})
