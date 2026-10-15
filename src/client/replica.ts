import { buildingCost, canPlaceCityBuilding, cityContains, eachBuildingTile, footprintNearCity, HALL_SPAN, populationOf, settledCity, type CityLayout } from '../shared/cities.ts'
import { footprintCovers, tileOccupied } from '../shared/footprint.ts'
import { flightLine, SIM_STEP, SNAPSHOT_GAP, stepMotion, timeScale, turnToward, wrapAngle, type MotionState } from '../shared/motion.ts'
import {
  ServerEventKind,
  type CityRecord,
  type CityState,
  type MapData,
  type MapPoint,
  type ServerFrame,
  type ShotEvent,
  type ShotHit,
  type TrainJob,
  type UnitSnapshot,
  type WorldSnapshot,
} from '../shared/protocol.ts'
import { Terrain, isWalkableTerrain, type TileCoord } from '../shared/tiles.ts'
import { domainOf, Locomotion, MoveDomain, spanOf, UNIT_TYPES, UnitTypeId } from '../shared/unit-types.ts'
import { planMoves, type RouteMap } from '../shared/route.ts'

const CATCHUP_STEPS = 8
const FAST_FORWARD_LIMIT = 900
const DRIFT_SECONDS = 0.12
const TELEPORT_DISTANCE = 3
const LEAD_TILES = 3
const SLACK_SECONDS = 1
const SLACK_TICKS = 1
const RATE_WINDOW_MS = 6000
const RATE_MIN_SPAN_MS = 2000
const AHEAD_LIMIT = 20
const NOMINAL_RATE = 1 / SIM_STEP
const SLOW_RATE = 0.8 * NOMINAL_RATE
const JITTER_TICKS = 15
const REPLAY_LIMIT = 15
const HOLD_WINDOW = 90
const HOLD_DECAY = 60
const HOLD_LIMIT = 6

type Pose = { x: number; z: number; facing: number; turretYaw: number; altitude: number }

export type ExpectedSite = { typeId: UnitTypeId | null; tile: TileCoord }

type Shown = {
  before: Pose
  drift: Pose
  view: UnitSnapshot
  seen: number
}

export class Replica {
  playerId: number | null = null
  world: WorldSnapshot | null = null
  units: UnitSnapshot[] = []
  credits = 0
  training: TrainJob[] = []
  cities: (CityState | null)[] = []
  layouts: (CityLayout | null)[] = []
  rally: TileCoord | null = null
  cleared: TileCoord[] = []
  serverTick = 0
  localTick = 0
  wantsSnapshot = false
  terrainRevision = 0
  cityRevision = 0
  knownTiles = 0
  /** Told how far each server motion moved a unit this replica already held. */
  onCorrection: ((jump: number) => void) | null = null

  private pendingShots: ShotEvent[] = []
  private pendingHits: ShotHit[] = []
  private pendingYields: MapPoint[] = []
  private readonly clearedTiles = new Set<string>()
  private evolved: (CityLayout | null)[] = []
  private blockedBuildings = new Set<string>()
  private settledRevision = -1
  private accumulator = 0
  private serverEstimate = 0
  private slack = Infinity
  private slackAge = 0
  private arrivals: { at: number; tick: number }[] = []
  private rate = NOMINAL_RATE
  private held: ServerFrame[] = []
  private hold = 1
  private holdTick = 0
  private lateness: { tick: number; late: number }[] = []
  private askedTick = -SNAPSHOT_GAP
  private readonly shown = new Map<number, Shown>()
  private frameOccupancy: Map<string, number> | null = null
  private expectedTraining: { seq: number; typeId: UnitTypeId; yardId: number }[] = []
  private expectedRally: { seq: number; tile: TileCoord } | null = null
  private expectedSites: (ExpectedSite & { seq: number })[] = []
  private trainingTick = 0
  private readonly trainingRate = new Map<number, number>()
  private readonly drawnUnits: UnitSnapshot[] = []
  private drawPass = 0

  reset() {
    this.playerId = null
    this.world = null
    this.units = []
    this.credits = 0
    this.training = []
    this.cities = []
    this.layouts = []
    this.trainingRate.clear()
    this.rally = null
    this.cleared = []
    this.serverTick = 0
    this.localTick = 0
    this.serverEstimate = 0
    this.slack = Infinity
    this.slackAge = 0
    this.arrivals = []
    this.rate = NOMINAL_RATE
    this.held = []
    this.hold = 1
    this.holdTick = 0
    this.lateness = []
    this.wantsSnapshot = false
    this.terrainRevision = 0
    this.knownTiles = 0
    this.clearedTiles.clear()
    this.pendingShots = []
    this.pendingHits = []
    this.pendingYields = []
    this.evolved = []
    this.blockedBuildings.clear()
    this.cityRevision = 0
    this.settledRevision = -1
    this.accumulator = 0
    this.askedTick = -SNAPSHOT_GAP
    this.shown.clear()
    this.settle(Infinity)
  }

