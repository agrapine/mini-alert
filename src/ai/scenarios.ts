import { cityCenter, cityContains, footprintNearCity, growCity, layoutCities, populationOf, projectCity, type CityLayout } from '../shared/cities.ts'
import { canPlaceFootprint } from '../shared/footprint.ts'
import {
  ClientMessageKind,
  type CityState,
  type ClientMessage,
  type TrainJob,
  type UnitSnapshot,
} from '../shared/protocol.ts'
import { isWalkableTerrain, type Terrain, type TileCoord } from '../shared/tiles.ts'
import { ARTILLERY, FACTORY, HEAVY_TANK, MED_TANK, SCOUT, TURRET, UNIT_TYPES, UnitTypeId } from '../shared/unit-types.ts'

export const enum Scenario {
  Defend = 1,
  Build = 2,
  Train = 3,
  Capture = 4,
  Assault = 5,
  Scout = 6,
  Garrison = 7,
}

export const enum Lane {
  Home = 1,
  Contact = 2,
  March = 3,
}

const CONTACT = 14
const ZONE = 16
const CALL_IN = 20
const ASSAULT_ARMY = 3
const ENEMY_CITY_ARMY = 2

export type Brain = {
  playerId: number
  width: number
  height: number
  seed: number
  credits: number
  towns: readonly { x: number; y: number }[]
  units: readonly UnitSnapshot[]
  training: readonly TrainJob[]
  cities: readonly (CityState | null)[]
  terrain: ArrayLike<number>
  known?: ArrayLike<number>
  layouts?: readonly (CityLayout | null)[]
}

export type Candidate = {
  lane: Lane
  scenario: Scenario
  score: number
  x: number
  y: number
  orders: number
  blocked: string
}

export type Thought = {
  candidates: Candidate[]
  orders: ClientMessage[]
}

type Zone = {
  x: number
  y: number
  radius: number
  scenario: Scenario
}

type Plan = {
  orders: ClientMessage[]
  hold: number[]
  blocked: string
}

export function scenarioName(scenario: Scenario): string {
  if (scenario === Scenario.Defend) return 'defend'
  if (scenario === Scenario.Build) return 'build'
  if (scenario === Scenario.Train) return 'train'
  if (scenario === Scenario.Capture) return 'capture'
  if (scenario === Scenario.Assault) return 'assault'
  if (scenario === Scenario.Scout) return 'explore'
  return 'garrison'
}

export function laneName(lane: Lane): string {
  if (lane === Lane.Home) return 'home'
  if (lane === Lane.Contact) return 'contact'
  return 'march'
}

