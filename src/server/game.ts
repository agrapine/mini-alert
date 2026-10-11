import { captureDuration, captureSpeed, CAPTURE_DRAIN, CITY_GROW_SECONDS, cityCenter, cityContains, cityHolds, citySightOrigin, footprintNearCity, growCity, layoutCities, type CityLayout } from '../shared/cities.ts'
import type { CityState, MapPoint, ShotEvent, TrainJob, UnitSnapshot } from '../shared/protocol.ts'
import type { CitySight } from '../shared/vision.ts'
import type { TileCoord } from '../shared/tiles.ts'
import { UNIT_TYPES, UnitTypeId } from '../shared/unit-types.ts'
import { PathFinder } from './path/pathfinder.ts'
import { CREDIT_PER_CITY, CREDIT_PER_POPULATION, Player } from './player.ts'
import { createUnit } from './units/create.ts'
import { Unit } from './units/unit.ts'
import { applyImpacts, engage, type Impact } from './sim/combat.ts'
import type { World } from './world.ts'

export type Scenery = {
  coast: MapPoint[]
  holes: MapPoint[][]
  roads: MapPoint[][]
  towns: MapPoint[]
  seed: number
}

const EMPTY_SCENERY: Scenery = { coast: [], holes: [], roads: [], towns: [], seed: 0 }

type CityRuntime = {
  layout: CityLayout
  ownerId: number
  progress: number
  challengerId: number
  grown: number
}
const SPAWN_STEPS: TileCoord[] = [
  { x: 0, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: 0, y: 2 },
  { x: 0, y: -2 },
  { x: 2, y: 0 },
]

const SPAWN_REACH = 8

function spawnSteps(): TileCoord[] {
  const steps = [...SPAWN_STEPS]
  const seen = new Set(steps.map((step) => `${step.x},${step.y}`))
  for (let radius = 0; radius <= SPAWN_REACH; radius++) {
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== radius) continue
        const key = `${x},${y}`
        if (seen.has(key)) continue
        seen.add(key)
        steps.push({ x, y })
      }
    }
  }
  return steps
}

export class Game {
  readonly world: World
  readonly pathfinder: PathFinder
  readonly units: Unit[] = []
  private readonly players = new Map<number, Player>()
  private nextUnitId = 1
  private nextPlayerId = 1
  private readonly spawnAnchors = new Map<number, TileCoord>()
  private impacts: Impact[] = []
  private time = 0
  private deaths: Unit[] = []
  private readonly jobs = new Map<number, number[]>()
  private readonly training = new Map<number, TrainJob[]>()
  scenery: Scenery = EMPTY_SCENERY
  private readonly cities: CityRuntime[] = []
  private growClock = 0
  private growthTerrain: number[] | null = null

  constructor(world: World) {
    this.world = world
    this.pathfinder = new PathFinder(world)
  }

  addPlayer(): Player {
    const player = new Player(this.nextPlayerId++)
    this.players.set(player.id, player)
    return player
  }

  player(id: number): Player | undefined {
    return this.players.get(id)
  }

  setSpawnAnchor(playerId: number, tile: TileCoord) {
    this.spawnAnchors.set(playerId, tile)
  }

  bindCities() {
    const terrain = this.terrainTable()
    this.cities.length = 0
    for (const layout of layoutCities(this.scenery.towns, this.scenery.seed, terrain, this.world.width, this.world.height)) {
      this.cities.push({ layout, ownerId: 0, progress: 0, challengerId: 0, grown: 0 })
    }
    this.syncBlocks()
  }

  claimCity(town: MapPoint, playerId: number) {
    const x = Math.floor(town.x)
    const y = Math.floor(town.y)
    const city = this.cities.find((candidate) => cityContains(candidate.layout, x, y))
    if (city) city.ownerId = playerId
  }

  cityStates(): CityState[] {
    return this.cities.map((city) => ({
      ownerId: city.ownerId,
      progress: city.progress,
      challengerId: city.challengerId,
      grown: city.grown,
    }))
  }