  /** A frame stamped ahead of `localTick` is held and applies right after the step that reaches its tick. */
  apply(frame: ServerFrame, now = performance.now()) {
    const snapshot = frame.events.some((event) => event.kind === ServerEventKind.Snapshot)
    this.serverTick = frame.tick
    this.noteArrival(frame.tick, snapshot, now)
    if (snapshot) this.held = []
    else if (this.world && frame.tick > this.localTick) {
      this.held.push(frame)
      if (frame.tick - this.localTick > SNAPSHOT_GAP) this.closeTo(frame.tick)
      return
    } else if (this.world && !this.closeTo(frame.tick)) return
    this.applyFrame(frame)
  }

  private applyFrame(frame: ServerFrame) {
    this.frameOccupancy = null
    for (const event of frame.events) this.applyEvent(event, frame.tick)
    this.settle(frame.ack)
  }

  expectTraining(seq: number, typeId: UnitTypeId, yardId: number) {
    this.expectedTraining.push({ seq, typeId, yardId })
  }

  expectRally(seq: number, tile: TileCoord) {
    this.expectedRally = { seq, tile }
  }

  expectSite(seq: number, site: ExpectedSite) {
    this.expectedSites.push({ seq, ...site })
  }

  /** Each building's queue, its head advanced at the rate the server last reported, with unanswered orders appended. */
  queue(): TrainJob[] {
    const elapsed = Math.max(0, this.localTick - this.trainingTick)
    const heads = new Set<number>()
    const jobs = this.training.map((job) => {
      if (heads.has(job.yardId)) return job
      heads.add(job.yardId)
      const rate = this.trainingRate.get(job.yardId) ?? 0
      if (rate <= 0) return job
      return { typeId: job.typeId, yardId: job.yardId, progress: Math.min(1, job.progress + rate * elapsed) }
    })
    for (const job of this.expectedTraining) jobs.push({ typeId: job.typeId, yardId: job.yardId, progress: 0 })
    return jobs
  }

  shownRally(): TileCoord | null {
    return this.expectedRally?.tile ?? this.rally
  }

  expectedSiteList(): readonly ExpectedSite[] {
    return this.expectedSites
  }

  private settle(ack: number) {
    this.expectedTraining = this.expectedTraining.filter((job) => job.seq > ack)
    this.expectedSites = this.expectedSites.filter((site) => site.seq > ack)
    if (this.expectedRally && this.expectedRally.seq <= ack) this.expectedRally = null
  }

  advance(dt: number): boolean {
    this.settleSlack(dt)
    this.settleHold()
    const expected = Math.round(this.serverEstimate - this.hold)
    if (this.world && !this.closeTo(expected)) return this.dueSnapshot()
    const scale = timeScale(this.localTick + this.accumulator / SIM_STEP, this.serverEstimate - this.hold)
    this.serverEstimate += dt * this.rate
    this.accumulator += dt * scale * this.rate * SIM_STEP
    let steps = 0
    while (this.accumulator >= SIM_STEP && steps < CATCHUP_STEPS) {
      this.accumulator -= SIM_STEP
      this.step()
      steps += 1
    }
    const fade = Math.exp(-dt / DRIFT_SECONDS)
    for (const shown of this.shown.values()) scalePose(shown.drift, fade)
    return this.dueSnapshot()
  }

  /** Steps straight to `tick` without wall-clock pacing; the server keeps a copy of each client this way. */
  simulateTo(tick: number) {
    while (this.localTick < tick) this.step()
  }

  private step() {
    this.localTick += 1
    this.stepUnits(SIM_STEP)
    let due = 0
    while (due < this.held.length && this.held[due].tick <= this.localTick) due += 1
    for (const frame of this.held.splice(0, due)) this.applyFrame(frame)
  }

  /** Where `drawn` poses units between the step before `localTick` (0) and `localTick` (1). */
  drawPhase(): number {
    return Math.min(1, this.accumulator / SIM_STEP)
  }

  /** Units posed between the last two sim steps, plus any correction still blending out. */
  drawn(): UnitSnapshot[] {
    const alpha = this.drawPhase()
    const pass = ++this.drawPass
    const out = this.drawnUnits
    out.length = 0
    for (const unit of this.units) {
      const shown = this.shownOf(unit)
      shown.seen = pass
      const { before, drift, view } = shown
      Object.assign(view, unit)
      view.x = before.x + (unit.x - before.x) * alpha + drift.x
      view.z = before.z + (unit.z - before.z) * alpha + drift.z
      view.facing = before.facing + wrapAngle(unit.facing - before.facing) * alpha + drift.facing
      view.turretYaw = before.turretYaw + wrapAngle(unit.turretYaw - before.turretYaw) * alpha + drift.turretYaw
      view.altitude = before.altitude + ((unit.altitude ?? 0) - before.altitude) * alpha + drift.altitude
      out.push(view)
    }
    for (const [id, shown] of this.shown) if (shown.seen !== pass) this.shown.delete(id)
    return out
  }