export function consider(brain: Brain, budget: number): Thought {
  if (budget <= 0) return { candidates: [], orders: [] }
  const layouts = cityLayouts(brain)
  const reserved = new Set<number>()
  const candidates: Candidate[] = []
  const orders: ClientMessage[] = []
  const home = homeCity(brain, layouts)
  const center = home ? cityCenter(home) : null
  let garrisoned = false

  const note = (lane: Lane, scenario: Scenario, score: number, at: TileCoord, blocked: string, issued: number) => {
    candidates.push({ lane, scenario, score, x: at.x, y: at.y, orders: issued, blocked })
  }

  const apply = (lane: Lane, scenario: Scenario, score: number, at: TileCoord, plan: Plan): boolean => {
    if (plan.blocked) {
      note(lane, scenario, score, at, plan.blocked, 0)
      return false
    }
    const space = budget - orders.length
    const queued = space > 0 ? plan.orders.slice(0, space) : []
    if (plan.orders.length > 0 && queued.length === 0 && plan.hold.length === 0) return false
    for (const id of plan.hold) reserved.add(id)
    for (const order of queued) {
      orders.push(order)
      const id = orderedUnit(order)
      if (id !== null) reserved.add(id)
    }
    note(lane, scenario, score, at, '', queued.length)
    return true
  }

  if (home && center && !factory(brain)) {
    const built = build(brain, layouts, zoneAt(center, Scenario.Build))
    if (built.length > 0) apply(Lane.Home, Scenario.Build, 90, center, acting(built))
    else {
      const blocked = supplyUsed(brain) + FACTORY.supply > population(brain) ? 'pop' : 'no site'
      apply(Lane.Home, Scenario.Build, 90, center, idle(blocked))
      if (blocked === 'pop' && canGrow(brain, home)) garrisoned = garrison(brain, home, center, apply)
    }
  }

  if (home && center && finishedFactory(brain)) {
    const trained = train(brain)
    if (trained.length > 0) apply(Lane.Home, Scenario.Train, 80, center, acting(trained))
    else if (trainBlocked(brain)) {
      apply(Lane.Home, Scenario.Train, 80, center, idle('pop'))
      if (!garrisoned && canGrow(brain, home)) garrisoned = garrison(brain, home, center, apply)
    }
    if (!own(brain).some((unit) => unit.typeId === UnitTypeId.Turret && unit.health > 0) && brain.credits >= TURRET.cost) {
      const placed = build(brain, layouts, zoneAt(center, Scenario.Build))
      if (placed.length > 0) apply(Lane.Home, Scenario.Build, 45, center, acting(placed))
      else {
        const blocked = supplyUsed(brain) + TURRET.supply > population(brain) ? 'pop' : 'no site'
        apply(Lane.Home, Scenario.Build, 45, center, idle(blocked))
      }
    }
  }

  const contact = nearestContact(brain)
  if (contact) {
    const at = { x: contact.tileX, y: contact.tileY }
    apply(Lane.Contact, Scenario.Defend, 120, at, fight(brain, zoneAt(at, Scenario.Defend), reserved, false))
  }

  let marched = false
  const assault = nearestEnemy(brain)
  if (assault) {
    const at = { x: assault.tileX, y: assault.tileY }
    const plan = mobileCount(brain) < ASSAULT_ARMY
      ? idle('army too small')
      : fight(brain, zoneAt(at, Scenario.Assault), reserved, true)
    if (apply(Lane.March, Scenario.Assault, 70, at, plan)) marched = true
  }
  const captureCity = captureTarget(brain, layouts)
  if (!marched && captureCity) {
    const at = cityCenter(captureCity)
    const index = layouts.indexOf(captureCity)
    const state = index >= 0 ? brain.cities[index] : null
    const neutral = !state || state.ownerId === 0
    const plan = mobileCount(brain) < (neutral ? 1 : ENEMY_CITY_ARMY)
      ? idle('army too small')
      : capture(brain, at, reserved)
    if (apply(Lane.March, Scenario.Capture, 50, at, plan)) marched = true
  }
  if (!marched) {
    const explorer = freeScout(brain, reserved)
    const at = explorer ? frontier(brain, explorer) ?? scoutTarget(brain, layouts) : null
    const plan = !explorer || !at ? idle('no target') : scoutMove(explorer, at)
    apply(Lane.March, Scenario.Scout, 20, at ?? center ?? { x: 0, y: 0 }, plan)
  }

  return { candidates, orders }
}

function zoneAt(at: TileCoord, scenario: Scenario): Zone {
  return { x: at.x, y: at.y, radius: ZONE, scenario }
}

function acting(orders: ClientMessage[], hold: number[] = []): Plan {
  return { orders, hold, blocked: '' }
}

function idle(blocked: string): Plan {
  return { orders: [], hold: [], blocked }
}

function garrison(
  brain: Brain,
  home: CityLayout,
  center: TileCoord,
  apply: (lane: Lane, scenario: Scenario, score: number, at: TileCoord, plan: Plan) => boolean,
): boolean {
  const unit = garrisonUnit(brain, home)
  if (!unit) {
    apply(Lane.Home, Scenario.Garrison, 85, center, idle('no target'))
    return false
  }
  if (cityContains(home, unit.tileX, unit.tileY)) {
    apply(Lane.Home, Scenario.Garrison, 85, center, acting([], [unit.id]))
    return true
  }
  apply(Lane.Home, Scenario.Garrison, 85, center, acting([move(unit.id, center)]))
  return true
}

