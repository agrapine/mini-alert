import { populationOf, type CityLayout } from '../shared/cities.ts'
import { baysFree } from '../shared/flight.ts'
import type { CityState, TrainJob, UnitSnapshot } from '../shared/protocol.ts'
import { AIRPORT, ARTILLERY, CRUISER, FACTORY, GUNSHIP, HEAVY_TANK, HELIPAD, JET, MED_TANK, SCOUT, SHIPYARD, TURRET, UNIT_TYPES, UnitTypeId, yardOf } from '../shared/unit-types.ts'

export const enum PingState {
  None = 0,
  Good = 1,
  Slow = 2,
  Bad = 3,
}

export const enum Trend {
  Steady = 0,
  Up = 1,
  Down = 2,
}

export const enum TileKind {
  Structure = 0,
  City = 1,
  Train = 2,
  Queued = 3,
}

export type HudInput = {
  playerId: number | null
  units: readonly UnitSnapshot[]
  queue: readonly TrainJob[]
  cities: readonly (CityState | null)[]
  layouts: readonly (CityLayout | null)[]
  yard: UnitSnapshot | null
  placing: UnitTypeId | null
  raising: boolean
  hall: number | null
  quote: number | null
  rtt: number | null
  spectating: boolean
}

export type Ping = { state: PingState.None } | { state: PingState.Good | PingState.Slow | PingState.Bad; ms: number }

type TileHead = { kind: TileKind.City } | { kind: TileKind.Structure | TileKind.Train | TileKind.Queued; type: UnitTypeId }

type TileState = {
  cost: string
  count: number
  progress: number
  ready: boolean
  visible: boolean
  armed: boolean
  badge: boolean
  slot: number | null
}

export type HudTile = TileHead & TileState

export type HudModel = {
  army: number
  population: number
  cities: number
  over: boolean
  ping: Ping
  tiles: HudTile[]
  queued: boolean
  hall: { focus: number; label: string } | null
}

type Tally = Map<UnitTypeId, { count: number; progress: number }>

const STRUCTURES = [FACTORY, TURRET, AIRPORT, HELIPAD, SHIPYARD]
const TRAINABLE = [SCOUT, MED_TANK, HEAVY_TANK, ARTILLERY, JET, GUNSHIP, CRUISER]
const NEEDS_FACTORY = new Set<UnitTypeId>([UnitTypeId.Airport, UnitTypeId.Helipad, UnitTypeId.Shipyard])
const FOCUS_LABEL = ['Money ×4', 'Money ×2', 'Balanced', 'Growth ×2', 'Growth ×4']
const IDLE = { count: 0, progress: 0 }
const COUNT_SECONDS = 0.15
const TREND_GAP = 30
const SLOW_PING_MS = 150
const BAD_PING_MS = 300

export function hudModel(input: HudInput): HudModel {
  const { yard, hall } = input
  const own = input.units.filter((unit) => unit.ownerId === input.playerId && unit.health > 0)
  let army = 0
  for (const unit of own) army += UNIT_TYPES[unit.typeId].supply
  let training = 0
  for (const job of input.queue) training += UNIT_TYPES[job.typeId].supply
  const held = heldCities(input)
  const room = (supply: number) => army + training + supply <= held.population
  const factory = own.some((unit) => unit.typeId === UnitTypeId.Factory && unit.progress >= 1)
  const grid = hall === null && !input.spectating
  const tiles: HudTile[] = []

  const sites = structureSites(own)
  for (const type of STRUCTURES) {
    const { count, progress } = sites.get(type.id) ?? IDLE
    const gate = !NEEDS_FACTORY.has(type.id) || factory
    tiles.push(tile({ kind: TileKind.Structure, type: type.id }, {
      cost: costLine(type.cost, type.supply),
      count,
      progress,
      ready: gate && room(type.supply),
      visible: grid && yard === null && (gate || count > 0 || progress > 0),
      armed: input.placing === type.id,
    }))
  }
  tiles.push(tile({ kind: TileKind.City }, {
    cost: costLine(input.quote ?? 0, 1),
    count: 0,
    progress: 0,
    ready: true,
    visible: grid && yard === null,
    armed: input.raising,
  }))

  const yardJobs = tallyJobs(yard === null ? [] : input.queue.filter((job) => job.yardId === yard.id))
  for (const type of TRAINABLE) {
    const { count, progress } = yardJobs.get(type.id) ?? IDLE
    const trains = yard !== null && yardOf(type.id) === yard.typeId
    tiles.push(tile({ kind: TileKind.Train, type: type.id }, {
      cost: costLine(type.cost, type.supply),
      count,
      progress,
      ready: trains && yard.progress >= 1 && room(type.supply) && (type.id !== UnitTypeId.Jet || jetApron(own, input.queue, yard) > 0),
      visible: grid && trains,
      armed: false,
    }))
  }

  const allJobs = tallyJobs(input.queue)
  for (const type of TRAINABLE) {
    const { count, progress } = allJobs.get(type.id) ?? IDLE
    tiles.push(tile({ kind: TileKind.Queued, type: type.id }, {
      cost: costLine(type.cost, type.supply),
      count,
      progress,
      ready: count > 0,
      visible: grid && count > 0,
      armed: false,
    }))
  }

  let slot = 0
  for (const entry of tiles) if (entry.visible && entry.kind !== TileKind.Queued) entry.slot = ++slot

  const focus = hall === null ? null : (input.cities[hall]?.focus ?? 0)
  return {
    army,
    population: held.population,
    cities: held.cities,
    over: army > held.population,
    ping: pingOf(input.rtt),
    tiles,
    queued: input.queue.length > 0,
    hall: focus === null ? null : { focus, label: focusLabel(focus) },
  }
}