  /**
   * The server clock follows the earliest-arriving frames: a frame ahead of the estimate moves it forward, a late
   * one records how late it was and keeps the estimate within AHEAD_LIMIT of it. When every frame of a window
   * arrived late, the estimate eases back by at most a tick, so jitter never pulls the clock back but drift still does.
   */
  private noteArrival(tick: number, snapshot: boolean, now: number) {
    this.measureRate(tick, now)
    const late = this.serverEstimate - tick
    if (snapshot || late < 0) this.serverEstimate = tick
    else {
      if (late > AHEAD_LIMIT) this.serverEstimate = tick + AHEAD_LIMIT
      this.slack = Math.min(this.slack, late)
      this.lateness.push({ tick: this.localTick, late })
      this.settleHold()
    }
    if (snapshot) this.slack = Infinity
  }

  /**
   * How many ticks the clock runs behind the server estimate: as late as the latest frame of the last HOLD_WINDOW
   * local ticks arrived, rising at once and easing back a tick per HOLD_DECAY local ticks.
   */
  private settleHold() {
    while (this.lateness.length > 0 && this.localTick - this.lateness[0].tick > HOLD_WINDOW) this.lateness.shift()
    let worst = 0
    for (const sample of this.lateness) worst = Math.max(worst, sample.late)
    const need = Math.min(HOLD_LIMIT, Math.max(1, worst))
    if (need >= this.hold) {
      this.hold = need
      this.holdTick = this.localTick
    } else if (this.localTick - this.holdTick >= HOLD_DECAY) {
      this.hold = Math.max(need, this.hold - 1)
      this.holdTick = this.localTick
    }
  }

  /**
   * How fast the server ticks, from how much later its punctual frames arrive over time: the least-late frame of
   * the older and of the newer half of the window. Lag growth within JITTER_TICKS is jitter; a server that falls
   * clearly further behind the wall clock sets the pace.
   */
  private measureRate(tick: number, now: number) {
    this.arrivals.push({ at: now, tick })
    while (this.arrivals.length > 2 && now - this.arrivals[0].at > RATE_WINDOW_MS) this.arrivals.shift()
    const first = this.arrivals[0]
    const span = now - first.at
    if (span < RATE_MIN_SPAN_MS) return
    const middle = first.at + span / 2
    let older: { lag: number; at: number } | null = null
    let newer: { lag: number; at: number } | null = null
    for (const arrival of this.arrivals) {
      const lag = (arrival.at / 1000) * NOMINAL_RATE - arrival.tick
      if (arrival.at < middle) {
        if (!older || lag < older.lag) older = { lag, at: arrival.at }
      } else if (!newer || lag < newer.lag) newer = { lag, at: arrival.at }
    }
    if (!older || !newer || newer.at === older.at) return
    if (newer.lag - older.lag <= JITTER_TICKS) {
      this.rate = NOMINAL_RATE
      return
    }
    const measured = NOMINAL_RATE - ((newer.lag - older.lag) * 1000) / (newer.at - older.at)
    this.rate = measured < SLOW_RATE ? Math.max(0, measured) : NOMINAL_RATE
  }

  private settleSlack(dt: number) {
    this.slackAge += dt
    if (this.slackAge < SLACK_SECONDS) return
    if (this.slack > SLACK_TICKS && this.slack !== Infinity) this.serverEstimate -= Math.min(this.slack - SLACK_TICKS, SLACK_TICKS)
    this.slack = Infinity
    this.slackAge = 0
  }

  private closeTo(tick: number): boolean {
    const ahead = tick - this.localTick
    if (ahead > SNAPSHOT_GAP && ahead <= FAST_FORWARD_LIMIT) {
      while (this.localTick < tick) this.step()
      this.accumulator = 0
      return true
    }
    if (Math.abs(ahead) <= SNAPSHOT_GAP) return true
    this.wantsSnapshot = true
    return false
  }

  private shownOf(unit: UnitSnapshot): Shown {
    let shown = this.shown.get(unit.id)
    if (!shown) {
      shown = { before: poseOf(unit), drift: still(), view: { ...unit }, seen: 0 }
      this.shown.set(unit.id, shown)
    }
    return shown
  }

  private dueSnapshot(): boolean {
    if (!this.wantsSnapshot || this.localTick - this.askedTick < SNAPSHOT_GAP) return false
    this.askedTick = this.localTick
    return true
  }

  takeShots(): ShotEvent[] {
    const shots = this.pendingShots
    this.pendingShots = []
    return shots
  }

  takeHits(): ShotHit[] {
    const hits = this.pendingHits
    this.pendingHits = []
    return hits
  }

  takeYields(): MapPoint[] {
    const yields = this.pendingYields
    this.pendingYields = []
    return yields
  }

