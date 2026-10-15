import { describe, expect, it } from 'vitest'
import { CITY_CATALOG, type CityLayout } from '../shared/cities.ts'
import type { CityState, TrainJob, UnitSnapshot } from '../shared/protocol.ts'
import type { TileCoord } from '../shared/tiles.ts'
import { UNIT_TYPES, UnitTypeId } from '../shared/unit-types.ts'
import { CreditCounter, focusLabel, functionSlot, hudModel, PingState, TileKind, Trend, type HudInput, type HudModel, type HudTile } from './hud-model.ts'

const ME = 1
const RIVAL = 2
const COTTAGE = CITY_CATALOG.findIndex((entry) => entry.density === 1)

function unit(id: number, typeId: UnitTypeId, fields: Partial<UnitSnapshot> = {}): UnitSnapshot {
  return {
    id,
    typeId,
    ownerId: ME,
    color: 0,
    x: id + 0.5,
    z: 0.5,
    facing: 0,
    turretYaw: 0,
    speed: 0,
    health: 100,
    tileX: id,
    tileY: 0,
    path: [],
    goal: null,
    attackId: null,
    attackPoint: null,
    progress: 1,
    ...fields,
  }
}

function job(typeId: UnitTypeId, yardId: number, progress = 0): TrainJob {
  return { typeId, yardId, progress }
}

type Town = { state: CityState; layout: CityLayout | null }

function town(ownerId: number, population: number, ruins: TileCoord[] = []): Town {
  const buildings = Array.from({ length: population }, (_, x) => ({ x, y: 0, model: COTTAGE, yaw: 0, keep: false }))
  return {
    state: { ownerId, color: 0, progress: 1, challengerId: 0, challengerColor: 0, grown: 0, focus: 0, ruins, sites: [] },
    layout: { x: 0, y: 0, span: population, seed: 0, tiles: [], buildings, streets: [] },
  }
}

function input(fields: Partial<HudInput> & { towns?: Town[] } = {}): HudInput {
  const { towns = [town(ME, 40)], ...rest } = fields
  return {
    playerId: ME,
    units: [],
    queue: [],
    cities: towns.map((entry) => entry.state),
    layouts: towns.map((entry) => entry.layout),
    yard: null,
    placing: null,
    raising: false,
    hall: null,
    quote: null,
    rtt: null,
    spectating: false,
    ...rest,
  }
}

function name(tile: HudTile): string {
  if (tile.kind === TileKind.City) return 'Building'
  const label = UNIT_TYPES[tile.type].label
  return tile.kind === TileKind.Queued ? `Queued ${label}` : label
}

function shown(model: HudModel): string[] {
  return model.tiles.filter((tile) => tile.visible).map(name)
}

function find(model: HudModel, label: string): HudTile {
  const found = model.tiles.find((tile) => name(tile) === label)
  if (!found) throw new Error(`no ${label}`)
  return found
}

function ready(model: HudModel): string[] {
  return model.tiles.filter((tile) => tile.visible && tile.ready && tile.kind !== TileKind.Queued).map(name)
}