  citySights(): CitySight[] {
    return this.cities.map((city) => ({ ownerId: city.ownerId, ...citySightOrigin(city.layout) }))
  }

  nearestUnownedCityTile(playerId: number, from: TileCoord): TileCoord | null {
    let best: TileCoord | null = null
    let bestDist = Infinity
    for (const city of this.cities) {
      if (city.ownerId === playerId) continue
      const center = cityCenter(city.layout)
      const dist = (center.x - from.x) ** 2 + (center.y - from.y) ** 2
      if (dist >= bestDist) continue
      bestDist = dist
      best = center
    }
    return best
  }

  creditIncome(playerId: number): number {
    let cities = 0
    let population = 0
    for (const city of this.cities) {
      if (city.ownerId !== playerId) continue
      cities += 1
      population += city.layout.tiles.length
    }
    return CREDIT_PER_CITY * cities + CREDIT_PER_POPULATION * population
  }

  hasFinishedFactory(playerId: number): boolean {
    return this.units.some(
      (unit) =>
        unit.ownerId === playerId &&
        unit.typeId === UnitTypeId.Factory &&
        unit.health > 0 &&
        unit.progress >= 1,
    )
  }

  placeBuilding(playerId: number, typeId: UnitTypeId, tile: TileCoord): boolean {
    const owner = this.players.get(playerId)
    const type = UNIT_TYPES[typeId]
    if (!owner || type.topSpeed > 0) return false
    if (!this.footprintFree(tile, type.footprint)) return false
    if (!footprintNearCity(this.cities.map((city) => city.layout), tile, type.footprint)) return false
    const unit = this.spawn(owner, typeId, tile, 0)
    unit.progress = 0
    const queue = this.jobs.get(playerId) ?? []
    queue.push(unit.id)
    this.jobs.set(playerId, queue)
    return true
  }

  placeNearAnchor(playerId: number, typeId: UnitTypeId): boolean {
    const anchor = this.spawnAnchors.get(playerId)
    if (!anchor) return false
    for (const step of spawnSteps()) {
      const tile = { x: anchor.x + step.x, y: anchor.y + step.y }
      if (this.placeBuilding(playerId, typeId, tile)) return true
    }
    return false
  }

  finishBuild(playerId: number) {
    const queue = this.jobs.get(playerId)
    const id = queue?.[0]
    if (id === undefined) return
    const unit = this.units.find((candidate) => candidate.id === id)
    const owner = this.players.get(playerId)
    if (unit && owner && unit.progress < 1) {
      const due = unit.type.cost * (1 - unit.progress)
      owner.credits = Math.max(0, owner.credits - due)
    }
    if (unit) unit.progress = 1
    queue?.shift()
    if (queue && queue.length === 0) this.jobs.delete(playerId)
  }

  cancelBuild(playerId: number, typeId: UnitTypeId): boolean {
    const queue = this.jobs.get(playerId)
    if (!queue) return false
    for (let i = queue.length - 1; i >= 0; i--) {
      const unit = this.units.find((candidate) => candidate.id === queue[i])
      if (!unit || unit.typeId !== typeId || unit.progress >= 1) continue
      queue.splice(i, 1)
      unit.health = 0
      if (queue.length === 0) this.jobs.delete(playerId)
      return true
    }
    return false
  }

  trainingFor(playerId: number): TrainJob[] {
    return (this.training.get(playerId) ?? []).map((job) => ({ typeId: job.typeId, progress: job.progress }))
  }

  trainingCount(playerId: number): number {
    return this.training.get(playerId)?.length ?? 0
  }

  trySpawn(playerId: number, typeId: UnitTypeId): boolean {
    const owner = this.players.get(playerId)
    const type = UNIT_TYPES[typeId]
    if (!owner || type.topSpeed <= 0 || !this.hasFinishedFactory(playerId)) return false
    const queue = this.training.get(playerId) ?? []
    queue.push({ typeId, progress: 0 })
    this.training.set(playerId, queue)
    return true
  }