  unit(id: number): UnitSnapshot | undefined {
    return this.units.find((unit) => unit.id === id)
  }

  occupant(tile: TileCoord): UnitSnapshot | undefined {
    return this.units.find((unit) => {
      const span = spanOf(UNIT_TYPES[unit.typeId])
      return footprintCovers(unit.tileX, unit.tileY, span.x, span.y, tile)
    })
  }

  isOpen(tile: TileCoord, ignore: number | readonly number[]): boolean {
    const world = this.world
    if (!world || !this.inBounds(tile) || world.known[tile.y * world.width + tile.x] === 0) return false
    if (!this.groundAt(tile)) return false
    const skip = typeof ignore === 'number' ? [ignore] : ignore
    return !tileOccupied(this.units, tile, skip)
  }

  canCommand(tile: TileCoord, selected: readonly UnitSnapshot[]): boolean {
    const world = this.world
    if (!world || !this.inBounds(tile)) return false
    const movers = selected.filter((unit) => (UNIT_TYPES[unit.typeId]?.topSpeed ?? 0) > 0)
    if (movers.length === 0) return false
    const index = tile.y * world.width + tile.x
    if (world.known[index] === 0) return true
    const domains = new Set(movers.map((unit) => domainOf(UNIT_TYPES[unit.typeId])))
    if (domains.size === 1 && domains.has(MoveDomain.Air)) return true
    if (domains.size === 1 && domains.has(MoveDomain.Water)) {
      const terrain = world.terrain[index]
      return terrain === Terrain.Water || terrain === Terrain.Lake
    }
    return this.groundAt(tile)
  }

  private inBounds(tile: TileCoord): boolean {
    const world = this.world
    return world !== null && tile.x >= 0 && tile.y >= 0 && tile.x < world.width && tile.y < world.height
  }

  private passable(tile: TileCoord, domain: MoveDomain): boolean {
    const world = this.world
    if (!world || !this.inBounds(tile)) return false
    const structure = this.units.some((unit) => {
      if (UNIT_TYPES[unit.typeId].topSpeed > 0) return false
      const span = spanOf(UNIT_TYPES[unit.typeId])
      return footprintCovers(unit.tileX, unit.tileY, span.x, span.y, tile)
    })
    if (structure) return false
    const index = tile.y * world.width + tile.x
    if (world.known[index] === 0) return true
    if (domain === MoveDomain.Water) return world.terrain[index] === Terrain.Water || world.terrain[index] === Terrain.Lake
    return this.groundAt(tile)
  }

  private groundAt(tile: TileCoord): boolean {
    const world = this.world
    if (!world) return false
    const open = isWalkableTerrain(world.terrain[tile.y * world.width + tile.x]) || this.clearedTiles.has(`${tile.x},${tile.y}`)
    return open && !this.buildingBlocks().has(`${tile.x},${tile.y}`)
  }

  /** Plans the move the server will plan for the same order, from what this player knows of the map. Returns each path's end tile. */
  predictMove(unitIds: readonly number[], tile: TileCoord): TileCoord[] {
    const surface: UnitSnapshot[] = []
    for (const unit of this.ordered(unitIds)) {
      unit.attackId = null
      unit.attackPoint = null
      const type = UNIT_TYPES[unit.typeId]
      if (type.topSpeed > 0 && domainOf(type) !== MoveDomain.Air) surface.push(unit)
    }
    const map = this.routeMap()
    if (!map || surface.length === 0) return []
    const movers = surface.map((unit) => ({ id: unit.id, tile: { x: unit.tileX, y: unit.tileY }, domain: domainOf(UNIT_TYPES[unit.typeId]) }))
    const routes = planMoves(map, movers, tile)
    const goals: TileCoord[] = []
    for (const unit of surface) {
      const path = routes.get(unit.id)
      if (!path || path.length === 0) continue
      unit.path = path
      unit.goal = { ...path[path.length - 1] }
      goals.push(unit.goal)
    }
    return goals
  }