describe('hud readouts', () => {
  it('sums the supply of the live units the player owns into the army', () => {
    const model = hudModel(input({
      units: [
        unit(1, UnitTypeId.MedTank),
        unit(2, UnitTypeId.Factory),
        unit(3, UnitTypeId.Scout, { health: 0 }),
        unit(4, UnitTypeId.HeavyTank, { ownerId: RIVAL }),
      ],
    }))
    expect(model.army).toBe(UNIT_TYPES[UnitTypeId.MedTank].supply + UNIT_TYPES[UnitTypeId.Factory].supply)
  })

  it('is over only when the army exceeds the population', () => {
    const tanks = [unit(1, UnitTypeId.MedTank), unit(2, UnitTypeId.MedTank)]
    expect(hudModel(input({ towns: [town(ME, 4)], units: tanks })).over).toBe(false)
    expect(hudModel(input({ towns: [town(ME, 3)], units: tanks })).over).toBe(true)
  })

  it('counts the population and cities of the settled cities the player holds, less ruins', () => {
    const model = hudModel(input({
      towns: [
        town(ME, 5, [{ x: 0, y: 0 }]),
        town(RIVAL, 9),
        { ...town(ME, 7), layout: null },
        town(ME, 3),
      ],
    }))
    expect(model.population).toBe(4 + 3)
    expect(model.cities).toBe(2)
  })

  it('rates the ping as none without a sample, slow above 150 ms and bad above 300 ms', () => {
    expect(hudModel(input({ rtt: null })).ping).toEqual({ state: PingState.None })
    expect(hudModel(input({ rtt: 150 })).ping).toEqual({ state: PingState.Good, ms: 150 })
    expect(hudModel(input({ rtt: 150.4 })).ping).toEqual({ state: PingState.Slow, ms: 150 })
    expect(hudModel(input({ rtt: 300 })).ping).toEqual({ state: PingState.Slow, ms: 300 })
    expect(hudModel(input({ rtt: 300.4 })).ping).toEqual({ state: PingState.Bad, ms: 300 })
  })
})

describe('credit counter', () => {
  it('eases toward the target with a 0.15 s time constant', () => {
    const counter = new CreditCounter()
    counter.ease(1000, 0.15)
    expect(counter.shown).toBeCloseTo(1000 * (1 - Math.exp(-1)), 6)
  })

  it('snaps to the target within 0.5', () => {
    const counter = new CreditCounter()
    counter.snap(999.4)
    counter.ease(1000, 0.001)
    expect(counter.shown).toBeLessThan(999.5)
    counter.snap(999.6)
    counter.ease(1000, 0.001)
    expect(counter.shown).toBe(1000)
  })

  it('trends up or down while the target is more than 30 away', () => {
    const counter = new CreditCounter()
    counter.ease(31, 1e-20)
    expect(counter.trend).toBe(Trend.Up)
    counter.ease(30, 1e-20)
    expect(counter.trend).toBe(Trend.Steady)
    counter.ease(-31, 1e-20)
    expect(counter.trend).toBe(Trend.Down)
    counter.ease(-30, 1e-20)
    expect(counter.trend).toBe(Trend.Steady)
  })
})

describe('hud tiles without a yard', () => {
  it('shows Factory, Turret and the city house before a factory is finished', () => {
    const model = hudModel(input({ units: [unit(1, UnitTypeId.Factory, { progress: 0.5 })] }))
    expect(shown(model)).toEqual(['Factory', 'Turret', 'Building'])
  })

  it('shows Airport, Helipad and Shipyard once a factory is finished', () => {
    const model = hudModel(input({ units: [unit(1, UnitTypeId.Factory)] }))
    expect(shown(model)).toEqual(['Factory', 'Turret', 'Airport', 'Helipad', 'Shipyard', 'Building'])
  })

  it('shows a placed yard site without a finished factory', () => {
    const model = hudModel(input({ units: [unit(1, UnitTypeId.Helipad, { progress: 0 })] }))
    expect(shown(model)).toEqual(['Factory', 'Turret', 'Helipad', 'Building'])
    expect(find(model, 'Helipad')).toMatchObject({ count: 1, progress: 0, ready: false })
  })

  it('readies a structure only with population room for its supply, plus a finished factory where it needs one', () => {
    const units = [unit(1, UnitTypeId.Factory), unit(2, UnitTypeId.MedTank)]
    const queue = [job(UnitTypeId.Scout, 1)]
    const used = UNIT_TYPES[UnitTypeId.Factory].supply + UNIT_TYPES[UnitTypeId.MedTank].supply + UNIT_TYPES[UnitTypeId.Scout].supply
    const roomy = hudModel(input({ towns: [town(ME, used + UNIT_TYPES[UnitTypeId.Helipad].supply)], units, queue }))
    expect(ready(roomy)).toEqual(['Factory', 'Turret', 'Helipad', 'Building'])
    const tight = hudModel(input({ towns: [town(ME, used + UNIT_TYPES[UnitTypeId.Turret].supply)], units, queue }))
    expect(ready(tight)).toEqual(['Turret', 'Building'])
    const site = hudModel(input({ units: [unit(1, UnitTypeId.Factory, { progress: 0.5 }), unit(2, UnitTypeId.Helipad, { progress: 0.1 })] }))
    expect(find(site, 'Helipad')).toMatchObject({ visible: true, ready: false })
  })

  it('prices the city house with the quote and arms it while raising', () => {
    const idle = find(hudModel(input()), 'Building')
    expect(idle).toMatchObject({ cost: '1', ready: true, armed: false })
    const raising = find(hudModel(input({ raising: true, quote: 1200 })), 'Building')
    expect(raising).toMatchObject({ cost: '1,200 · 1', ready: true, armed: true })
  })

  it('arms the structure tile of the placing type', () => {
    const model = hudModel(input({ placing: UnitTypeId.Turret }))
    expect(model.tiles.filter((tile) => tile.armed).map(name)).toEqual(['Turret'])
  })
})

