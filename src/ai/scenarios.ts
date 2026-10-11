import { cityCenter, footprintNearCity, layoutCities, populationOf, projectCity, type CityLayout } from '../shared/cities.ts'
import { canPlaceFootprint } from '../shared/footprint.ts'
import {
  ClientMessageKind,
  type CityState,
  type ClientMessage,
  type TrainJob,
  type UnitSnapshot,
} from '../shared/protocol.ts'
import type { Terrain, TileCoord } from '../shared/tiles.ts'
import { ARTILLERY, FACTORY, HEAVY_TANK, MED_TANK, SCOUT, TURRET, UNIT_TYPES, UnitTypeId } from '../shared/unit-types.ts'

export const enum Scenario {
  Defend = 1,
  Build = 2,
  Train = 3,
  Capture = 4,
  Assault = 5,
  Scout = 6,
}

const CONTACT = 14
const ZONE = 16
const CALL_IN = 20
const COMFORT = 8

export type Brain = {
  playerId: number
  width: number
  height: number
  seed: number
  credits: number
  towns: readonly { x: number; y: number }[]
  units: readonly UnitSnapshot[]
  training: readonly TrainJob[]
  cities: readonly CityState[]
  terrain: ArrayLike<number>
}

type Zone = {
  x: number
  y: number
  radius: number
  scenario: Scenario
}

type Choice = {
  score: number
  zone: Zone
}

export function consider(brain: Brain, budget: number): ClientMessage[] {
  const layouts = cityLayouts(brain)
  const choice = choose(brain, layouts)
  if (!choice || budget <= 0) return []
  return plan(brain, layouts, choice.zone).slice(0, budget)
}

function choose(brain: Brain, layouts: readonly CityLayout[]): Choice | null {
  const choices: Choice[] = []
  const contact = nearestContact(brain)
  if (contact) {
    choices.push({
      score: 120,
      zone: { x: contact.tileX, y: contact.tileY, radius: ZONE, scenario: Scenario.Defend },
    })
  }
  const home = homeCity(brain, layouts)
  if (home && !factory(brain)) {
    const center = cityCenter(home)
    choices.push({ score: 90, zone: { x: center.x, y: center.y, radius: ZONE, scenario: Scenario.Build } })
  }
  if (finishedFactory(brain) && supplyUsed(brain) < COMFORT && supplyUsed(brain) < population(brain) && brain.credits >= SCOUT.cost) {
    const pad = home ? cityCenter(home) : average(ownMobile(brain))
    if (pad) choices.push({ score: 80, zone: { x: pad.x, y: pad.y, radius: ZONE, scenario: Scenario.Train } })
  }
  const assault = nearestEnemy(brain)
  if (assault && mobileCount(brain) >= 3) {
    choices.push({
      score: 70,
      zone: { x: assault.tileX, y: assault.tileY, radius: ZONE, scenario: Scenario.Assault },
    })
  }
  if (finishedFactory(brain) && supplyUsed(brain) < population(brain) && brain.credits >= SCOUT.cost) {
    const pad = home ? cityCenter(home) : average(ownMobile(brain))
    if (pad) choices.push({ score: 55, zone: { x: pad.x, y: pad.y, radius: ZONE, scenario: Scenario.Train } })
  }
  const capture = captureTarget(brain, layouts)
  if (capture && mobileCount(brain) >= 2) {
    const center = cityCenter(capture)
    choices.push({ score: 50, zone: { x: center.x, y: center.y, radius: ZONE, scenario: Scenario.Capture } })
  }
  if (finishedFactory(brain) && !own(brain).some((unit) => unit.typeId === UnitTypeId.Turret && unit.health > 0) && brain.credits >= TURRET.cost && home) {
    const center = cityCenter(home)
    choices.push({ score: 45, zone: { x: center.x, y: center.y, radius: ZONE, scenario: Scenario.Build } })
  }
  const scout = scoutTarget(brain, layouts)
  if (scout) {
    choices.push({ score: 20, zone: { x: scout.x, y: scout.y, radius: ZONE, scenario: Scenario.Scout } })
  }
  let best: Choice | null = null
  for (const choice of choices) {
    if (!best || choice.score > best.score) best = choice
  }
  return best
}