  /** The map as this player knows it: unexplored tiles count as open, city buildings and units as the server stamps them. */
  private routeMap(): RouteMap | null {
    const world = this.world
    if (!world) return null
    const { width, height } = world
    const blocked = new Uint8Array(width * height)
    for (const city of this.settledLayouts()) {
      if (city) {
        for (const building of city.buildings) {
          eachBuildingTile(building, (x, y) => {
            if (x >= 0 && y >= 0 && x < width && y < height) blocked[y * width + x] = 1
          })
        }
      }
    }
    const cleared = new Uint8Array(width * height)
    for (const tile of this.cleared) cleared[tile.y * width + tile.x] = 1
    const holders = new Int32Array(width * height)
    const soft = new Uint8Array(width * height)
    for (const unit of this.units) {
      const type = UNIT_TYPES[unit.typeId]
      if (unit.health <= 0 || domainOf(type) === MoveDomain.Air) continue
      const span = spanOf(type)
      for (let y = Math.max(0, unit.tileY); y < Math.min(height, unit.tileY + span.y); y++) {
        for (let x = Math.max(0, unit.tileX); x < Math.min(width, unit.tileX + span.x); x++) {
          holders[y * width + x] = unit.id
          soft[y * width + x] = type.topSpeed > 0 ? 1 : 0
        }
      }
    }
    return {
      width,
      height,
      terrainOpen(x, y, domain) {
        if (x < 0 || y < 0 || x >= width || y >= height) return false
        const index = y * width + x
        if (blocked[index] === 1) return false
        if (domain === MoveDomain.Air || world.known[index] === 0) return true
        const terrain = world.terrain[index]
        if (domain === MoveDomain.Water) return terrain === Terrain.Water || terrain === Terrain.Lake
        return isWalkableTerrain(terrain) || cleared[index] === 1
      },
      occupant(x, y) {
        const id = holders[y * width + x]
        return id === 0 ? null : id
      },
      movable(x, y) {
        return soft[y * width + x] === 1
      },
    }
  }

  /** Points ordered units at the target and leads those out of range toward it. */
  predictAttack(unitIds: readonly number[], target: { x: number; z: number }, targetId: number | null) {
    for (const unit of this.ordered(unitIds)) {
      unit.attackId = targetId
      unit.attackPoint = targetId === null ? { x: target.x, z: target.z } : null
      const range = UNIT_TYPES[unit.typeId].weapon.range
      if (Math.hypot(target.x - unit.x, target.z - unit.z) > range) this.lead(unit, { x: Math.floor(target.x), y: Math.floor(target.z) })
    }
  }

  private ordered(unitIds: readonly number[]): UnitSnapshot[] {
    const units: UnitSnapshot[] = []
    for (const id of unitIds) {
      const unit = this.unit(id)
      if (unit && unit.ownerId === this.playerId) units.push(unit)
    }
    return units
  }

  private lead(unit: UnitSnapshot, tile: TileCoord) {
    const type = UNIT_TYPES[unit.typeId]
    const domain = domainOf(type)
    if (type.topSpeed <= 0 || domain === MoveDomain.Air) return
    if (unit.goal && Math.max(Math.abs(unit.goal.x - tile.x), Math.abs(unit.goal.y - tile.y)) <= 2) return
    const lead = flightLine({ x: unit.tileX, y: unit.tileY }, tile).slice(0, LEAD_TILES)
    if (lead.length === 0 || !lead.every((step) => this.passable(step, domain))) return
    unit.path = lead
    unit.goal = { ...lead[lead.length - 1] }
  }

  homePad(unit: UnitSnapshot, selected: readonly UnitSnapshot[]): boolean {
    if (unit.ownerId !== this.playerId) return false
    const jets = selected.some((other) => other.typeId === UnitTypeId.Jet)
    const guns = selected.some((other) => other.typeId === UnitTypeId.Gunship)
    if (jets && unit.typeId === UnitTypeId.Airport) return true
    return guns && unit.typeId === UnitTypeId.Helipad
  }

  nearCity(origin: TileCoord, footprint: number, spanY = footprint): boolean {
    const owned = this.settledLayouts().filter((layout, index) => layout && this.cities[index]?.ownerId === this.playerId)
    return footprintNearCity(owned.filter((layout): layout is CityLayout => layout !== null), origin, footprint, spanY)
  }

  canRaise(tile: TileCoord): boolean {
    if (this.citySizeAt(tile, true) === null || !this.isOpen(tile, [])) return false
    const cost = this.cityBuildCost(tile)
    return cost !== null && this.credits >= cost
  }

  cityBuildCost(tile: TileCoord | null): number | null {
    if (!tile) return null
    const size = this.citySizeAt(tile, false)
    return size === null ? null : buildingCost(size)
  }

  settledLayouts(): (CityLayout | null)[] {
    this.cityLayouts()
    return this.evolved
  }

  /** City index when this tile is the player's city hall. */
  ownedHall(tile: TileCoord): number | null {
    if (this.playerId === null) return null
    const layouts = this.settledLayouts()
    for (let i = 0; i < layouts.length; i++) {
      const state = this.cities[i]
      const layout = layouts[i]
      if (!state || !layout || state.ownerId !== this.playerId) continue
      const hall = layout.buildings.find((building) => building.keep)
      if (!hall) continue
      if (tile.x >= hall.x && tile.y >= hall.y && tile.x < hall.x + HALL_SPAN && tile.y < hall.y + HALL_SPAN) return i
    }
    return null
  }

  setCityFocus(index: number, focus: number) {
    const state = this.cities[index]
    if (!state || state.ownerId !== this.playerId) return
    state.focus = focus
  }

