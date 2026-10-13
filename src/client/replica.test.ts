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

function joined(...units: UnitSnapshot[]): Replica {
  const cells: MapCell[] = []
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) cells.push({ x, y, terrain: Terrain.Land, shift: 0 })
  const replica = new Replica()
  replica.apply({
    tick: 10,
    ack: 0,
    events: [
      { kind: ServerEventKind.Welcome, playerId: 1 },
      {
        kind: ServerEventKind.Snapshot,
        map: { width: 16, height: 16, cells, coast: [], holes: [], roads: [], towns: [], cleared: [] },
        units,
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
    const moved: ServerFrame = { tick: 10, ack: 0, events: [{ kind: ServerEventKind.UnitMotion, unit: scout(3.5, []) }] }
    replica.apply(moved)
    expect(replica.units[0].x).toBe(3.5)
    expect(replica.drawn()[0].x).toBeCloseTo(before)
    for (let i = 0; i < 30; i++) replica.advance(SIM_STEP)
    expect(replica.drawn()[0].x).toBeCloseTo(3.5, 2)
  })

  it('steps forward to a frame far ahead instead of asking for a snapshot', () => {
    const replica = joined(scout(2.5, road))
    replica.apply({ tick: 160, ack: 0, events: [] })
    expect(replica.wantsSnapshot).toBe(false)
    expect(replica.localTick).toBe(160)
    expect(replica.units[0].x).toBeGreaterThan(5)
  })

  it('starts an ordered unit toward its target before the server answers', () => {
    const replica = joined(scout(2.5, []))
    replica.predictMove([1], { x: 12, y: 4 })
    expect(replica.units[0].path).toEqual(Array.from({ length: 10 }, (_, i) => ({ x: 3 + i, y: 4 })))
    for (let i = 0; i < 15; i++) replica.advance(SIM_STEP)
    expect(replica.units[0].x).toBeGreaterThan(2.6)
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
      while (frames.length > 0 && frames[0].at <= now) replica.apply({ tick: frames.shift()?.tick ?? 0, ack: 0, events: [] })
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
    replica.apply({ tick: 15, ack: 0, events: [{ kind: ServerEventKind.UnitMotion, unit: scout(3.5, road.slice(1)) }] })
    expect(replica.units[0].x).toBeGreaterThan(3.5 + 4 * SIM_STEP * 3 * 0.9)
  })

  it('counts a city update apart from terrain changes', () => {
    const replica = joined(scout(2.5, []))
    const terrain = replica.terrainRevision
    const cities = replica.cityRevision
    const layout = { x: 2, y: 2, span: 2, seed: 1, tiles: [{ x: 2, y: 2 }], buildings: [], streets: [] }
    const state = { ownerId: 1, color: 0, progress: 0.5, challengerId: 0, challengerColor: 0, grown: 0, ruins: [], sites: [] }
    replica.apply({ tick: 10, ack: 0, events: [{ kind: ServerEventKind.CityUpdate, city: { index: 0, state, layout } }] })
    expect(replica.terrainRevision).toBe(terrain)
    expect(replica.cityRevision).toBe(cities + 1)
    expect(replica.knownTiles).toBe(256)
  })

  it('turns a turret toward its attack target between server updates', () => {
    const tank = { ...scout(4.5, []), id: 2, typeId: UnitTypeId.MedTank, facing: 0, turretYaw: 0 }
    const foe = { ...scout(8.5, []), id: 3, ownerId: 2 }
    const replica = joined(tank, foe)
    replica.predictAttack([2], foe, 3)
    for (let i = 0; i < 15; i++) replica.advance(SIM_STEP)
    expect(replica.unit(2)?.turretYaw).toBeGreaterThan(1)
  })

  it('leads a unit out of range toward its attack target', () => {
    const tank = { ...scout(1.5, []), id: 2, typeId: UnitTypeId.MedTank }
    const replica = joined(tank, { ...scout(14.5, []), id: 3, ownerId: 2 })
    replica.predictAttack([2], { x: 14.5, z: 4.5 }, 3)
    expect(replica.unit(2)?.attackId).toBe(3)
    expect(replica.unit(2)?.path).toEqual([{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }])
  })

  it('shows an expected unit in the queue until its command is acknowledged', () => {
    const replica = joined(scout(2.5, []))
    replica.expectTraining(5, UnitTypeId.MedTank)
    replica.apply({ tick: 11, ack: 4, events: [] })
    expect(replica.queue()).toEqual([{ typeId: UnitTypeId.MedTank, progress: 0 }])
    replica.apply({ tick: 12, ack: 5, events: [] })
    expect(replica.queue()).toEqual([])
  })

  it('advances the head of the training queue between updates', () => {
    const replica = joined(scout(2.5, []))
    const update = (tick: number, progress: number) => ({
      tick,
      ack: 0,
      events: [{ kind: ServerEventKind.Training as const, training: [{ typeId: UnitTypeId.Scout, progress }] }],
    })
    replica.apply(update(10, 0.1))
    replica.apply(update(16, 0.2))
    for (let i = 0; i < 9; i++) replica.advance(SIM_STEP)
    expect(replica.queue()[0].progress).toBeCloseTo(0.2 + (0.1 / 6) * (replica.localTick - 16), 5)
    expect(replica.queue()[0].progress).toBeGreaterThan(0.2)
  })
})
