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
import {
  AIRPORT,
  ARTILLERY,
  CRUISER,
  domainOf,
  FACTORY,
  GUNSHIP,
  HELIPAD,
  HEAVY_TANK,
  JET,
  MED_TANK,
  MoveDomain,
  SCOUT,
  SHIPYARD,
  TURRET,
  UNIT_TYPES,
  UnitTypeId,
  yardOf,
  type UnitType,
} from '../shared/unit-types.ts'

export const enum Scenario {
  Defend = 1,
  Build = 2,
  Train = 3,
  Capture = 4,
  Assault = 5,
  Scout = 6,
  Garrison = 7,
  Muster = 8,
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
const GROW_LIMIT = 24
const PLAN_LIMIT = 36
const GROUP = 6
const CLUSTER = 12
const MUSTER_SPREAD = 8
const ALARM = 26
const EDGE = 0.9
const INCOMING_POWER = 8

export type Mood = {
  now: number
  pop: number
  popAt: number
  plan: number
  atX: number
  atY: number
  planAt: number
  salt: number
  banX: number
  banY: number
  near: number
}

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
  mood?: Mood
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
  mood: Mood
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
  if (scenario === Scenario.Garrison) return 'garrison'
  return 'muster'
}

export function laneName(lane: Lane): string {
  if (lane === Lane.Home) return 'home'
  if (lane === Lane.Contact) return 'contact'
  return 'march'
}