  private applyEvent(event: ServerFrame['events'][number], tick: number) {
    if (event.kind === ServerEventKind.Welcome) {
      this.playerId = event.playerId
      this.pendingShots = []
      this.pendingHits = []
      this.pendingYields = []
      return
    }
    if (event.kind === ServerEventKind.Snapshot) {
      this.shown.clear()
      this.installMap(event.map, true)
      this.units = event.units.map(copyUnit)
      this.credits = event.credits
      this.training = event.training
      this.trainingRate.clear()
      this.trainingTick = this.serverTick
      this.rally = event.rally
      this.installCities(event.cities, true)
      this.noteCleared(event.map.cleared, true)
      this.localTick = this.serverTick
      this.accumulator = 0
      this.wantsSnapshot = false
      return
    }
    if (event.kind === ServerEventKind.MapPatch) {
      this.installMap(event.map, false)
      this.noteCleared(event.map.cleared, false)
      return
    }
    if (event.kind === ServerEventKind.CityUpdate) {
      this.installCities([event.city], false)
      return
    }
    if (event.kind === ServerEventKind.UnitMotion) {
      this.applyMotion(event.unit, tick)
      return
    }
    if (event.kind === ServerEventKind.UnitHealth) {
      const unit = this.unit(event.id)
      if (!unit) {
        this.wantsSnapshot = true
        return
      }
      unit.health = event.health
      return
    }
    if (event.kind === ServerEventKind.UnitProgress) {
      const unit = this.unit(event.id)
      if (!unit) {
        this.wantsSnapshot = true
        return
      }
      unit.progress = event.progress
      return
    }
    if (event.kind === ServerEventKind.UnitHidden) {
      this.units = this.units.filter((unit) => unit.id !== event.id)
      return
    }
    if (event.kind === ServerEventKind.ShotSpawn) {
      this.pendingShots.push(event.shot)
      return
    }
    if (event.kind === ServerEventKind.ShotHit) {
      this.pendingHits.push(event.hit)
      return
    }
    if (event.kind === ServerEventKind.Credits) {
      this.credits = event.credits
      return
    }
    if (event.kind === ServerEventKind.Training) {
      const ticks = tick - this.trainingTick
      const before = new Map<number, TrainJob>()
      for (const job of this.training) if (!before.has(job.yardId)) before.set(job.yardId, job)
      this.trainingRate.clear()
      const seen = new Set<number>()
      if (ticks > 0) {
        for (const job of event.training) {
          if (seen.has(job.yardId)) continue
          seen.add(job.yardId)
          const prior = before.get(job.yardId)
          if (prior && prior.typeId === job.typeId) this.trainingRate.set(job.yardId, Math.max(0, (job.progress - prior.progress) / ticks))
        }
      }
      this.trainingTick = tick
      this.training = event.training
      return
    }
    if (event.kind === ServerEventKind.Rally) {
      this.rally = event.rally
      return
    }
    if (event.kind === ServerEventKind.Yields) this.pendingYields.push(...event.yields)
  }

  private applyMotion(next: UnitSnapshot, tick: number) {
    const unit = this.unit(next.id)
    if (!unit) {
      this.units.push(copyUnit(next))
      return
    }
    const shown = this.shown.get(unit.id)
    const was = shown ? poseOf(shown.view) : poseOf(unit)
    const from = { x: unit.x, z: unit.z }
    unit.x = next.x
    unit.z = next.z
    unit.facing = next.facing
    unit.tileX = next.tileX
    unit.tileY = next.tileY
    unit.speed = next.speed
    unit.turretYaw = next.turretYaw
    unit.path = next.path.map((tile) => ({ x: tile.x, y: tile.y }))
    unit.goal = next.goal ? { x: next.goal.x, y: next.goal.y } : null
    unit.attackId = next.attackId
    unit.attackPoint = next.attackPoint ? { x: next.attackPoint.x, z: next.attackPoint.z } : null
    unit.health = next.health
    unit.progress = next.progress
    unit.color = next.color
    unit.home = next.home ? { x: next.home.x, y: next.home.y } : null
    unit.returning = next.returning ?? false
    unit.flight = next.flight ?? 0
    unit.altitude = next.altitude ?? 0
    unit.orbit = next.orbit ? { x: next.orbit.x, y: next.orbit.y } : null
    unit.bay = next.bay ?? -1
    unit.rounds = next.rounds ?? unit.rounds
    const behind = Math.min(REPLAY_LIMIT, this.localTick - tick)
    if (behind > 0) {
      const occupied = this.frameOccupancy ?? (this.frameOccupancy = this.occupancy())
      for (let i = 0; i < behind; i++) this.stepUnit(unit, occupied, SIM_STEP)
    }
    this.onCorrection?.(Math.hypot(unit.x - from.x, unit.z - from.z))
    if (!shown) return
    shown.before = poseOf(unit)
    const jump = Math.hypot(was.x - unit.x, was.z - unit.z)
    shown.drift = jump > TELEPORT_DISTANCE ? still() : {
      x: was.x - unit.x,
      z: was.z - unit.z,
      facing: wrapAngle(was.facing - unit.facing),
      turretYaw: wrapAngle(was.turretYaw - unit.turretYaw),
      altitude: was.altitude - (unit.altitude ?? 0),
    }
  }