function plan(brain: Brain, layouts: readonly CityLayout[], zone: Zone): ClientMessage[] {
  if (zone.scenario === Scenario.Defend || zone.scenario === Scenario.Assault) return fight(brain, zone)
  if (zone.scenario === Scenario.Build) return build(brain, layouts, zone)
  if (zone.scenario === Scenario.Train) return train(brain)
  if (zone.scenario === Scenario.Capture) return capture(brain, layouts, zone)
  return scoutMove(brain, zone)
}

function fight(brain: Brain, zone: Zone): ClientMessage[] {
  const enemies = hostiles(brain).filter((unit) => near(unit, zone))
  const target = enemies[0] ?? nearestEnemy(brain)
  if (!target) return []
  const orders: ClientMessage[] = []
  for (const unit of committed(brain, zone)) {
    const type = UNIT_TYPES[unit.typeId]
    const dist = Math.hypot(unit.x - target.x, unit.z - target.z)
    if (dist <= type.weapon.range) continue
    if (unit.typeId === UnitTypeId.Artillery) {
      const tile = standoff(unit, target, type.weapon.range * 0.75)
      if (!aimed(unit, tile)) orders.push(move(unit.id, tile))
      continue
    }
    orders.push({ kind: ClientMessageKind.OrderAttack, unitId: unit.id, targetId: target.id })
  }
  return orders
}

function build(brain: Brain, layouts: readonly CityLayout[], zone: Zone): ClientMessage[] {
  const standing = factory(brain)
  if (!standing) {
    const spot = siteNear(brain, layouts, { x: zone.x, y: zone.y }, FACTORY.footprint)
    if (!spot) return []
    return [{ kind: ClientMessageKind.PlaceBuilding, typeId: UnitTypeId.Factory, tile: spot }]
  }
  if (standing.progress < 1 || brain.credits < TURRET.cost) return []
  if (own(brain).some((unit) => unit.typeId === UnitTypeId.Turret && unit.health > 0)) return []
  if (supplyUsed(brain) + TURRET.supply > population(brain)) return []
  const spot = siteNear(brain, layouts, { x: zone.x, y: zone.y }, TURRET.footprint)
  if (!spot) return []
  return [{ kind: ClientMessageKind.PlaceBuilding, typeId: UnitTypeId.Turret, tile: spot }]
}

function train(brain: Brain): ClientMessage[] {
  if (!finishedFactory(brain)) return []
  const typeId = nextTrain(brain)
  if (!typeId || supplyUsed(brain) + UNIT_TYPES[typeId].supply > population(brain)) return []
  return [{ kind: ClientMessageKind.Spawn, typeId }]
}

function capture(brain: Brain, layouts: readonly CityLayout[], zone: Zone): ClientMessage[] {
  const city = layouts.find((layout) => {
    const center = cityCenter(layout)
    return center.x === zone.x && center.y === zone.y
  })
  const tile = city ? cityCenter(city) : { x: zone.x, y: zone.y }
  const orders: ClientMessage[] = []
  for (const unit of committed(brain, zone)) {
    if (aimed(unit, tile)) continue
    orders.push(move(unit.id, tile))
  }
  return orders
}

function scoutMove(brain: Brain, zone: Zone): ClientMessage[] {
  const scout = ownMobile(brain).find((unit) => unit.typeId === UnitTypeId.Scout) ?? ownMobile(brain)[0]
  if (!scout) return []
  const tile = { x: zone.x, y: zone.y }
  if (aimed(scout, tile)) return []
  return [move(scout.id, tile)]
}

function nextTrain(brain: Brain): UnitTypeId | null {
  const counts = { scout: 0, med: 0, heavy: 0, artillery: 0 }
  const add = (typeId: UnitTypeId) => {
    if (typeId === UnitTypeId.Scout) counts.scout += 1
    else if (typeId === UnitTypeId.MedTank) counts.med += 1
    else if (typeId === UnitTypeId.HeavyTank) counts.heavy += 1
    else if (typeId === UnitTypeId.Artillery) counts.artillery += 1
  }
  for (const unit of ownMobile(brain)) add(unit.typeId)
  for (const job of brain.training) add(job.typeId)
  if (counts.scout < 2 && brain.credits >= SCOUT.cost) return UnitTypeId.Scout
  if (counts.med < 4 && brain.credits >= MED_TANK.cost) return UnitTypeId.MedTank
  if (counts.heavy < 2 && brain.credits >= HEAVY_TANK.cost) return UnitTypeId.HeavyTank
  if (counts.artillery < 1 && brain.credits >= ARTILLERY.cost) return UnitTypeId.Artillery
  if (brain.credits >= MED_TANK.cost) return UnitTypeId.MedTank
  return null
}