export function consider(input: Brain, budget: number): Thought {
  const mood = remember(input)
  const brain: Brain = { ...input, mood }
  if (budget <= 0) return { candidates: [], orders: [], mood }
  const layouts = cityLayouts(brain)
  const reserved = new Set<number>()
  const candidates: Candidate[] = []
  const orders: ClientMessage[] = []
  const home = homeCity(brain, layouts)
  const center = home ? cityCenter(home) : null
  const picture = assess(brain, center)

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
      for (const id of orderedUnits(order)) reserved.add(id)
    }
    note(lane, scenario, score, at, '', queued.length)
    return true
  }

  const growthStale = mood.now - mood.popAt >= GROW_LIMIT
  let timedOut = false
  let acted: { scenario: Scenario; x: number; y: number } | null = null
  const finish = (lane: Lane, scenario: Scenario, at: TileCoord, plan: Plan): boolean => {
    const near = nearestOwn(brain, at)
    const sameSpot = lane === Lane.March && mood.plan === scenario && mood.atX === at.x && mood.atY === at.y
    if (!sameSpot) mood.near = near
    else if (near + 1 < mood.near) {
      mood.near = near
      mood.planAt = mood.now
    }
    const stuck = sameSpot && near > 3 && mood.now - mood.planAt >= PLAN_LIMIT
    if (stuck) {
      timedOut = true
      mood.banX = at.x
      mood.banY = at.y
      note(lane, scenario, 0, at, 'timeout', 0)
      return false
    }
    const ok = apply(lane, scenario, lane === Lane.March ? 70 : 85, at, plan)
    if (ok && lane === Lane.March) acted = { scenario, x: at.x, y: at.y }
    return ok
  }

  holdGrowth(brain, layouts, apply, growthStale)
  if (growthStale && center) note(Lane.Home, Scenario.Garrison, 85, center, 'timeout', 0)

  if (home && center && !factory(brain)) {
    const built = build(brain, layouts, zoneAt(center, Scenario.Build))
    if (built.length > 0) apply(Lane.Home, Scenario.Build, 90, center, acting(built))
    else {
      const blocked = supplyUsed(brain) + FACTORY.supply > population(brain) ? 'pop' : 'no site'
      apply(Lane.Home, Scenario.Build, 90, center, idle(blocked))
    }
  }

  if (center && finishedFactory(brain)) {
    const stock = tally(brain)
    const earlyTurret = stock.turret < 1 && stock.med >= 2 && afford(brain, TURRET)
    const typeId = earlyTurret ? null : nextTrain(brain)
    const trained = typeId === null ? [] : train(brain, typeId)
    if (trained.length > 0) apply(Lane.Home, Scenario.Train, 80, center, acting(trained))
    else if (typeId !== null) apply(Lane.Home, Scenario.Train, 80, center, idle('pop'))
    else {
      const placed = placeNext(brain, layouts, center)
      if (placed.length > 0) apply(Lane.Home, Scenario.Build, 45, center, acting(placed))
      else if (landReady(stock) && afford(brain, MED_TANK)) {
        apply(Lane.Home, Scenario.Train, 80, center, acting(train(brain, UnitTypeId.MedTank)))
      }
    }
  }

  if (picture.dangerous && center) {
    note(Lane.Contact, Scenario.Defend, 100, { x: picture.dangerous.x, y: picture.dangerous.y }, threatLabel(picture.dangerous, center), 0)
  }

  const contact = nearestContact(brain)
  if (contact) {
    const at = { x: contact.tileX, y: contact.tileY }
    apply(Lane.Contact, Scenario.Defend, 120, at, fight(brain, zoneAt(at, Scenario.Defend), reserved, false))
  }

  let marched = false
  const looked = survey(brain, reserved, finish)
  if (picture.incoming && center) {
    const at = { x: Math.round(picture.incoming.x), y: Math.round(picture.incoming.y) }
    const local = powerNear(ownMobile(brain), center.x, center.y, ALARM)
    const plan = local >= picture.incoming.power * EDGE
      ? fight(brain, zoneAt(at, Scenario.Defend), reserved, true)
      : regroup(freeMobile(brain, reserved), center)
    if (finish(Lane.March, Scenario.Muster, center, plan)) marched = true
  }
  const assault = nearestEnemy(brain)
  if (!marched && assault) {
    const at = { x: assault.tileX, y: assault.tileY }
    const choice = mobileCount(brain) < ASSAULT_ARMY
      ? { scenario: Scenario.Assault, plan: idle('army too small') }
      : engage(brain, assault, reserved)
    if (finish(Lane.March, choice.scenario, at, choice.plan)) marched = true
  }
  const captureCity = captureTarget(brain, layouts)
  if (!marched && captureCity) {
    const at = rallyTile(brain, captureCity)
    const index = layouts.indexOf(captureCity)
    const state = index >= 0 ? brain.cities[index] : null
    const neutral = !state || state.ownerId === 0
    const guard = powerNear(hostiles(brain), at.x, at.y, CLUSTER)
    const mine = powerOf(freeMobile(brain, reserved).filter((unit) => domainOf(UNIT_TYPES[unit.typeId]) !== MoveDomain.Water))
    const plan = mobileCount(brain) < (neutral ? 1 : ENEMY_CITY_ARMY)
      ? idle('army too small')
      : guard > mine * EDGE
        ? idle('outmatched')
        : capture(brain, at, reserved)
    if (finish(Lane.March, Scenario.Capture, at, plan)) marched = true
  }
  if (!marched && !looked) {
    const explorer = freeMobile(brain, reserved).find((unit) => unit.typeId === UnitTypeId.Scout) ?? (hostiles(brain).length === 0 ? freeMobile(brain, reserved)[0] : null)
    const at = explorer ? frontier(brain, explorer) ?? scoutTarget(brain, layouts) : null
    const plan = !explorer || !at ? idle('no target') : scoutMove(explorer, at)
    finish(Lane.March, Scenario.Scout, at ?? center ?? { x: 0, y: 0 }, plan)
  }

  return { candidates, orders, mood: settle(mood, acted, timedOut) }
}

function remember(brain: Brain): Mood {
  const now = brain.mood?.now ?? 0
  const pop = population(brain)
  const salt = brain.mood?.salt ?? brain.playerId
  const plan = brain.mood?.plan ?? 0
  const atX = brain.mood?.atX ?? -1
  const atY = brain.mood?.atY ?? -1
  const planAt = brain.mood?.planAt ?? now
  const banX = brain.mood?.banX ?? -1
  const banY = brain.mood?.banY ?? -1
  const near = brain.mood?.near ?? 1e9
  if (!brain.mood || brain.mood.pop !== pop) {
    return { now, pop, popAt: now, plan, atX, atY, planAt, salt, banX, banY, near }
  }
  return { ...brain.mood, now, pop, salt, banX, banY, near }
}