  private stepUnits(dt: number) {
    for (const unit of this.units) {
      const shown = this.shown.get(unit.id)
      if (shown) shown.before = poseOf(unit)
    }
    const occupied = this.occupancy()
    for (const unit of this.units) this.stepUnit(unit, occupied, dt)
    this.aimTurrets(dt)
  }

  private aimTurrets(dt: number) {
    for (const unit of this.units) {
      const weapon = UNIT_TYPES[unit.typeId].weapon
      if (weapon.turretRate <= 0 || unit.health <= 0 || unit.progress < 1) continue
      const aim = this.aimOf(unit, Math.max(weapon.sight, weapon.range))
      if (!aim) continue
      unit.turretYaw = turnToward(unit.turretYaw, Math.atan2(aim.x - unit.x, aim.z - unit.z), weapon.turretRate, dt)
    }
  }

  /** The ordered point or target, else the nearest enemy in reach. */
  private aimOf(unit: UnitSnapshot, reach: number): { x: number; z: number } | null {
    if (unit.attackPoint) return unit.attackPoint
    const ordered = unit.attackId === null ? undefined : this.unit(unit.attackId)
    if (ordered && ordered.health > 0) return ordered
    let nearest: UnitSnapshot | null = null
    let nearestDist = reach
    for (const other of this.units) {
      if (other.ownerId === unit.ownerId || other.health <= 0) continue
      const dist = Math.hypot(other.x - unit.x, other.z - unit.z)
      if (dist > nearestDist) continue
      nearest = other
      nearestDist = dist
    }
    return nearest
  }

  private occupancy(): Map<string, number> {
    const occupied = new Map<string, number>()
    for (const unit of this.units) {
      if (unit.health <= 0) continue
      const type = UNIT_TYPES[unit.typeId]
      if (!type || domainOf(type) === MoveDomain.Air) continue
      const span = spanOf(type)
      stamp(occupied, unit.id, unit.tileX, unit.tileY, span.x, span.y)
    }
    return occupied
  }

  private stepUnit(unit: UnitSnapshot, occupied: Map<string, number>, dt: number) {
    const type = UNIT_TYPES[unit.typeId]
    if (!type || type.topSpeed <= 0 || unit.health <= 0) return
    const state: MotionState = {
      x: unit.x,
      z: unit.z,
      facing: unit.facing,
      speed: unit.speed,
      tileX: unit.tileX,
      tileY: unit.tileY,
      path: unit.path,
      homeX: unit.home?.x,
      homeY: unit.home?.y,
      returning: unit.returning,
      flight: unit.flight,
      altitude: unit.altitude,
      orbitX: unit.orbit?.x,
      orbitY: unit.orbit?.y,
      bay: unit.bay !== undefined && unit.bay >= 0 ? unit.bay : undefined,
    }
    stepMotion(state, type, dt, (x, y) => this.tileBlocked(occupied, unit.id, type.locomotion, x, y))
    const span = spanOf(type)
    if (state.tileX !== unit.tileX || state.tileY !== unit.tileY) {
      clearStamp(occupied, unit.id, unit.tileX, unit.tileY, span.x, span.y)
      stamp(occupied, unit.id, state.tileX, state.tileY, span.x, span.y)
    }
    unit.x = state.x
    unit.z = state.z
    unit.facing = state.facing
    unit.speed = state.speed
    unit.tileX = state.tileX
    unit.tileY = state.tileY
    unit.path = state.path
    unit.returning = state.returning ?? false
    unit.flight = state.flight ?? 0
    unit.altitude = state.altitude ?? 0
    unit.orbit = state.orbitX !== undefined && state.orbitY !== undefined ? { x: state.orbitX, y: state.orbitY } : null
    unit.goal = state.path.length > 0 ? { ...state.path[state.path.length - 1] } : null
  }

  private tileBlocked(
    occupied: ReadonlyMap<string, number>,
    self: number,
    locomotion: Locomotion,
    x: number,
    y: number,
  ): boolean {
    if (locomotion === Locomotion.Plane || locomotion === Locomotion.Rotor) return false
    const holder = occupied.get(`${x},${y}`)
    if (holder !== undefined && holder !== self) return true
    const world = this.world
    if (!world) return false
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return true
    const index = y * world.width + x
    if (world.known[index] === 0) return false
    const terrain = world.terrain[index]
    if (locomotion === Locomotion.Hull) return terrain !== Terrain.Water && terrain !== Terrain.Lake
    return !isWalkableTerrain(terrain)
  }

