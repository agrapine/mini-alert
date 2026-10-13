import { describe, expect, it } from 'vitest'
import { SIM_STEP } from '../shared/motion.ts'
import { ServerEventKind, type MapCell, type ServerFrame, type UnitSnapshot } from '../shared/protocol.ts'
import { Terrain } from '../shared/tiles.ts'
import { UnitTypeId } from '../shared/unit-types.ts'
import { Replica } from './replica.ts'

function scout(x: number, path: { x: number; y: number }[]): UnitSnapshot {
  return {
    id: 1,
    typeId: UnitTypeId.Scout,
    ownerId: 1,
    color: 0,
    x,
    z: 4.5,
    facing: Math.PI / 2,
    turretYaw: Math.PI / 2,
    speed: path.length > 0 ? 3 : 0,
    health: 100,
    tileX: Math.floor(x),
    tileY: 4,
    path,
    goal: path.at(-1) ?? null,
    attackId: null,
    attackPoint: null,
    progress: 1,
  }
}

function joined(unit: UnitSnapshot): Replica {
  const cells: MapCell[] = []
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) cells.push({ x, y, terrain: Terrain.Land, shift: 0 })
  const replica = new Replica()
  replica.apply({
    tick: 10,
    events: [
      { kind: ServerEventKind.Welcome, playerId: 1 },
      {
        kind: ServerEventKind.Snapshot,
        map: { width: 16, height: 16, cells, coast: [], holes: [], roads: [], towns: [], cleared: [] },
        units: [unit],
        cities: [],
        credits: 0,
        training: [],
        primaryFactoryId: 0,
        rally: null,
      },
    ],
  })
  return replica
}

const road = [{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 }, { x: 7, y: 4 }, { x: 8, y: 4 }, { x: 9, y: 4 }]

describe('replica drawing', () => {
  it('poses a moving unit between its last two sim steps', () => {
    const replica = joined(scout(2.5, road))
    replica.drawn()
    replica.advance(SIM_STEP)
    const stepped = replica.units[0].x
    replica.drawn()
    replica.advance(SIM_STEP * 1.5)
    const after = replica.units[0].x
    const drawn = replica.drawn()[0].x
    expect(drawn).toBeGreaterThan(stepped)
    expect(drawn).toBeLessThan(after)
  })

  it('blends a server correction in instead of jumping', () => {
    const replica = joined(scout(2.5, []))
    const before = replica.drawn()[0].x
    const moved: ServerFrame = { tick: 10, events: [{ kind: ServerEventKind.UnitMotion, unit: scout(3.5, []) }] }
    replica.apply(moved)
    expect(replica.units[0].x).toBe(3.5)
    expect(replica.drawn()[0].x).toBeCloseTo(before)
    for (let i = 0; i < 30; i++) replica.advance(SIM_STEP)
    expect(replica.drawn()[0].x).toBeCloseTo(3.5, 2)
  })

  it('steps forward to a frame far ahead instead of asking for a snapshot', () => {
    const replica = joined(scout(2.5, road))
    replica.apply({ tick: 160, events: [] })
    expect(replica.wantsSnapshot).toBe(false)
    expect(replica.localTick).toBe(160)
    expect(replica.units[0].x).toBeGreaterThan(5)
  })

  it('starts an ordered unit toward its target before the server answers', () => {
    const replica = joined(scout(2.5, []))
    replica.predictMove([1], { x: 12, y: 4 })
    expect(replica.units[0].path).toEqual([{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }])
    for (let i = 0; i < 15; i++) replica.advance(SIM_STEP)
    expect(replica.units[0].x).toBeGreaterThan(2.6)
  })

  it('keeps the route of a unit already heading for the target', () => {
    const replica = joined(scout(2.5, road))
    replica.predictMove([1], { x: 10, y: 4 })
    expect(replica.units[0].path).toEqual(road)
  })

  it('keeps a steady pace when frames arrive with uneven delays', () => {
    const replica = joined(scout(1.5, []))
    const delays = [0, 12, 3, 15, 0, 9]
    const frames: { tick: number; at: number }[] = []
    for (let tick = 12, at = 0; tick < 140; tick += 3) {
      at = Math.max(at, tick + 2 + delays[frames.length % delays.length])
      frames.push({ tick, at })
    }
    const paces: number[] = []
    for (let half = 22; half < 260; half++) {
      const now = half / 2
      while (frames.length > 0 && frames[0].at <= now) replica.apply({ tick: frames.shift()?.tick ?? 0, events: [] })
      const before = replica.localTick
      replica.advance(SIM_STEP / 2)
      paces.push(replica.localTick - before)
    }
    const settled = paces.slice(40)
    let worst = 0
    for (let i = 0; i + 12 <= settled.length; i++) {
      const steps = settled.slice(i, i + 12).reduce((sum, pace) => sum + pace, 0)
      worst = Math.max(worst, Math.abs(steps - 6))
    }
    expect(worst).toBeLessThanOrEqual(1)
  })

  it('replays a correction from an older tick up to the local tick', () => {
    const replica = joined(scout(2.5, road))
    for (let i = 0; i < 10; i++) replica.advance(SIM_STEP)
    expect(replica.localTick).toBe(20)
    replica.apply({ tick: 15, events: [{ kind: ServerEventKind.UnitMotion, unit: scout(3.5, road.slice(1)) }] })
    expect(replica.units[0].x).toBeGreaterThan(3.5 + 4 * SIM_STEP * 3 * 0.9)
  })
})