function settle(mood: Mood, acted: { scenario: Scenario; x: number; y: number } | null, timedOut: boolean): Mood {
  const salt = mood.salt + (timedOut ? 1 : 0)
  const arrived = !timedOut && mood.near <= 3
  const banX = arrived ? -1 : mood.banX
  const banY = arrived ? -1 : mood.banY
  if (!acted) return { ...mood, plan: 0, atX: -1, atY: -1, planAt: mood.now, salt, banX, banY }
  const same = mood.plan === acted.scenario && mood.atX === acted.x && mood.atY === acted.y
  return { ...mood, plan: acted.scenario, atX: acted.x, atY: acted.y, planAt: same ? mood.planAt : mood.now, salt, banX, banY }
}

function survey(
  brain: Brain,
  reserved: ReadonlySet<number>,
  finish: (lane: Lane, scenario: Scenario, at: TileCoord, plan: Plan) => boolean,
): boolean {
  const enemies = hostiles(brain).length
  const mobiles = freeMobile(brain, reserved)
  const scouts = mobiles.filter((unit) => unit.typeId === UnitTypeId.Scout)
  const explorer = enemies === 0
    ? (scouts[0] ?? mobiles[0] ?? null)
    : mobiles.length > ASSAULT_ARMY && scouts.length > 0
      ? scouts[0]
      : null
  if (!explorer) return false
  const at = frontier(brain, explorer)
  if (!at) return false
  return finish(Lane.March, Scenario.Scout, at, scoutMove(explorer, at))
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

function fight(brain: Brain, zone: Zone, reserved: ReadonlySet<number>, pull: boolean, party?: readonly UnitSnapshot[]): Plan {
  const enemies = hostiles(brain).filter((unit) => near(unit, zone))
  const target = enemies[0] ?? (pull ? nearestEnemy(brain) : null)
  if (!target) return idle('no target')
  let units = party ? party.filter((unit) => !reserved.has(unit.id)) : committed(brain, zone, reserved)
  if (units.length === 0 && pull && !party) units = freeMobile(brain, reserved)
  if (units.length === 0) return idle('no target')
  const orders: ClientMessage[] = []
  const hold: number[] = []
  const buckets: UnitSnapshot[][] = [[], [], []]
  for (const unit of units) {
    const type = UNIT_TYPES[unit.typeId]
    if (unit.attackId === target.id) {
      hold.push(unit.id)
      continue
    }
    if (unit.typeId === UnitTypeId.Artillery) {
      const tile = standoff(unit, target, type.weapon.range * 0.75)
      if (aimed(unit, tile)) hold.push(unit.id)
      else orders.push(move(unit.id, tile))
      continue
    }
    buckets[domainOf(type)].push(unit)
  }
  const grouped = buckets.map((bucket) => bucket.slice(0, GROUP))
  const rows = Math.max(0, ...grouped.map((bucket) => bucket.length))
  for (let row = 0; row < rows; row++) {
    for (const bucket of grouped) {
      const unit = bucket[row]
      if (!unit) continue
      orders.push({ kind: ClientMessageKind.OrderAttack, unitIds: [unit.id], targetId: target.id })
    }
  }
  if (orders.length === 0 && hold.length === 0) return idle('no target')
  return acting(orders, hold)
}

function engage(brain: Brain, target: UnitSnapshot, reserved: ReadonlySet<number>): { scenario: Scenario; plan: Plan } {
  const available = freeMobile(brain, reserved)
  if (available.length === 0) return { scenario: Scenario.Assault, plan: idle('no target') }
  const enemyPower = Math.max(strength(target), powerNear(hostiles(brain), target.tileX, target.tileY, CLUSTER))
  const spot = average(available) ?? { x: target.tileX, y: target.tileY }
  const decision = judge(available, enemyPower)
  if (decision === 'form') return { scenario: Scenario.Muster, plan: regroup(available, spot) }
  if (decision === 'weak') return { scenario: Scenario.Assault, plan: idle('outmatched') }
  return { scenario: Scenario.Assault, plan: fight(brain, zoneAt({ x: target.tileX, y: target.tileY }, Scenario.Assault), reserved, true, available) }
}

function judge(party: readonly UnitSnapshot[], enemyPower: number): 'fight' | 'form' | 'weak' {
  if (party.length === 0) return 'weak'
  const body = mainBody(party)
  const mine = powerOf(body)
  const formed = party.length < 3 || body.length >= 3
  if (!formed) return mine >= enemyPower * EDGE ? 'form' : 'weak'
  if (mine < enemyPower * EDGE) return 'weak'
  return 'fight'
}

function mainBody(units: readonly UnitSnapshot[]): UnitSnapshot[] {
  let best: UnitSnapshot[] = []
  for (const seed of units) {
    const group: UnitSnapshot[] = []
    for (const unit of units) {
      if (Math.hypot(unit.tileX - seed.tileX, unit.tileY - seed.tileY) <= MUSTER_SPREAD) group.push(unit)
    }
    if (group.length > best.length) best = group
  }
  return best
}

function regroup(units: readonly UnitSnapshot[], tile: TileCoord): Plan {
  const party = units.filter((unit) => domainOf(UNIT_TYPES[unit.typeId]) !== MoveDomain.Water)
  if (party.length === 0) return idle('outmatched')
  const orders: ClientMessage[] = []
  const hold: number[] = []
  for (const unit of party) {
    if (tasked(unit, tile) || Math.hypot(unit.tileX - tile.x, unit.tileY - tile.y) <= MUSTER_SPREAD) hold.push(unit.id)
    else orders.push(move(unit.id, tile))
  }
  if (orders.length === 0 && hold.length === 0) return idle('outmatched')
  return acting(orders, hold)
}

function build(brain: Brain, layouts: readonly (CityLayout | null)[], zone: Zone): ClientMessage[] {
  if (factory(brain)) return []
  if (!afford(brain, FACTORY)) return []
  const spot = siteNear(brain, layouts, { x: zone.x, y: zone.y }, FACTORY.footprint)
  if (!spot) return []
  return [{ kind: ClientMessageKind.PlaceBuilding, typeId: UnitTypeId.Factory, tile: spot }]
}

function placeNext(brain: Brain, layouts: readonly (CityLayout | null)[], center: TileCoord): ClientMessage[] {
  const stock = tally(brain)
  if (stock.turret < 1 && stock.med >= 2 && afford(brain, TURRET)) {
    const spot = siteNear(brain, layouts, center, TURRET.footprint)
    if (spot) return [{ kind: ClientMessageKind.PlaceBuilding, typeId: UnitTypeId.Turret, tile: spot }]
  }
  if (!landReady(stock)) return []
  if (stock.turret < Math.min(2, ownedCityCount(brain)) && afford(brain, TURRET)) {
    const spot = siteNear(brain, layouts, center, TURRET.footprint)
    if (spot) return [{ kind: ClientMessageKind.PlaceBuilding, typeId: UnitTypeId.Turret, tile: spot }]
  }
  if (!hasYard(brain, UnitTypeId.Helipad) && afford(brain, HELIPAD)) {
    const spot = siteNear(brain, layouts, center, HELIPAD.footprint)
    if (spot) return [{ kind: ClientMessageKind.PlaceBuilding, typeId: UnitTypeId.Helipad, tile: spot }]
  }
  if (hasYard(brain, UnitTypeId.Helipad) && !yardReady(brain, UnitTypeId.Helipad)) return []
  if (yardReady(brain, UnitTypeId.Helipad) && stock.gunship < 2) return []
  if (!hasYard(brain, UnitTypeId.Shipyard) && afford(brain, SHIPYARD)) {
    const spot = siteNear(brain, layouts, center, SHIPYARD.footprint, MoveDomain.Water)
    if (spot) return [{ kind: ClientMessageKind.PlaceBuilding, typeId: UnitTypeId.Shipyard, tile: spot }]
  }
  if (yardReady(brain, UnitTypeId.Shipyard) && stock.cruiser < 2) return []
  if (!hasYard(brain, UnitTypeId.Airport) && afford(brain, AIRPORT)) {
    const spot = siteNear(brain, layouts, center, AIRPORT.footprint)
    if (spot) return [{ kind: ClientMessageKind.PlaceBuilding, typeId: UnitTypeId.Airport, tile: spot }]
  }
  return []
}

function train(brain: Brain, typeId: UnitTypeId): ClientMessage[] {
  if (!yardReady(brain, yardOf(typeId)) || !afford(brain, UNIT_TYPES[typeId])) return []
  return [{ kind: ClientMessageKind.Spawn, typeId }]
}

function capture(brain: Brain, tile: TileCoord, reserved: ReadonlySet<number>): Plan {
  const units = freeMobile(brain, reserved).filter((unit) => domainOf(UNIT_TYPES[unit.typeId]) !== MoveDomain.Water)
  if (units.length === 0) return idle('no target')
  const orders: ClientMessage[] = []
  const hold: number[] = []
  for (const unit of units) {
    if (tasked(unit, tile)) hold.push(unit.id)
    else orders.push(move(unit.id, tile))
  }
  if (orders.length === 0 && hold.length === 0) return idle('no target')
  return acting(orders, hold)
}

function scoutMove(scout: UnitSnapshot, tile: TileCoord): Plan {
  if (scout.tileX === tile.x && scout.tileY === tile.y) return acting([], [scout.id])
  if (scout.goal?.x === tile.x && scout.goal.y === tile.y) return acting([], [scout.id])
  return acting([move(scout.id, tile)])
}

type Stock = {
  scout: number
  med: number
  heavy: number
  artillery: number
  turret: number
  jet: number
  gunship: number
  cruiser: number
}

function tally(brain: Brain): Stock {
  const stock: Stock = { scout: 0, med: 0, heavy: 0, artillery: 0, turret: 0, jet: 0, gunship: 0, cruiser: 0 }
  const add = (typeId: UnitTypeId) => {
    if (typeId === UnitTypeId.Scout) stock.scout += 1
    else if (typeId === UnitTypeId.MedTank) stock.med += 1
    else if (typeId === UnitTypeId.HeavyTank) stock.heavy += 1
    else if (typeId === UnitTypeId.Artillery) stock.artillery += 1
    else if (typeId === UnitTypeId.Turret) stock.turret += 1
    else if (typeId === UnitTypeId.Jet) stock.jet += 1
    else if (typeId === UnitTypeId.Gunship) stock.gunship += 1
    else if (typeId === UnitTypeId.Cruiser) stock.cruiser += 1
  }
  for (const unit of own(brain)) add(unit.typeId)
  for (const job of brain.training) add(job.typeId)
  return stock
}

function landReady(stock: Stock): boolean {
  return stock.scout >= 2 && stock.med >= 4 && stock.heavy >= 2 && stock.artillery >= 1
}

function nextTrain(brain: Brain): UnitTypeId | null {
  const stock = tally(brain)
  if (yardReady(brain, UnitTypeId.Factory)) {
    if (stock.scout < 2 && afford(brain, SCOUT)) return UnitTypeId.Scout
    if (stock.med < 4 && afford(brain, MED_TANK)) return UnitTypeId.MedTank
    if (stock.heavy < 2 && afford(brain, HEAVY_TANK)) return UnitTypeId.HeavyTank
    if (stock.artillery < 1 && afford(brain, ARTILLERY)) return UnitTypeId.Artillery
  }
  if (yardReady(brain, UnitTypeId.Helipad) && stock.gunship < 2 && afford(brain, GUNSHIP)) return UnitTypeId.Gunship
  if (yardReady(brain, UnitTypeId.Shipyard) && stock.cruiser < 2 && afford(brain, CRUISER)) return UnitTypeId.Cruiser
  if (yardReady(brain, UnitTypeId.Airport) && stock.jet < 4 && afford(brain, JET)) return UnitTypeId.Jet
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
  let enemyKnown = false
  for (let i = 0; i < layouts.length; i++) {
    const state = brain.cities[i]
    if (layouts[i] && state && state.ownerId !== 0 && state.ownerId !== brain.playerId) enemyKnown = true
  }
  let best: CityLayout | null = null
  let bestDist = Infinity
  for (let i = 0; i < layouts.length; i++) {
    const layout = layouts[i]
    const state = brain.cities[i]
    if (!layout || (state && state.ownerId === brain.playerId)) continue
    const center = cityCenter(layout)
    if (banned(brain, center.x, center.y)) continue
    const neutral = !state || state.ownerId === 0
    if (neutral && enemyKnown) continue
    const dist = (center.x - origin.x) ** 2 + (center.y - origin.y) ** 2
    const score = dist - (neutral ? 40 : 0) + sway(brain, i) - 45
    if (score >= bestDist) continue
    bestDist = score
    best = layout
  }
  return best
}

function scoutTarget(brain: Brain, layouts: readonly (CityLayout | null)[]): TileCoord | null {
  const origin = average(freeMobile(brain, new Set()))
  if (!origin) return null
  let enemyOpen = false
  for (let i = 0; i < layouts.length; i++) {
    const layout = layouts[i]
    const state = brain.cities[i]
    if (!layout || !state || state.ownerId === 0 || state.ownerId === brain.playerId) continue
    const center = cityCenter(layout)
    if (!banned(brain, center.x, center.y)) enemyOpen = true
  }
  let best: TileCoord | null = null
  let bestDist = Infinity
  for (let i = 0; i < layouts.length; i++) {
    const layout = layouts[i]
    const state = brain.cities[i]
    if (!layout || state?.ownerId === brain.playerId) continue
    const center = cityCenter(layout)
    if (banned(brain, center.x, center.y)) continue
    const neutral = !state || state.ownerId === 0
    if (neutral && enemyOpen) continue
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
      if (banned(brain, x, y)) continue
      const dist = (x - origin.tileX) ** 2 + (y - origin.tileY) ** 2
      if (dist <= 0) continue
      const score = dist + (sway(brain, index) % 48)
      if (score < closeDist) {
        closeDist = score
        close = { x, y }
      }
      if (dist >= 16 && score < farDist) {
        farDist = score
        far = { x, y }
      }
    }
  }
  const edge = far ?? close
  if (!edge) return null
  const step = unknownBeside(known, brain.terrain, brain.width, brain.height, edge, origin)
  if (step && !banned(brain, step.x, step.y)) return step
  return edge
}