  private installMap(map: MapData, replace: boolean) {
    const world = replace || !this.world ? blankWorld(map.width, map.height) : this.world
    if (replace) {
      world.coast = []
      world.holes = []
      world.roads = []
      world.towns = []
      this.knownTiles = 0
    }
    for (const cell of map.cells) {
      if (cell.x < 0 || cell.y < 0 || cell.x >= world.width || cell.y >= world.height) continue
      const index = cell.y * world.width + cell.x
      world.terrain[index] = cell.terrain
      if (world.known[index] === 0) this.knownTiles += 1
      world.known[index] = 1
      world.shifts[index] = cell.shift
    }
    world.coast.push(...map.coast)
    world.holes.push(...map.holes)
    world.roads.push(...map.roads)
    world.towns.push(...map.towns)
    this.world = world
    this.terrainRevision += 1
  }

  private installCities(records: readonly CityRecord[], replace: boolean) {
    if (replace) {
      this.cities = []
      this.layouts = []
    }
    for (const record of records) {
      while (this.cities.length <= record.index) {
        this.cities.push(null)
        this.layouts.push(null)
      }
      this.cities[record.index] = record.state
      if (record.layout) this.layouts[record.index] = record.layout
    }
    this.cityRevision += 1
  }

  private citySizeAt(tile: TileCoord, plotOnly: boolean): number | null {
    const world = this.world
    if (!world || this.playerId === null) return null
    const layouts = this.cityLayouts()
    for (let i = 0; i < layouts.length; i++) {
      const state = this.cities[i]
      const layout = layouts[i]
      if (!state || !layout || state.ownerId !== this.playerId) continue
      const plot = canPlaceCityBuilding(layout, tile.x, tile.y, world.terrain, world.width, world.height)
      if (!plot && (plotOnly || !cityContains(layout, tile.x, tile.y))) continue
      return populationOf(layout, state.ruins)
    }
    return null
  }

  private cityLayouts(): (CityLayout | null)[] {
    if (this.settledRevision === this.cityRevision) return this.evolved
    this.evolved = this.layouts.map((layout, index) => (layout ? settledCity(layout, this.cities[index]?.ruins ?? []) : null))
    const blocked = new Set<string>()
    for (const city of this.evolved) {
      if (!city) continue
      for (const building of city.buildings) eachBuildingTile(building, (x, y) => blocked.add(`${x},${y}`))
    }
    this.blockedBuildings = blocked
    this.settledRevision = this.cityRevision
    return this.evolved
  }

  private noteCleared(tiles: readonly TileCoord[], replace: boolean) {
    if (replace) {
      this.cleared = []
      this.clearedTiles.clear()
    }
    for (const tile of tiles) {
      const key = `${tile.x},${tile.y}`
      if (this.clearedTiles.has(key)) continue
      this.clearedTiles.add(key)
      this.cleared.push({ x: tile.x, y: tile.y })
    }
  }

  private buildingBlocks(): Set<string> {
    this.cityLayouts()
    return this.blockedBuildings
  }
}

function stamp(occupied: Map<string, number>, id: number, tileX: number, tileY: number, spanX: number, spanY = spanX) {
  for (let dy = 0; dy < spanY; dy++) {
    for (let dx = 0; dx < spanX; dx++) occupied.set(`${tileX + dx},${tileY + dy}`, id)
  }
}

function clearStamp(occupied: Map<string, number>, id: number, tileX: number, tileY: number, spanX: number, spanY = spanX) {
  for (let dy = 0; dy < spanY; dy++) {
    for (let dx = 0; dx < spanX; dx++) {
      const key = `${tileX + dx},${tileY + dy}`
      if (occupied.get(key) === id) occupied.delete(key)
    }
  }
}

function poseOf(unit: UnitSnapshot): Pose {
  return { x: unit.x, z: unit.z, facing: unit.facing, turretYaw: unit.turretYaw, altitude: unit.altitude ?? 0 }
}

function still(): Pose {
  return { x: 0, z: 0, facing: 0, turretYaw: 0, altitude: 0 }
}

function scalePose(pose: Pose, factor: number) {
  pose.x *= factor
  pose.z *= factor
  pose.facing *= factor
  pose.turretYaw *= factor
  pose.altitude *= factor
}

function copyUnit(unit: UnitSnapshot): UnitSnapshot {
  return {
    ...unit,
    path: unit.path.map((tile) => ({ x: tile.x, y: tile.y })),
    goal: unit.goal ? { x: unit.goal.x, y: unit.goal.y } : null,
    attackPoint: unit.attackPoint ? { x: unit.attackPoint.x, z: unit.attackPoint.z } : null,
  }
}

function blankWorld(width: number, height: number): WorldSnapshot {
  const count = width * height
  const terrain: Terrain[] = []
  for (let i = 0; i < count; i++) terrain.push(Terrain.Obstacle)
  return {
    width,
    height,
    terrain,
    known: new Uint8Array(count),
    shifts: new Uint8Array(count),
    coast: [],
    holes: [],
    roads: [],
    towns: [],
    seed: 0,
  }
}