function committed(brain: Brain, zone: Zone): UnitSnapshot[] {
  const ranked = ownMobile(brain)
    .map((unit) => ({ unit, dist: Math.hypot(unit.tileX - zone.x, unit.tileY - zone.y) }))
    .filter((entry) => entry.dist <= zone.radius || (entry.unit.goal === null && entry.dist <= CALL_IN))
    .sort((a, b) => a.dist - b.dist)
  const idle = ranked.filter((entry) => entry.unit.goal === null)
  const pool = idle.length > 0 ? idle : ranked
  return pool.map((entry) => entry.unit)
}

function nearestContact(brain: Brain): UnitSnapshot | null {
  let best: UnitSnapshot | null = null
  let bestDist = CONTACT
  for (const friend of ownMobile(brain)) {
    for (const enemy of hostiles(brain)) {
      const dist = Math.hypot(friend.x - enemy.x, friend.z - enemy.z)
      if (dist >= bestDist) continue
      bestDist = dist
      best = enemy
    }
  }
  return best
}

function nearestEnemy(brain: Brain): UnitSnapshot | null {
  const origin = average(ownMobile(brain))
  let best: UnitSnapshot | null = null
  let bestDist = Infinity
  for (const enemy of hostiles(brain)) {
    const dist = origin
      ? (enemy.tileX - origin.x) ** 2 + (enemy.tileY - origin.y) ** 2
      : 0
    if (dist >= bestDist) continue
    bestDist = dist
    best = enemy
  }
  return best
}

function captureTarget(brain: Brain, layouts: readonly CityLayout[]): CityLayout | null {
  const origin = average(ownMobile(brain)) ?? homeCenter(brain, layouts)
  if (!origin) return null
  let best: CityLayout | null = null
  let bestDist = Infinity
  for (let i = 0; i < layouts.length; i++) {
    const state = brain.cities[i]
    if (state && state.ownerId === brain.playerId) continue
    const center = cityCenter(layouts[i])
    const dist = (center.x - origin.x) ** 2 + (center.y - origin.y) ** 2
    const neutral = !state || state.ownerId === 0
    const score = dist - (neutral ? 40 : 0)
    if (score >= bestDist) continue
    bestDist = score
    best = layouts[i]
  }
  return best
}

function scoutTarget(brain: Brain, layouts: readonly CityLayout[]): TileCoord | null {
  const origin = average(ownMobile(brain))
  if (!origin) return null
  let best: TileCoord | null = null
  let bestDist = Infinity
  for (let i = 0; i < layouts.length; i++) {
    if (brain.cities[i]?.ownerId === brain.playerId) continue
    const center = cityCenter(layouts[i])
    const dist = (center.x - origin.x) ** 2 + (center.y - origin.y) ** 2
    if (dist < bestDist) {
      bestDist = dist
      best = center
    }
  }
  return best
}

function homeCity(brain: Brain, layouts: readonly CityLayout[]): CityLayout | null {
  for (let i = 0; i < layouts.length; i++) {
    if (brain.cities[i]?.ownerId === brain.playerId) return layouts[i]
  }
  return null
}

function homeCenter(brain: Brain, layouts: readonly CityLayout[]): TileCoord | null {
  const home = homeCity(brain, layouts)
  return home ? cityCenter(home) : null
}

function cityLayouts(brain: Brain): CityLayout[] {
  if (brain.towns.length === 0 || brain.terrain.length === 0) return []
  const bases = layoutCities(brain.towns, brain.seed, brain.terrain, brain.width, brain.height)
  return bases.map((base, index) => projectCity(base, brain.cities[index]?.grown ?? 0, brain.terrain, brain.width, brain.height))
}