describe('hud tiles with a yard selected', () => {
  const factory = unit(1, UnitTypeId.Factory)
  const queue = [
    job(UnitTypeId.MedTank, 1, 0.4),
    job(UnitTypeId.MedTank, 1),
    job(UnitTypeId.Scout, 1, 0.3),
    job(UnitTypeId.HeavyTank, 7, 0.9),
    job(UnitTypeId.Scout, 7),
  ]

  it('shows only the train tiles of that yard, counted from its own jobs', () => {
    const model = hudModel(input({ units: [factory], yard: factory, queue }))
    expect(shown(model).filter((label) => !label.startsWith('Queued'))).toEqual(['Scout', 'Med Tank', 'Heavy Tank', 'Artillery'])
    expect(find(model, 'Med Tank')).toMatchObject({ count: 2, progress: 0.4 })
    expect(find(model, 'Scout')).toMatchObject({ count: 1, progress: 0 })
    expect(find(model, 'Heavy Tank')).toMatchObject({ count: 0, progress: 0 })
  })

  it('readies a train tile only when the yard is finished and army + queued + supply fits the population', () => {
    const jobs = [job(UnitTypeId.Scout, 1)]
    const used = UNIT_TYPES[UnitTypeId.Factory].supply + UNIT_TYPES[UnitTypeId.Scout].supply
    const room = used + UNIT_TYPES[UnitTypeId.Artillery].supply
    const finished = hudModel(input({ towns: [town(ME, room)], units: [factory], yard: factory, queue: jobs }))
    expect(ready(finished)).toEqual(['Scout', 'Med Tank', 'Artillery'])
    const site = unit(1, UnitTypeId.Factory, { progress: 0.5 })
    const building = hudModel(input({ units: [site], yard: site, queue: jobs }))
    expect(ready(building)).toEqual([])
  })

  it('readies a jet only with a free apron bay, less the jets queued at that airport', () => {
    const airport = unit(1, UnitTypeId.Airport)
    const parked = (count: number) =>
      Array.from({ length: count }, (_, bay) => unit(10 + bay, UnitTypeId.Jet, { home: { x: airport.tileX, y: airport.tileY }, bay }))
    const elsewhere = job(UnitTypeId.Jet, 2)
    const jet = (units: UnitSnapshot[], jobs: TrainJob[]) => find(hudModel(input({ units: [airport, ...units], yard: airport, queue: jobs })), 'Jet')
    expect(jet(parked(4), [job(UnitTypeId.Jet, 1), elsewhere]).ready).toBe(true)
    expect(jet(parked(5), [job(UnitTypeId.Jet, 1), elsewhere]).ready).toBe(false)
    expect(jet(parked(5), [elsewhere]).ready).toBe(true)
  })
})