export function focusLabel(step: number): string {
  return FOCUS_LABEL[step + 2] ?? 'Balanced'
}

export function functionSlot(code: string): number | null {
  const match = /^F(\d+)$/.exec(code)
  if (!match) return null
  const slot = Number(match[1])
  return slot >= 1 ? slot : null
}

export class CreditCounter {
  shown = 0
  trend = Trend.Steady

  snap(credits: number) {
    this.shown = credits
    this.trend = Trend.Steady
  }

  ease(target: number, dt: number) {
    const blend = dt <= 0 ? 1 : 1 - Math.exp(-dt / COUNT_SECONDS)
    this.shown += (target - this.shown) * blend
    if (Math.abs(target - this.shown) < 0.5) this.shown = target
    const gap = target - this.shown
    this.trend = gap > TREND_GAP ? Trend.Up : gap < -TREND_GAP ? Trend.Down : Trend.Steady
  }
}

function tile(head: TileHead, state: Omit<TileState, 'badge' | 'slot'>): HudTile {
  return { ...head, ...state, badge: state.count > 1 || (state.count === 1 && state.progress <= 0), slot: null }
}

function pingOf(rtt: number | null): Ping {
  if (rtt === null) return { state: PingState.None }
  const ms = Math.round(rtt)
  if (rtt > BAD_PING_MS) return { state: PingState.Bad, ms }
  if (rtt > SLOW_PING_MS) return { state: PingState.Slow, ms }
  return { state: PingState.Good, ms }
}

function heldCities(input: HudInput): { cities: number; population: number } {
  let cities = 0
  let population = 0
  for (let i = 0; i < input.layouts.length; i++) {
    const state = input.cities[i]
    const layout = input.layouts[i]
    if (!state || !layout || state.ownerId !== input.playerId) continue
    cities += 1
    population += populationOf(layout, state.ruins)
  }
  return { cities, population }
}

function structureSites(own: readonly UnitSnapshot[]): Tally {
  const sites: Tally = new Map()
  for (const unit of own) {
    if (unit.progress >= 1 || UNIT_TYPES[unit.typeId].topSpeed > 0) continue
    const site = sites.get(unit.typeId) ?? { count: 0, progress: 0 }
    site.count += 1
    if (unit.progress > site.progress) site.progress = unit.progress
    sites.set(unit.typeId, site)
  }
  return sites
}

function tallyJobs(jobs: readonly TrainJob[]): Tally {
  const tally: Tally = new Map()
  const heads = new Set<number>()
  for (const job of jobs) {
    const entry = tally.get(job.typeId) ?? { count: 0, progress: 0 }
    entry.count += 1
    tally.set(job.typeId, entry)
    if (heads.has(job.yardId)) continue
    heads.add(job.yardId)
    if (job.progress > entry.progress) entry.progress = job.progress
  }
  return tally
}

function jetApron(own: readonly UnitSnapshot[], queue: readonly TrainJob[], airport: UnitSnapshot): number {
  const parked: { x: number; y: number; bay: number }[] = []
  for (const unit of own) {
    if (unit.typeId !== UnitTypeId.Jet || !unit.home || unit.bay === undefined || unit.bay < 0) continue
    if (unit.home.x !== airport.tileX || unit.home.y !== airport.tileY) continue
    parked.push({ x: unit.home.x, y: unit.home.y, bay: unit.bay })
  }
  let queued = 0
  for (const job of queue) if (job.typeId === UnitTypeId.Jet && job.yardId === airport.id) queued += 1
  return baysFree([{ x: airport.tileX, y: airport.tileY }], parked) - queued
}

function costLine(credits: number, supply: number): string {
  const price = credits > 0 ? credits.toLocaleString('en-US') : ''
  if (supply <= 0) return price
  return price ? `${price} · ${supply}` : String(supply)
}