function siteNear(brain: Brain, layouts: readonly CityLayout[], origin: TileCoord, footprint: number): TileCoord | null {
  const owned = layouts.filter((_, index) => brain.cities[index]?.ownerId === brain.playerId)
  const blocked = buildingTiles(layouts)
  for (let radius = 1; radius <= 10; radius++) {
    for (let y = origin.y - radius; y <= origin.y + radius; y++) {
      for (let x = origin.x - radius; x <= origin.x + radius; x++) {
        if (Math.max(Math.abs(x - origin.x), Math.abs(y - origin.y)) !== radius) continue
        const tile = { x, y }
        if (!footprintNearCity(owned, tile, footprint)) continue
        if (!canPlaceFootprint(tile, footprint, brain.width, brain.height, (px, py) => brain.terrain[py * brain.width + px] as Terrain, brain.units)) continue
        if (coversBlocked(tile, footprint, blocked)) continue
        return tile
      }
    }
  }
  return null
}

function buildingTiles(layouts: readonly CityLayout[]): Set<string> {
  const blocked = new Set<string>()
  for (const layout of layouts) {
    for (const building of layout.buildings) blocked.add(`${building.x},${building.y}`)
  }
  return blocked
}

function coversBlocked(origin: TileCoord, footprint: number, blocked: ReadonlySet<string>): boolean {
  for (let dy = 0; dy < footprint; dy++) {
    for (let dx = 0; dx < footprint; dx++) {
      if (blocked.has(`${origin.x + dx},${origin.y + dy}`)) return true
    }
  }
  return false
}

function factory(brain: Brain): UnitSnapshot | undefined {
  return own(brain).find((unit) => unit.typeId === UnitTypeId.Factory && unit.health > 0)
}

function finishedFactory(brain: Brain): boolean {
  return own(brain).some((unit) => unit.typeId === UnitTypeId.Factory && unit.health > 0 && unit.progress >= 1)
}

function own(brain: Brain): UnitSnapshot[] {
  return brain.units.filter((unit) => unit.ownerId === brain.playerId && unit.health > 0)
}

function ownMobile(brain: Brain): UnitSnapshot[] {
  return own(brain).filter((unit) => UNIT_TYPES[unit.typeId].topSpeed > 0 && unit.progress >= 1)
}

function hostiles(brain: Brain): UnitSnapshot[] {
  return brain.units.filter((unit) => unit.ownerId !== brain.playerId && unit.ownerId !== 0 && unit.health > 0 && unit.progress >= 1)
}

function mobileCount(brain: Brain): number {
  return ownMobile(brain).length + brain.training.length
}

function supplyUsed(brain: Brain): number {
  let used = 0
  for (const unit of own(brain)) used += UNIT_TYPES[unit.typeId].supply
  for (const job of brain.training) used += UNIT_TYPES[job.typeId].supply
  return used
}

function population(brain: Brain): number {
  const layouts = layoutCities(brain.towns, brain.seed, brain.terrain, brain.width, brain.height)
  let people = 0
  for (let i = 0; i < layouts.length; i++) {
    const city = brain.cities[i]
    if (!city || city.ownerId !== brain.playerId) continue
    people += populationOf(projectCity(layouts[i], city.grown, brain.terrain, brain.width, brain.height), city.ruins)
  }
  return people
}

function average(units: readonly UnitSnapshot[]): TileCoord | null {
  if (units.length === 0) return null
  let x = 0
  let y = 0
  for (const unit of units) {
    x += unit.tileX
    y += unit.tileY
  }
  return { x: Math.round(x / units.length), y: Math.round(y / units.length) }
}

function near(unit: UnitSnapshot, zone: Zone): boolean {
  return Math.hypot(unit.tileX - zone.x, unit.tileY - zone.y) <= zone.radius
}

function aimed(unit: UnitSnapshot, tile: TileCoord): boolean {
  return unit.goal !== null && Math.abs(unit.goal.x - tile.x) <= 2 && Math.abs(unit.goal.y - tile.y) <= 2
}

function move(unitId: number, tile: TileCoord): ClientMessage {
  return { kind: ClientMessageKind.OrderMove, unitId, tile }
}

function standoff(unit: UnitSnapshot, target: UnitSnapshot, distance: number): TileCoord {
  const dx = unit.x - target.x
  const dz = unit.z - target.z
  const len = Math.hypot(dx, dz) || 1
  return {
    x: Math.round(target.x + (dx / len) * distance),
    y: Math.round(target.z + (dz / len) * distance),
  }
}