describe('hud queued tiles', () => {
  const queue = [
    job(UnitTypeId.MedTank, 1, 0.5),
    job(UnitTypeId.Scout, 1),
    job(UnitTypeId.MedTank, 2, 0.25),
    job(UnitTypeId.MedTank, 2),
    job(UnitTypeId.Jet, 3, 0.1),
  ]

  it('shows one tile per type with jobs, counting every yard', () => {
    const factory = unit(1, UnitTypeId.Factory)
    const model = hudModel(input({ units: [factory], yard: factory, queue }))
    expect(shown(model).filter((label) => label.startsWith('Queued'))).toEqual(['Queued Scout', 'Queued Med Tank', 'Queued Jet'])
    expect(find(model, 'Queued Med Tank')).toMatchObject({ count: 3, progress: 0.5, ready: true, slot: null })
    expect(find(model, 'Queued Scout')).toMatchObject({ count: 1, progress: 0 })
    expect(model.queued).toBe(true)
  })

  it('hides the queued split while no job exists', () => {
    expect(hudModel(input()).queued).toBe(false)
  })
})

describe('hud tile badge', () => {
  it('shows for more than one, or for one that has not started', () => {
    const factory = unit(1, UnitTypeId.Factory)
    const queue = [job(UnitTypeId.MedTank, 1, 0.4), job(UnitTypeId.Scout, 2, 0.6), job(UnitTypeId.Artillery, 2)]
    const model = hudModel(input({ units: [factory], yard: factory, queue }))
    expect(find(model, 'Queued Scout')).toMatchObject({ count: 1, badge: false })
    expect(find(model, 'Queued Artillery')).toMatchObject({ count: 1, badge: true })
    expect(find(model, 'Med Tank')).toMatchObject({ count: 1, badge: false })
    const pair = hudModel(input({ units: [factory], yard: factory, queue: [job(UnitTypeId.MedTank, 1, 0.4), job(UnitTypeId.MedTank, 1)] }))
    expect(find(pair, 'Med Tank')).toMatchObject({ count: 2, badge: true })
  })
})

describe('hud F-slots', () => {
  it('number the visible non-queue tiles from 1 in order', () => {
    const model = hudModel(input({ units: [unit(1, UnitTypeId.Factory, { progress: 0.5 })], queue: [job(UnitTypeId.Scout, 1)] }))
    const slots = model.tiles.filter((tile) => tile.slot !== null).map((tile) => [name(tile), tile.slot])
    expect(slots).toEqual([['Factory', 1], ['Turret', 2], ['Building', 3]])
    expect(find(model, 'Queued Scout')).toMatchObject({ visible: true, slot: null })
  })

  it('reads F1 and up from a key code', () => {
    expect(functionSlot('F1')).toBe(1)
    expect(functionSlot('F12')).toBe(12)
    expect(functionSlot('F0')).toBeNull()
    expect(functionSlot('KeyF')).toBeNull()
  })
})

describe('hud city hall', () => {
  it('shows no tile and carries the focus of the hall with its label', () => {
    const hall = town(ME, 6)
    hall.state.focus = -2
    const model = hudModel(input({ towns: [hall], units: [unit(1, UnitTypeId.Factory)], queue: [job(UnitTypeId.Scout, 1)], hall: 0 }))
    expect(shown(model)).toEqual([])
    expect(model.tiles.every((tile) => tile.slot === null)).toBe(true)
    expect(model.hall).toEqual({ focus: -2, label: 'Money ×4' })
    expect(hudModel(input()).hall).toBeNull()
  })

  it('labels the focus steps from Money ×4 to Growth ×4', () => {
    expect([-2, -1, 0, 1, 2].map(focusLabel)).toEqual(['Money ×4', 'Money ×2', 'Balanced', 'Growth ×2', 'Growth ×4'])
  })
})

describe('hud for spectators', () => {
  it('shows no tile', () => {
    const model = hudModel(input({ spectating: true, units: [unit(1, UnitTypeId.Factory)], queue: [job(UnitTypeId.Scout, 1)] }))
    expect(shown(model)).toEqual([])
  })
})