function fight(brain: Brain, zone: Zone, reserved: ReadonlySet<number>, pull: boolean): Plan {
  const enemies = hostiles(brain).filter((unit) => near(unit, zone))
  const target = enemies[0] ?? (pull ? nearestEnemy(brain) : null)
  if (!target) return idle('no target')
  let units = committed(brain, zone, reserved)
  if (units.length === 0 && pull) units = freeMobile(brain, reserved)
  if (units.length === 0) return idle('no target')
  const orders: ClientMessage[] = []
  const hold: number[] = []
  for (const unit of units) {
    const type = UNIT_TYPES[unit.typeId]
    const dist = Math.hypot(unit.x - target.x, unit.z - target.z)
    if (dist <= type.weapon.range && unit.attackId === target.id) {
      hold.push(unit.id)
      continue
    }
    if (unit.typeId === UnitTypeId.Artillery) {
      const tile = standoff(unit, target, type.weapon.range * 0.75)
      if (aimed(unit, tile)) hold.push(unit.id)
      else orders.push(move(unit.id, tile))
      continue
    }
    orders.push({ kind: ClientMessageKind.OrderAttack, unitId: unit.id, targetId: target.id })
  }
  if (orders.length === 0 && hold.length === 0) return idle('no target')
  return acting(orders, hold)
}