function unknownBeside(
  known: ArrayLike<number>,
  terrain: ArrayLike<number>,
  width: number,
  height: number,
  edge: TileCoord,
  origin: UnitSnapshot,
): TileCoord | null {
  let best: TileCoord | null = null
  let bestDist = Infinity
  for (const step of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = edge.x + step[0]
    const y = edge.y + step[1]
    if (x < 0 || y < 0 || x >= width || y >= height) continue
    const index = y * width + x
    if (known[index] === 1 || !isWalkableTerrain(terrain[index] as Terrain)) continue
    const dist = (x - origin.tileX) ** 2 + (y - origin.tileY) ** 2
    if (dist <= 0 || dist >= bestDist) continue
    bestDist = dist
    best = { x, y }
  }
  return best
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

function siteNear(
  brain: Brain,
  layouts: readonly (CityLayout | null)[],
  origin: TileCoord,
  footprint: number,
  domain = MoveDomain.Ground,
): TileCoord | null {
  const owned = layouts.filter((layout, index): layout is CityLayout => layout !== null && brain.cities[index]?.ownerId === brain.playerId)
  const blocked = buildingTiles(layouts)
  for (let radius = 1; radius <= 10; radius++) {
    for (let y = origin.y - radius; y <= origin.y + radius; y++) {
      for (let x = origin.x - radius; x <= origin.x + radius; x++) {
        if (Math.max(Math.abs(x - origin.x), Math.abs(y - origin.y)) !== radius) continue
        const tile = { x, y }
        if (!footprintNearCity(owned, tile, footprint)) continue
        if (!canPlaceFootprint(tile, footprint, brain.width, brain.height, (px, py) => brain.terrain[py * brain.width + px] as Terrain, brain.units, footprint, domain)) continue
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

function canGrow(brain: Brain, home: CityLayout): boolean {
  return growCity(home, brain.terrain, brain.width, brain.height) !== null
}

function holdGrowth(
  brain: Brain,
  layouts: readonly (CityLayout | null)[],
  apply: (lane: Lane, scenario: Scenario, score: number, at: TileCoord, plan: Plan) => boolean,
  stale: boolean,
) {
  if (stale) return
  let posted = 0
  const staying = new Set<number>()
  for (let i = 0; i < layouts.length; i++) {
    const layout = layouts[i]
    if (!layout || brain.cities[i]?.ownerId !== brain.playerId || !canGrow(brain, layout)) continue
    const at = rallyTile(brain, layout)
    const inside = ownMobile(brain).filter(
      (unit) => domainOf(UNIT_TYPES[unit.typeId]) === MoveDomain.Ground && cityContains(layout, unit.tileX, unit.tileY),
    )
    if (inside.length > 0) {
      staying.add(inside[0].id)
      apply(Lane.Home, Scenario.Garrison, 85, at, acting([], [inside[0].id]))
      continue
    }
    if (posted >= 2) continue
    const unit = nearestGround(brain, at, staying)
    if (!unit) {
      apply(Lane.Home, Scenario.Garrison, 85, at, idle('no target'))
      continue
    }
    staying.add(unit.id)
    if (apply(Lane.Home, Scenario.Garrison, 85, at, acting([move(unit.id, at)]))) posted += 1
  }
}

function nearestGround(brain: Brain, at: TileCoord, skip: ReadonlySet<number>): UnitSnapshot | null {
  let best: UnitSnapshot | null = null
  let bestDist = Infinity
  for (const unit of ownMobile(brain)) {
    if (skip.has(unit.id) || domainOf(UNIT_TYPES[unit.typeId]) !== MoveDomain.Ground) continue
    const dist = (unit.tileX - at.x) ** 2 + (unit.tileY - at.y) ** 2
    if (dist >= bestDist) continue
    bestDist = dist
    best = unit
  }
  return best
}

type Cluster = {
  playerId: number
  power: number
  x: number
  y: number
  closing: boolean
}

function assess(brain: Brain, home: TileCoord | null): { dangerous: Cluster | null; incoming: Cluster | null } {
  let dangerous: Cluster | null = null
  let dangerousScore = -1
  let incoming: Cluster | null = null
  let incomingDist = Infinity
  for (const cluster of clustersOf(hostiles(brain), home)) {
    const dist = home ? Math.hypot(cluster.x - home.x, cluster.y - home.y) : 0
    const score = cluster.power / (dist + 8)
    if (score > dangerousScore) {
      dangerousScore = score
      dangerous = cluster
    }
    const close = cluster.closing || dist <= ALARM
    if (cluster.power < INCOMING_POWER || !close || dist > ALARM * 2 || dist >= incomingDist) continue
    incomingDist = dist
    incoming = cluster
  }
  return { dangerous, incoming }
}

function clustersOf(units: readonly UnitSnapshot[], home: TileCoord | null): Cluster[] {
  const used = new Set<number>()
  const groups: Cluster[] = []
  for (const seed of units) {
    if (used.has(seed.id)) continue
    const members: UnitSnapshot[] = []
    const queue = [seed]
    used.add(seed.id)
    while (queue.length > 0) {
      const origin = queue.pop()
      if (!origin) break
      members.push(origin)
      for (const other of units) {
        if (used.has(other.id) || other.ownerId !== seed.ownerId) continue
        if (Math.hypot(other.tileX - origin.tileX, other.tileY - origin.tileY) > CLUSTER) continue
        used.add(other.id)
        queue.push(other)
      }
    }
    groups.push(clusterOf(members, home))
  }
  return groups
}

function clusterOf(members: readonly UnitSnapshot[], home: TileCoord | null): Cluster {
  let power = 0
  let x = 0
  let y = 0
  let closing = 0
  let aimed = 0
  for (const unit of members) {
    power += strength(unit)
    x += unit.tileX
    y += unit.tileY
    if (!home || !unit.goal) continue
    aimed += 1
    const now = Math.hypot(unit.tileX - home.x, unit.tileY - home.y)
    const then = Math.hypot(unit.goal.x - home.x, unit.goal.y - home.y)
    if (then + 2 < now) closing += 1
  }
  const size = members.length || 1
  return {
    playerId: members[0]?.ownerId ?? 0,
    power,
    x: x / size,
    y: y / size,
    closing: aimed > 0 && closing * 2 >= aimed,
  }
}

function threatLabel(cluster: Cluster, home: TileCoord): string {
  const dist = Math.hypot(cluster.x - home.x, cluster.y - home.y)
  const weight = cluster.power >= 12 ? 'heavy' : cluster.power >= 6 ? 'armed' : 'light'
  const motion = cluster.closing ? 'closing' : dist <= ALARM ? 'near' : 'far'
  return `${motion} ${weight} p${cluster.playerId} ${Math.round(cluster.power)}`
}

function strength(unit: UnitSnapshot): number {
  const type = UNIT_TYPES[unit.typeId]
  if (type.weapon.damage <= 0) return 0
  const hp = type.maxHealth > 0 ? Math.min(1, unit.health / type.maxHealth) : 1
  return type.supply * Math.max(0.25, hp)
}

function powerOf(units: readonly UnitSnapshot[]): number {
  let total = 0
  for (const unit of units) total += strength(unit)
  return total
}

function powerNear(units: readonly UnitSnapshot[], x: number, y: number, radius: number): number {
  let total = 0
  for (const unit of units) {
    if (Math.hypot(unit.tileX - x, unit.tileY - y) > radius) continue
    total += strength(unit)
  }
  return total
}

function nearestOwn(brain: Brain, at: TileCoord): number {
  let best = 1e9
  for (const unit of ownMobile(brain)) {
    const dist = Math.hypot(unit.tileX - at.x, unit.tileY - at.y)
    if (dist < best) best = dist
  }
  return best
}

function banned(brain: Brain, x: number, y: number): boolean {
  const mood = brain.mood
  if (!mood || mood.banX < 0 || mood.banY < 0) return false
  return Math.hypot(x - mood.banX, y - mood.banY) <= MUSTER_SPREAD
}

function afford(brain: Brain, type: UnitType): boolean {
  return brain.credits >= type.cost && supplyUsed(brain) + type.supply <= population(brain)
}

function yardReady(brain: Brain, typeId: UnitTypeId): boolean {
  return own(brain).some((unit) => unit.typeId === typeId && unit.health > 0 && unit.progress >= 1)
}

function hasYard(brain: Brain, typeId: UnitTypeId): boolean {
  return own(brain).some((unit) => unit.typeId === typeId && unit.health > 0)
}

function ownedCityCount(brain: Brain): number {
  let count = 0
  for (const city of brain.cities) if (city?.ownerId === brain.playerId) count += 1
  return count
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

function tasked(unit: UnitSnapshot, tile: TileCoord): boolean {
  const here = Math.hypot(unit.tileX - tile.x, unit.tileY - tile.y)
  if (here <= 3) return true
  if (!unit.goal) return false
  return Math.hypot(unit.goal.x - tile.x, unit.goal.y - tile.y) + 1 < here
}

function rallyTile(brain: Brain, layout: CityLayout): TileCoord {
  for (const street of layout.streets) {
    if (openTile(brain, street)) return { x: street.x, y: street.y }
  }
  const center = cityCenter(layout)
  return nearestOpen(brain, center) ?? center
}

function openTile(brain: Brain, tile: TileCoord): boolean {
  if (tile.x < 0 || tile.y < 0 || tile.x >= brain.width || tile.y >= brain.height) return false
  const index = tile.y * brain.width + tile.x
  if (brain.known && brain.known.length === brain.width * brain.height && brain.known[index] !== 1) return false
  return isWalkableTerrain(brain.terrain[index] as Terrain)
}

function nearestOpen(brain: Brain, center: TileCoord): TileCoord | null {
  for (let radius = 0; radius <= 4; radius++) {
    for (let y = center.y - radius; y <= center.y + radius; y++) {
      for (let x = center.x - radius; x <= center.x + radius; x++) {
        if (Math.max(Math.abs(x - center.x), Math.abs(y - center.y)) !== radius) continue
        const tile = { x, y }
        if (openTile(brain, tile)) return tile
      }
    }
  }
  return null
}

function aimed(unit: UnitSnapshot, tile: TileCoord): boolean {
  return unit.goal !== null && Math.abs(unit.goal.x - tile.x) <= 2 && Math.abs(unit.goal.y - tile.y) <= 2
}

function move(unitId: number, tile: TileCoord): ClientMessage {
  return { kind: ClientMessageKind.OrderMove, unitIds: [unitId], tile }
}

function sway(brain: Brain, n: number): number {
  const salt = brain.mood?.salt ?? brain.playerId
  let x = Math.imul((n + 1) ^ Math.imul(salt + 1, 0x9e3779b1), 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  return (x >>> 0) % 90
}

function orderedUnits(order: ClientMessage): number[] {
  if (order.kind === ClientMessageKind.OrderMove || order.kind === ClientMessageKind.OrderAttack || order.kind === ClientMessageKind.OrderAttackGround) {
    return order.unitIds
  }
  return []
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