  cancelTraining(playerId: number, typeId: UnitTypeId): boolean {
    const queue = this.training.get(playerId)
    if (!queue) return false
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].typeId !== typeId) continue
      queue.splice(i, 1)
      if (queue.length === 0) this.training.delete(playerId)
      return true
    }
    return false
  }

  spawn(owner: Player, typeId: UnitTypeId, tile: TileCoord, facing = 0): Unit {
    const type = UNIT_TYPES[typeId]
    const spot = type.topSpeed > 0 ? this.openSpawn(tile, type.footprint) : tile
    if (!spot || !this.footprintFree(spot, type.footprint)) {
      throw new Error(`cannot spawn on ${tile.x},${tile.y}`)
    }
    const unit = createUnit(this.nextUnitId++, owner.id, type, spot, facing)
    const span = type.footprint
    unit.pos = { x: spot.x + span / 2, z: spot.y + span / 2 }
    this.units.push(unit)
    owner.addUnit(unit.id)
    this.fillFootprint(unit)
    return unit
  }

  orderMove(playerId: number, unitId: number, tile: TileCoord): boolean {
    const unit = this.owned(playerId, unitId)
    if (!unit) return false
    unit.attackId = null
    return unit.orderMove(tile, this.pathfinder)
  }

  orderAttack(playerId: number, unitId: number, targetId: number): boolean {
    const unit = this.owned(playerId, unitId)
    const target = this.units.find((candidate) => candidate.id === targetId)
    if (!unit || !target || target.id === unit.id || target.ownerId === unit.ownerId || target.health <= 0) {
      return false
    }
    unit.attackId = target.id
    unit.step(0, this.pathfinder, this.units)
    return true
  }

  tick(dt: number): ShotEvent[] {
    for (const player of this.players.values()) player.credits += this.creditIncome(player.id) * dt
    this.advanceBuilds(dt)
    for (const unit of this.units) {
      if (unit.health <= 0) continue
      unit.step(dt, this.pathfinder, this.units)
    }
    this.time += dt
    const shots = engage(this.units, dt, this.time, this.impacts, this.citySights())
    applyImpacts(this.units, this.impacts, this.time)
    this.removeDead()
    this.advanceCaptures(dt)
    this.advanceGrowth(dt)
    this.advanceTraining(dt)
    return shots
  }

  unitSnapshots(): UnitSnapshot[] {
    return this.units.map((unit) => this.snapshot(unit))
  }

  takeDeaths(): UnitSnapshot[] {
    const snapshots = this.deaths.map((unit) => this.snapshot(unit))
    this.deaths = []
    return snapshots
  }

  private owned(playerId: number, unitId: number): Unit | undefined {
    const player = this.players.get(playerId)
    if (!player?.owns(unitId)) return undefined
    return this.units.find((candidate) => candidate.id === unitId)
  }

  private removeDead() {
    this.deaths = []
    for (const unit of this.units) {
      if (unit.health > 0) continue
      this.pathfinder.release(unit)
      this.clearJob(unit.id)
      this.deaths.push(unit)
    }
    this.units.splice(0, this.units.length, ...this.units.filter((unit) => unit.health > 0))
  }

  private snapshot(unit: Unit): UnitSnapshot {
    return {
      id: unit.id,
      typeId: unit.typeId,
      ownerId: unit.ownerId,
      color: this.player(unit.ownerId)?.color ?? 0xffffff,
      x: unit.pos.x,
      z: unit.pos.z,
      facing: unit.facing,
      turretYaw: unit.type.weapon.turretRate > 0 ? unit.turretYaw : unit.facing,
      health: unit.health,
      tileX: unit.tile.x,
      tileY: unit.tile.y,
      goal: unit.path.length > 0 ? unit.path[unit.path.length - 1] : null,
      progress: unit.progress,
    }
  }

  private terrainTable(): number[] {
    if (this.growthTerrain && this.growthTerrain.length === this.world.width * this.world.height) return this.growthTerrain
    const terrain: number[] = []
    for (let y = 0; y < this.world.height; y++) {
      for (let x = 0; x < this.world.width; x++) terrain.push(this.world.terrainAt(x, y))
    }
    this.growthTerrain = terrain
    return terrain
  }

  private advanceGrowth(dt: number) {
    this.growClock += dt
    if (this.growClock < CITY_GROW_SECONDS) return
    const terrain = this.terrainTable()
    let changed = false
    while (this.growClock >= CITY_GROW_SECONDS) {
      this.growClock -= CITY_GROW_SECONDS
      for (const city of this.cities) {
        if (city.ownerId === 0 || !this.ownerPresent(city)) continue
        const next = growCity(city.layout, terrain, this.world.width, this.world.height)
        if (!next) continue
        const added = next.buildings.find(
          (building) => !city.layout.buildings.some((current) => current.x === building.x && current.y === building.y),
        )
        if (added && this.pathfinder.occupant(added.x, added.y) !== null) continue
        city.layout = next
        city.grown += 1
        changed = true
      }
    }
    if (changed) this.syncBlocks()
  }

  private ownerPresent(city: CityRuntime): boolean {
    for (const unit of this.units) {
      if (unit.health <= 0 || unit.type.topSpeed <= 0 || unit.ownerId !== city.ownerId) continue
      if (cityHolds(city.layout, unit.pos.x, unit.pos.z)) return true
    }
    return false
  }

  private syncBlocks() {
    this.pathfinder.clearBlocked()
    for (const city of this.cities) {
      for (const building of city.layout.buildings) this.pathfinder.setBlocked(building.x, building.y, true)
    }
  }

  private advanceCaptures(dt: number) {
    for (const city of this.cities) {
      const counts = new Map<number, number>()
      for (const unit of this.units) {
        if (unit.health <= 0 || unit.type.topSpeed <= 0) continue
        if (!cityHolds(city.layout, unit.pos.x, unit.pos.z)) continue
        counts.set(unit.ownerId, (counts.get(unit.ownerId) ?? 0) + 1)
      }
      if (counts.size > 1) continue
      if (counts.size === 0 || counts.has(city.ownerId)) {
        city.progress = Math.max(0, city.progress - dt / CAPTURE_DRAIN)
        if (city.progress === 0) city.challengerId = 0
        continue
      }
      const holder = counts.keys().next().value
      if (holder === undefined) continue
      if (city.challengerId !== holder) {
        city.challengerId = holder
        city.progress = 0
      }
      const duration = captureDuration(city.layout.span, city.ownerId === 0)
      city.progress += (dt * captureSpeed(counts.get(holder) ?? 1)) / duration
      if (city.progress < 1) continue
      city.ownerId = holder
      city.progress = 0
      city.challengerId = 0
    }
  }

  private advanceBuilds(dt: number) {
    for (const [playerId, queue] of this.jobs) {
      const owner = this.players.get(playerId)
      if (!owner) continue
      let left = dt
      while (queue.length > 0 && left > 0) {
        const unit = this.units.find((candidate) => candidate.id === queue[0])
        if (!unit || unit.health <= 0) {
          queue.shift()
          continue
        }
        const before = unit.progress
        unit.progress = this.fund(owner, unit.type.cost, before, unit.type.buildTime, left)
        const gained = unit.progress - before
        if (gained <= 0) break
        left -= gained * unit.type.buildTime
        if (unit.progress < 1) break
        queue.shift()
      }
      if (queue.length === 0) this.jobs.delete(playerId)
    }
  }

  private advanceTraining(dt: number) {
    for (const [playerId, queue] of this.training) {
      const owner = this.players.get(playerId)
      if (!owner) continue
      let left = dt
      while (queue.length > 0 && left > 0) {
        const job = queue[0]
        if (job.progress >= 1) {
          if (!this.releaseTrainee(playerId, job.typeId)) break
          queue.shift()
          continue
        }
        const type = UNIT_TYPES[job.typeId]
        const before = job.progress
        job.progress = this.fund(owner, type.cost, before, type.buildTime, left)
        const gained = job.progress - before
        if (gained <= 0) break
        left -= gained * type.buildTime
        if (job.progress < 1) break
        if (!this.releaseTrainee(playerId, job.typeId)) break
        queue.shift()
      }
      if (queue.length === 0) this.training.delete(playerId)
    }
  }

  private fund(owner: Player, cost: number, progress: number, duration: number, dt: number): number {
    if (progress >= 1 || cost <= 0 || dt <= 0) return progress >= 1 ? 1 : progress
    const unpaid = cost * (1 - progress)
    const slice = Math.min(owner.credits, unpaid, duration <= 0 ? unpaid : (cost * dt) / duration)
    if (slice <= 0) return progress
    owner.credits -= slice
    if (unpaid - slice <= 1e-4) return 1
    return progress + slice / cost
  }

  private releaseTrainee(playerId: number, typeId: UnitTypeId): boolean {
    const owner = this.players.get(playerId)
    if (!owner) return false
    const factory = this.units.find(
      (unit) =>
        unit.ownerId === playerId &&
        unit.typeId === UnitTypeId.Factory &&
        unit.health > 0 &&
        unit.progress >= 1,
    )
    if (!factory) return false
    const exit = this.exitTile(factory)
    if (!exit) return false
    const unit = this.spawn(owner, typeId, exit.tile, exit.facing)
    if (exit.rally.x !== exit.tile.x || exit.rally.y !== exit.tile.y) unit.orderMove(exit.rally, this.pathfinder)
    return true
  }

  private openSpawn(target: TileCoord, footprint: number): TileCoord | null {
    for (const step of spawnSteps()) {
      const tile = { x: target.x + step.x, y: target.y + step.y }
      if (this.footprintFree(tile, footprint)) return tile
    }
    return null
  }

  private footprintFree(origin: TileCoord, footprint: number): boolean {
    for (let dy = 0; dy < footprint; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        if (!this.pathfinder.isWalkable(origin.x + dx, origin.y + dy, -1)) return false
      }
    }
    return footprint > 0
  }

  private fillFootprint(unit: Unit) {
    const span = unit.type.footprint
    for (let dy = 0; dy < span; dy++) {
      for (let dx = 0; dx < span; dx++) {
        this.pathfinder.setOccupant(unit.tile.x + dx, unit.tile.y + dy, unit.id)
      }
    }
  }

  private exitTile(factory: Unit): { tile: TileCoord; facing: number; rally: TileCoord } | null {
    const span = factory.type.footprint
    const origin = factory.tile
    for (let ring = 1; ring <= SPAWN_REACH; ring++) {
      const y0 = origin.y - ring
      const y1 = origin.y + span - 1 + ring
      const x0 = origin.x - ring
      const x1 = origin.x + span - 1 + ring
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const onRing = x === x0 || x === x1 || y === y0 || y === y1
          if (!onRing || !this.pathfinder.isWalkable(x, y, -1)) continue
          const dx = Math.sign(x + 0.5 - factory.pos.x)
          const dy = Math.sign(y + 0.5 - factory.pos.z)
          const rally = {
            x: Math.min(this.world.width - 1, Math.max(0, x + dx * 3)),
            y: Math.min(this.world.height - 1, Math.max(0, y + dy * 3)),
          }
          return { tile: { x, y }, facing: Math.atan2(dx, dy), rally }
        }
      }
    }
    return null
  }

  private clearJob(unitId: number) {
    for (const [playerId, queue] of this.jobs) {
      const next = queue.filter((id) => id !== unitId)
      if (next.length === queue.length) continue
      if (next.length === 0) this.jobs.delete(playerId)
      else this.jobs.set(playerId, next)
    }
  }
}