function build(brain: Brain, layouts: readonly (CityLayout | null)[], zone: Zone): ClientMessage[] {
  const standing = factory(brain)
  if (!standing) {
    if (supplyUsed(brain) + FACTORY.supply > population(brain)) return []
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

function trainBlocked(brain: Brain): boolean {
  const typeId = nextTrain(brain)
  return typeId !== null && supplyUsed(brain) + UNIT_TYPES[typeId].supply > population(brain)
}

function capture(brain: Brain, tile: TileCoord, reserved: ReadonlySet<number>): Plan {
  const units = freeMobile(brain, reserved)
  if (units.length === 0) return idle('no target')
  const orders: ClientMessage[] = []
  const hold: number[] = []
  for (const unit of units) {
    if (aimed(unit, tile)) hold.push(unit.id)
    else orders.push(move(unit.id, tile))
  }
  if (orders.length === 0 && hold.length === 0) return idle('no target')
  return acting(orders, hold)
}

function scoutMove(scout: UnitSnapshot, tile: TileCoord): Plan {
  if (aimed(scout, tile)) return acting([], [scout.id])
  return acting([move(scout.id, tile)])
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

function committed(brain: Brain, zone: Zone, reserved: ReadonlySet<number>): UnitSnapshot[] {
  const ranked = ownMobile(brain)
    .filter((unit) => !reserved.has(unit.id))
    .map((unit) => ({ unit, dist: Math.hypot(unit.tileX - zone.x, unit.tileY - zone.y) }))
    .filter((entry) => entry.dist <= zone.radius || (entry.unit.goal === null && entry.dist <= CALL_IN))
    .sort((a, b) => a.dist - b.dist)
  const waiting = ranked.filter((entry) => entry.unit.goal === null)
  const pool = waiting.length > 0 ? waiting : ranked
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

function captureTarget(brain: Brain, layouts: readonly (CityLayout | null)[]): CityLayout | null {
  const origin = average(ownMobile(brain)) ?? homeCenter(brain, layouts)
  if (!origin) return null
  let best: CityLayout | null = null
  let bestDist = Infinity
  for (let i = 0; i < layouts.length; i++) {
    const layout = layouts[i]
    const state = brain.cities[i]
    if (!layout || (state && state.ownerId === brain.playerId)) continue
    const center = cityCenter(layout)
    const dist = (center.x - origin.x) ** 2 + (center.y - origin.y) ** 2
    const neutral = !state || state.ownerId === 0
    const score = dist - (neutral ? 40 : 0)
    if (score >= bestDist) continue
    bestDist = score
    best = layout
  }
  return best
}

function scoutTarget(brain: Brain, layouts: readonly (CityLayout | null)[]): TileCoord | null {
  const origin = average(freeMobile(brain, new Set()))
  if (!origin) return null
  let best: TileCoord | null = null
  let bestDist = Infinity
  for (let i = 0; i < layouts.length; i++) {
    const layout = layouts[i]
    if (!layout || brain.cities[i]?.ownerId === brain.playerId) continue
    const center = cityCenter(layout)
    const dist = (center.x - origin.x) ** 2 + (center.y - origin.y) ** 2
    if (dist < bestDist) {
      bestDist = dist
      best = center
    }
  }
  return best
}

function frontier(brain: Brain, origin: UnitSnapshot): TileCoord | null {
  const known = brain.known
  if (!known || known.length !== brain.width * brain.height) return null
  let close: TileCoord | null = null
  let closeDist = Infinity
  let far: TileCoord | null = null
  let farDist = Infinity
  for (let y = 0; y < brain.height; y++) {
    for (let x = 0; x < brain.width; x++) {
      const index = y * brain.width + x
      if (known[index] !== 1 || !isWalkableTerrain(brain.terrain[index] as Terrain)) continue
      if (!besideUnknown(known, brain.width, brain.height, x, y)) continue
      const dist = (x - origin.tileX) ** 2 + (y - origin.tileY) ** 2
      if (dist <= 0) continue
      if (dist < closeDist) {
        closeDist = dist
        close = { x, y }
      }
      if (dist >= 16 && dist < farDist) {
        farDist = dist
        far = { x, y }
      }
    }
  }
  return far ?? close
}

function besideUnknown(known: ArrayLike<number>, width: number, height: number, x: number, y: number): boolean {
  if (x + 1 < width && known[y * width + x + 1] !== 1) return true
  if (x > 0 && known[y * width + x - 1] !== 1) return true
  if (y + 1 < height && known[(y + 1) * width + x] !== 1) return true
  return y > 0 && known[(y - 1) * width + x] !== 1
}

function homeCity(brain: Brain, layouts: readonly (CityLayout | null)[]): CityLayout | null {
  for (let i = 0; i < layouts.length; i++) {
    const layout = layouts[i]
    if (layout && brain.cities[i]?.ownerId === brain.playerId) return layout
  }
  return null
}

function homeCenter(brain: Brain, layouts: readonly (CityLayout | null)[]): TileCoord | null {
  const home = homeCity(brain, layouts)
  return home ? cityCenter(home) : null
}

function cityLayouts(brain: Brain): readonly (CityLayout | null)[] {
  if (brain.layouts) return brain.layouts
  if (brain.towns.length === 0 || brain.terrain.length === 0) return []
  const bases = layoutCities(brain.towns, brain.seed, brain.terrain, brain.width, brain.height)
  return bases.map((base, index) =>
    projectCity(base, brain.cities[index]?.grown ?? 0, brain.terrain, brain.width, brain.height, brain.cities[index]?.sites ?? []),
  )
}

function siteNear(brain: Brain, layouts: readonly (CityLayout | null)[], origin: TileCoord, footprint: number): TileCoord | null {
  const owned = layouts.filter((layout, index): layout is CityLayout => layout !== null && brain.cities[index]?.ownerId === brain.playerId)
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

function buildingTiles(layouts: readonly (CityLayout | null)[]): Set<string> {
  const blocked = new Set<string>()
  for (const layout of layouts) {
    if (!layout) continue
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

function freeMobile(brain: Brain, reserved: ReadonlySet<number>): UnitSnapshot[] {
  return ownMobile(brain).filter((unit) => !reserved.has(unit.id))
}

function freeScout(brain: Brain, reserved: ReadonlySet<number>): UnitSnapshot | null {
  return ownMobile(brain).find((unit) => unit.typeId === UnitTypeId.Scout && !reserved.has(unit.id)) ?? null
}

function canGrow(brain: Brain, home: CityLayout): boolean {
  const next = growCity(home, brain.terrain, brain.width, brain.height)
  return next !== null && populationOf(next) > populationOf(home)
}

function garrisonUnit(brain: Brain, home: CityLayout): UnitSnapshot | null {
  const free = ownMobile(brain)
  const inside = free.filter((unit) => cityContains(home, unit.tileX, unit.tileY))
  const pool = inside.length > 0 ? inside : free
  return pool.find((unit) => unit.typeId !== UnitTypeId.Scout) ?? pool[0] ?? null
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
  const layouts = cityLayouts(brain)
  let people = 0
  for (let i = 0; i < layouts.length; i++) {
    const city = brain.cities[i]
    const layout = layouts[i]
    if (!city || !layout || city.ownerId !== brain.playerId) continue
    people += populationOf(layout, city.ruins)
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

function orderedUnit(order: ClientMessage): number | null {
  if (order.kind === ClientMessageKind.OrderMove || order.kind === ClientMessageKind.OrderAttack || order.kind === ClientMessageKind.OrderAttackGround) {
    return order.unitId
  }
  return null
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
