import { createLocalLink } from '../shared/local-link.ts'
import { KEEPALIVE_TICKS, MOTION_HEARTBEAT, SNAPSHOT_COOLDOWN, wrapAngle } from '../shared/motion.ts'
import {
  ClientMessageKind,
  ServerEventKind,
  type CityRecord,
  type CityState,
  type ClientMessage,
  type ClientPort,
  type MapData,
  type MapPoint,
  type ServerEvent,
  type ServerFrame,
  type ShotEvent,
  type TrainJob,
  type ShotHit,
  type UnitSnapshot,
} from '../shared/protocol.ts'
import type { CityLayout } from '../shared/cities.ts'
import { type TileCoord } from '../shared/tiles.ts'
import { spanOf, UNIT_TYPES } from '../shared/unit-types.ts'
import { EXPLORE_MARGIN, friendsOf } from '../shared/vision.ts'
import type { AiPlayer } from '../ai/player.ts'
import { Replica } from '../client/replica.ts'
import type { Game } from './game.ts'
import type { Player } from './player.ts'

const PROGRESS_STEPS = 40
const LEDGER_TICKS = 6
const SNAPSHOT_COOLDOWN_MS = 1000
const DRIFT_TILES = 0.25
const DRIFT_TURN = 0.35
const DRIFT_ALTITUDE = 0.25
const BACKSTOP_TICKS = 300
const CATCH_UP_TICKS = 15
const MARGIN_OFFSETS = discOffsets(EXPLORE_MARGIN)
const NO_UNITS: ReadonlySet<number> = new Set()

type VisibleCity = CityRecord & { layout: CityLayout }

/** A change that may wait for the next frame going out anyway, or for the ledger cadence. */
type Deferred = { event: ServerEvent; commit(): void }

type Session = {
  playerId: number
  playing: boolean
  /** Remote players get a command's result at once instead of on the next tick. */
  echo: boolean
  ack: number
  /** What a remote player's client holds apart from its own order guesses: fed every frame sent and stepped like the client, so units are corrected when they drift from it or are ordered. */
  shadow: Replica | null
  send(message: ServerFrame): void
}

type Memory = {
  owner: number
  explored: Uint8Array
  /** Holds `sight` for tiles in view this tick and `sight - 1` for tiles in view last tick. */
  visible: Uint32Array
  sight: number
  felledSeen: number
  /** Tiles explored or changed since the last map patch went out. */
  unsentTiles: Set<number>
  seen: Set<number>
  route: Map<number, number>
  motionTick: Map<number, number>
  health: Map<number, number>
  progress: Map<number, number>
  cityCore: Map<number, string>
  cityProgress: Map<number, number>
  cityShape: Map<number, string>
  credits: number | null
  trainingKinds: string | null
  training: string | null
  rally: string | null
  primary: number | null
  lastSnapshotTick: number
  lastSnapshotAt: number
  lastSentTick: number
  ledgerTick: number
  ackSent: number
}

export type RemotePlay = {
  readonly playing: boolean
  retire(): void
  command(message: ClientMessage, seq: number, tick: number): void
  setView(playerId: number): void
  sync(): void
  close(): void
}

export class ServerHost {
  tickNo = 0
  private readonly sessions: Session[] = []
  private readonly memory = new Map<Session, Memory>()
  private ais: AiPlayer[]
  private stopped = false

  constructor(
    readonly game: Game,
    ai: AiPlayer | readonly AiPlayer[] = [],
  ) {
    this.ais = Array.isArray(ai) ? ai : [ai]
  }

  join(player: Player): ClientPort {
    const link = createLocalLink(player.id)
    const session: Session = {
      playerId: player.id,
      playing: true,
      echo: false,
      ack: 0,
      shadow: null,
      send: (message) => link.server.send(message),
    }
    link.server.onClient((message) => this.onCommand(session, message))
    this.sessions.push(session)
    return link.client
  }

  attach(playerId: number, playing: boolean, send: (message: ServerFrame) => void): RemotePlay {
    const session: Session = { playerId, playing, echo: true, ack: 0, shadow: null, send }
    this.sessions.push(session)
    return {
      get playing() {
        return session.playing
      },
      retire() {
        session.playing = false
      },
      command: (message, seq, tick) => {
        session.ack = seq
        this.onCommand(session, message, tick)
      },
      setView: (next) => {
        if (session.playing) return
        session.playerId = next
        this.memory.delete(session)
        this.pushSync(session)
      },
      sync: () => this.pushSync(session),
      close: () => {
        const index = this.sessions.indexOf(session)
        if (index >= 0) this.sessions.splice(index, 1)
        this.memory.delete(session)
      },
    }
  }

  addAi(ai: AiPlayer) {
    this.ais.push(ai)
  }

  setAiPace(pace: number) {
    for (const ai of this.ais) ai.setPace(pace)
  }

  dispose() {
    this.stopped = true
    this.ais = []
    this.sessions.length = 0
    this.memory.clear()
  }

  silence(playerId: number) {
    this.ais = this.ais.filter((ai) => ai.playerId !== playerId)
  }

  sync(playerId: number) {
    const session = this.sessions.find((port) => port.playerId === playerId)
    if (session) this.pushSync(session)
  }

  tick(dt: number) {
    if (this.stopped) return
    for (const ai of this.ais) ai.update(dt)
    const shots = this.game.tick(dt)
    const hits = this.game.takeHits()
    const yields = this.game.takeYields()
    this.game.takeDeaths()
    this.tickNo += 1
    const living = this.game.unitSnapshots()
    for (const session of this.sessions) {
      if (!this.memory.has(session)) {
        this.pushSync(session)
        continue
      }
      this.pushTick(session, living, shots, hits, yields)
    }
  }

  private onCommand(session: Session, message: ClientMessage, tick?: number) {
    this.apply(session, message, tick === undefined ? 0 : Math.max(0, Math.min(CATCH_UP_TICKS, this.tickNo - tick)))
    if (!session.echo) return
    this.pushTick(session, this.game.unitSnapshots(), [], [], [], session.playing ? orderedUnits(message) : NO_UNITS)
  }

  /** `lag` is how many ticks the sender's own simulation ran past the moment it issued the command. */
  private apply(session: Session, message: ClientMessage, lag: number) {
    if (message.kind === ClientMessageKind.RequestSnapshot) {
      const memory = this.memory.get(session)
      const recent = memory && this.tickNo - memory.lastSnapshotTick < SNAPSHOT_COOLDOWN && performance.now() - memory.lastSnapshotAt < SNAPSHOT_COOLDOWN_MS
      if (recent) return
      this.pushSync(session)
      return
    }
    if (!session.playing) return
    const playerId = session.playerId
    if (message.kind === ClientMessageKind.OrderMove) {
      this.game.orderMove(playerId, message.unitIds, message.tile, lag)
    } else if (message.kind === ClientMessageKind.OrderAttack) {
      this.game.orderAttack(playerId, message.unitIds, message.targetId)
    } else if (message.kind === ClientMessageKind.OrderAttackGround) {
      this.game.orderAttackGround(playerId, message.unitIds, message.tile)
    } else if (message.kind === ClientMessageKind.Spawn) {
      this.game.trySpawn(playerId, message.typeId)
    } else if (message.kind === ClientMessageKind.CancelSpawn) {
      this.game.cancelTraining(playerId, message.typeId)
    } else if (message.kind === ClientMessageKind.PlaceBuilding) {
      this.game.placeBuilding(playerId, message.typeId, message.tile)
    } else if (message.kind === ClientMessageKind.PlaceCity) {
      this.game.placeCityBuilding(playerId, message.tile)
    } else if (message.kind === ClientMessageKind.CancelBuilding) {
      this.game.cancelBuild(playerId, message.typeId)
    } else if (message.kind === ClientMessageKind.SetPrimary) {
      this.game.setPrimary(playerId, message.unitId)
    } else if (message.kind === ClientMessageKind.SetRally) {
      this.game.setRally(playerId, message.tile)
    }
  }

  private pushSync(session: Session) {
    const memory = this.blank(session.playerId)
    this.memory.set(session, memory)
    const { width } = this.game.world
    const living = this.game.unitSnapshots()
    this.reveal(memory, living)
    const units = living.filter((unit) => this.knows(memory, unit, width))
    const cities = this.visibleCities(memory)
    const map = this.mapOf(memory)
    const training = this.game.trainingFor(session.playerId)
    const rally = this.game.rally(session.playerId)
    const primary = this.game.primaryFactory(session.playerId)
    const credits = this.game.player(session.playerId)?.credits ?? 0
    this.remember(memory, units, cities, credits, training, rally, primary)
    memory.lastSnapshotTick = this.tickNo
    memory.lastSnapshotAt = performance.now()
    memory.ackSent = session.ack
    const frame: ServerFrame = {
      tick: this.tickNo,
      ack: session.ack,
      events: [
        { kind: ServerEventKind.Welcome, playerId: session.playerId },
        {
          kind: ServerEventKind.Snapshot,
          map,
          units,
          cities,
          credits,
          training,
          primaryFactoryId: primary,
          rally,
        },
      ],
    }
    session.send(frame)
    if (!session.echo) return
    session.shadow = new Replica()
    session.shadow.apply(frame)
  }

  private pushTick(
    session: Session,
    living: readonly UnitSnapshot[],
    shots: readonly ShotEvent[],
    hits: readonly ShotHit[],
    yields: readonly MapPoint[],
    ordered = NO_UNITS,
  ) {
    const memory = this.memory.get(session)
    if (!memory) return
    const { width, height } = this.game.world
    const fresh = this.reveal(memory, living)
    const shadow = session.shadow
    shadow?.simulateTo(this.tickNo)
    const held = shadow ? new Map(shadow.units.map((unit) => [unit.id, unit])) : null
    const events: ServerEvent[] = []
    const ledger: Deferred[] = []
    const patch = this.changedMap(memory, fresh)
    if (patch) ledger.push({ event: { kind: ServerEventKind.MapPatch, map: patch }, commit: () => memory.unsentTiles.clear() })
    this.changedCities(memory, events, ledger)

    const known = new Set<number>()
    for (const unit of living) {
      if (!this.knows(memory, unit, width)) continue
      known.add(unit.id)
      const mobile = unit.path.length > 0 || unit.speed !== 0 || this.routeOf(unit) !== 0
      const freshUnit = !memory.seen.has(unit.id)
      const routeChanged = memory.route.get(unit.id) !== this.routeOf(unit)
      const beat = held ? BACKSTOP_TICKS : MOTION_HEARTBEAT
      const due = this.tickNo - (memory.motionTick.get(unit.id) ?? -beat) >= beat
      const commitMotion = () => {
        memory.seen.add(unit.id)
        memory.route.set(unit.id, this.routeOf(unit))
        memory.motionTick.set(unit.id, this.tickNo)
      }
      const answered = ordered.has(unit.id) && unit.ownerId === session.playerId
      if (freshUnit || answered || (mobile && routeChanged) || (held && drifted(held.get(unit.id), unit))) {
        events.push({ kind: ServerEventKind.UnitMotion, unit })
        commitMotion()
      } else if (due && (held ? unit.path.length > 0 || unit.speed !== 0 : mobile)) {
        ledger.push({ event: { kind: ServerEventKind.UnitMotion, unit }, commit: commitMotion })
      }
      if (memory.health.get(unit.id) !== unit.health) {
        if (!freshUnit) events.push({ kind: ServerEventKind.UnitHealth, id: unit.id, health: unit.health })
        memory.health.set(unit.id, unit.health)
      }
      if (memory.progress.get(unit.id) !== unit.progress) {
        const commit = () => memory.progress.set(unit.id, unit.progress)
        const event: ServerEvent = { kind: ServerEventKind.UnitProgress, id: unit.id, progress: unit.progress }
        if (freshUnit) commit()
        else if (unit.progress >= 1) {
          events.push(event)
          commit()
        } else ledger.push({ event, commit })
      }
    }
    for (const id of [...memory.seen]) {
      if (known.has(id)) continue
      events.push({ kind: ServerEventKind.UnitHidden, id })
      memory.seen.delete(id)
      memory.route.delete(id)
      memory.motionTick.delete(id)
      memory.health.delete(id)
      memory.progress.delete(id)
    }
    for (const shot of shots) {
      if (!this.shotVisible(memory, shot, living, session.playerId, width, height)) continue
      events.push({ kind: ServerEventKind.ShotSpawn, shot })
    }
    for (const hit of hits) {
      if (!this.lit(memory, hit.aimX, hit.aimZ, width, height)) continue
      events.push({ kind: ServerEventKind.ShotHit, hit })
    }
    const seenYields = yields.filter((point) => this.lit(memory, point.x, point.y, width, height))
    if (seenYields.length > 0) events.push({ kind: ServerEventKind.Yields, yields: seenYields })
    this.economy(session, memory, events, ledger)
    const acked = memory.ackSent !== session.ack
    if (ledger.length > 0 && (events.length > 0 || acked || this.tickNo - memory.ledgerTick >= LEDGER_TICKS)) {
      for (const entry of ledger) {
        events.push(entry.event)
        entry.commit()
      }
      memory.ledgerTick = this.tickNo
    }
    if (events.length === 0 && !acked && this.tickNo - memory.lastSentTick < KEEPALIVE_TICKS) return
    memory.lastSentTick = this.tickNo
    memory.ackSent = session.ack
    const frame: ServerFrame = { tick: this.tickNo, events, ack: session.ack }
    session.send(frame)
    shadow?.apply(frame)
  }

  private economy(session: Session, memory: Memory, events: ServerEvent[], ledger: Deferred[]) {
    const credits = this.game.player(session.playerId)?.credits ?? 0
    if (memory.credits !== credits) {
      ledger.push({ event: { kind: ServerEventKind.Credits, credits }, commit: () => (memory.credits = credits) })
    }
    const training = this.game.trainingFor(session.playerId)
    const kinds = trainingKinds(training)
    const trainingKey = JSON.stringify(training)
    if (memory.trainingKinds !== kinds) {
      memory.trainingKinds = kinds
      memory.training = trainingKey
      events.push({ kind: ServerEventKind.Training, training })
    } else if (memory.training !== trainingKey) {
      ledger.push({ event: { kind: ServerEventKind.Training, training }, commit: () => (memory.training = trainingKey) })
    }
    const rally = this.game.rally(session.playerId)
    const rallyKey = rally ? `${rally.x},${rally.y}` : ''
    if (memory.rally !== rallyKey) {
      memory.rally = rallyKey
      events.push({ kind: ServerEventKind.Rally, rally })
    }
    const primary = this.game.primaryFactory(session.playerId)
    if (memory.primary !== primary) {
      memory.primary = primary
      events.push({ kind: ServerEventKind.Primary, primaryFactoryId: primary })
    }
  }

  private remember(
    memory: Memory,
    units: readonly UnitSnapshot[],
    cities: readonly VisibleCity[],
    credits: number,
    training: ReturnType<Game['trainingFor']>,
    rally: TileCoord | null,
    primary: number,
  ) {
    memory.seen.clear()
    for (const unit of units) {
      memory.seen.add(unit.id)
      memory.route.set(unit.id, this.routeOf(unit))
      memory.motionTick.set(unit.id, this.tickNo)
      memory.health.set(unit.id, unit.health)
      memory.progress.set(unit.id, unit.progress)
    }
    memory.cityCore.clear()
    memory.cityProgress.clear()
    memory.cityShape.clear()
    for (const city of cities) {
      memory.cityCore.set(city.index, coreKey(city.state))
      memory.cityProgress.set(city.index, progressStep(city.state))
      memory.cityShape.set(city.index, shapeKey(city.layout))
    }
    memory.credits = credits
    memory.trainingKinds = trainingKinds(training)
    memory.training = JSON.stringify(training)
    memory.rally = rally ? `${rally.x},${rally.y}` : ''
    memory.primary = primary
  }

  private blank(playerId: number): Memory {
    const tiles = this.game.world.width * this.game.world.height
    return {
      owner: playerId,
      explored: new Uint8Array(tiles),
      visible: new Uint32Array(tiles),
      sight: 1,
      felledSeen: 0,
      unsentTiles: new Set(),
      seen: new Set(),
      route: new Map(),
      motionTick: new Map(),
      health: new Map(),
      progress: new Map(),
      cityCore: new Map(),
      cityProgress: new Map(),
      cityShape: new Map(),
      credits: null,
      trainingKinds: null,
      training: null,
      rally: null,
      primary: null,
      lastSnapshotTick: -SNAPSHOT_COOLDOWN,
      lastSnapshotAt: -SNAPSHOT_COOLDOWN_MS,
      lastSentTick: this.tickNo,
      ledgerTick: this.tickNo,
      ackSent: 0,
    }
  }

  private reveal(memory: Memory, units: readonly UnitSnapshot[]): TileCoord[] {
    const { width, height } = this.game.world
    const fresh: TileCoord[] = []
    const sight = ++memory.sight
    const see = (x: number, y: number) => {
      const index = y * width + x
      const before = memory.visible[index]
      memory.visible[index] = sight
      if (before === sight || before === sight - 1) return
      for (const offset of MARGIN_OFFSETS) {
        const nx = x + offset.x
        const ny = y + offset.y
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const near = ny * width + nx
        if (memory.explored[near] === 1) continue
        memory.explored[near] = 1
        fresh.push({ x: nx, y: ny })
      }
    }
    for (const friend of friendsOf(units, memory.owner, this.game.citySights())) {
      const reach = Math.ceil(friend.sight)
      const originX = Math.floor(friend.x)
      const originY = Math.floor(friend.z)
      const reachSq = friend.sight * friend.sight
      for (let y = Math.max(0, originY - reach); y <= Math.min(height - 1, originY + reach); y++) {
        for (let x = Math.max(0, originX - reach); x <= Math.min(width - 1, originX + reach); x++) {
          const cx = x + 0.5 - friend.x
          const cz = y + 0.5 - friend.z
          if (cx * cx + cz * cz <= reachSq) see(x, y)
        }
      }
    }
    for (const unit of units) {
      if (unit.ownerId !== memory.owner || unit.health <= 0) continue
      const span = spanOf(UNIT_TYPES[unit.typeId])
      for (let y = Math.max(0, unit.tileY); y < Math.min(height, unit.tileY + span.y); y++) {
        for (let x = Math.max(0, unit.tileX); x < Math.min(width, unit.tileX + span.x); x++) see(x, y)
      }
    }
    return fresh
  }

  private knows(memory: Memory, unit: UnitSnapshot, width: number): boolean {
    if (unit.ownerId === memory.owner) return true
    const index = unit.tileY * width + unit.tileX
    return index >= 0 && index < memory.visible.length && memory.visible[index] === memory.sight
  }

  private pointVisible(memory: Memory, x: number, z: number, width: number, height: number): boolean {
    const tx = Math.floor(x)
    const ty = Math.floor(z)
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return false
    return memory.explored[ty * width + tx] === 1
  }

  private shotVisible(
    memory: Memory,
    shot: ShotEvent,
    units: readonly UnitSnapshot[],
    playerId: number,
    width: number,
    height: number,
  ): boolean {
    const shooter = units.find((unit) => unit.id === shot.shooterId)
    if (shooter?.ownerId === playerId) return true
    return (
      this.lit(memory, shot.x, shot.z, width, height) ||
      this.lit(memory, shot.aimX, shot.aimZ, width, height)
    )
  }

  private lit(memory: Memory, x: number, z: number, width: number, height: number): boolean {
    const tx = Math.floor(x)
    const ty = Math.floor(z)
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return false
    return memory.visible[ty * width + tx] === memory.sight
  }

  private visibleCities(memory: Memory): VisibleCity[] {
    const records: VisibleCity[] = []
    const states = this.game.cityStates()
    const layouts = this.game.cityLayouts()
    for (let index = 0; index < states.length; index++) {
      const layout = clipLayout(layouts[index], memory.explored, this.game.world.width)
      if (!layout || layout.tiles.length === 0) continue
      const state = clipState(states[index], memory.explored, this.game.world.width)
      records.push({ index, state, layout })
    }
    return records
  }

  private changedCities(memory: Memory, events: ServerEvent[], ledger: Deferred[]) {
    const live = new Set<number>()
    for (const city of this.visibleCities(memory)) {
      const index = city.index
      live.add(index)
      const shape = shapeKey(city.layout)
      const core = coreKey(city.state)
      const progress = progressStep(city.state)
      const reshaped = memory.cityShape.get(index) !== shape
      const recast = memory.cityCore.get(index) !== core
      if (!reshaped && !recast && memory.cityProgress.get(index) === progress) continue
      const event: ServerEvent = {
        kind: ServerEventKind.CityUpdate,
        city: { index, state: city.state, layout: reshaped ? city.layout : null },
      }
      const commit = () => {
        memory.cityShape.set(index, shape)
        memory.cityCore.set(index, core)
        memory.cityProgress.set(index, progress)
      }
      if (reshaped || recast) {
        events.push(event)
        commit()
      } else ledger.push({ event, commit })
    }
    for (const index of [...memory.cityCore.keys()]) {
      if (live.has(index)) continue
      memory.cityCore.delete(index)
      memory.cityProgress.delete(index)
      memory.cityShape.delete(index)
    }
  }

  private mapOf(memory: Memory): MapData {
    const { width, height } = this.game.world
    const cells = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (memory.explored[y * width + x] !== 1) continue
        cells.push({ x, y, terrain: this.game.world.terrainAt(x, y), shift: this.game.world.shiftAt(x, y) })
      }
    }
    const felled = this.game.felled()
    memory.felledSeen = felled.length
    return {
      width,
      height,
      cells,
      coast: [],
      holes: [],
      roads: [],
      towns: this.game.scenery.towns.filter((point) => this.pointVisible(memory, point.x, point.y, width, height)),
      cleared: felled.filter((tile) => memory.explored[tile.y * width + tile.x] === 1),
    }
  }

  private changedMap(memory: Memory, fresh: readonly TileCoord[]): MapData | null {
    const { width, height } = this.game.world
    const wanted = memory.unsentTiles
    for (const tile of fresh) wanted.add(tile.y * width + tile.x)
    const felled = this.game.felled()
    for (let i = memory.felledSeen; i < felled.length; i++) {
      const index = felled[i].y * width + felled[i].x
      if (memory.explored[index] === 1) wanted.add(index)
    }
    memory.felledSeen = felled.length
    if (wanted.size === 0) return null
    const cells = []
    for (const index of wanted) {
      const x = index % width
      const y = (index - x) / width
      cells.push({ x, y, terrain: this.game.world.terrainAt(x, y), shift: this.game.world.shiftAt(x, y) })
    }
    return {
      width,
      height,
      cells,
      coast: [],
      holes: [],
      roads: [],
      towns: this.game.scenery.towns.filter((point) => wanted.has(Math.floor(point.y) * width + Math.floor(point.x))),
      cleared: felled.filter((tile) => wanted.has(tile.y * width + tile.x)),
    }
  }

  private routeOf(unit: UnitSnapshot): number {
    const live = this.game.units.find((candidate) => candidate.id === unit.id)
    return live?.route ?? 0
  }
}

function clipLayout(layout: CityLayout | undefined, explored: Uint8Array, width: number): CityLayout | null {
  if (!layout) return null
  const seen = (x: number, y: number) => {
    const index = y * width + x
    return index >= 0 && index < explored.length && explored[index] === 1
  }
  return {
    x: layout.x,
    y: layout.y,
    span: layout.span,
    seed: layout.seed,
    tiles: layout.tiles.filter((tile) => seen(tile.x, tile.y)),
    buildings: layout.buildings.filter((building) => seen(building.x, building.y)),
    streets: layout.streets.filter((street) => seen(street.x, street.y)),
  }
}

function clipState(state: CityState, explored: Uint8Array, width: number): CityState {
  const seen = (x: number, y: number) => explored[y * width + x] === 1
  return {
    ...state,
    ruins: state.ruins.filter((tile) => seen(tile.x, tile.y)),
    sites: state.sites.filter((site) => seen(site.x, site.y)),
  }
}

function coreKey(state: CityState): string {
  const ruins = state.ruins.map((tile) => `${tile.x},${tile.y}`).join('.')
  const sites = state.sites.map((site) => `${site.at}:${site.x},${site.y},${site.model},${site.yaw}`).join(';')
  return `${state.ownerId}:${state.challengerId}:${state.grown}:${ruins}:${sites}`
}

function progressStep(state: CityState): number {
  return Math.round(state.progress * PROGRESS_STEPS)
}

function shapeKey(layout: CityLayout): string {
  const buildings = layout.buildings.map((building) => `${building.x},${building.y},${building.model}`).join(';')
  return `${layout.tiles.length}:${layout.streets.length}:${buildings}`
}

function discOffsets(radius: number): TileCoord[] {
  const offsets: TileCoord[] = []
  const reach = Math.ceil(radius)
  for (let y = -reach; y <= reach; y++) {
    for (let x = -reach; x <= reach; x++) if (x * x + y * y <= radius * radius) offsets.push({ x, y })
  }
  return offsets
}

function orderedUnits(message: ClientMessage): ReadonlySet<number> {
  const order =
    message.kind === ClientMessageKind.OrderMove ||
    message.kind === ClientMessageKind.OrderAttack ||
    message.kind === ClientMessageKind.OrderAttackGround
  return order ? new Set(message.unitIds) : NO_UNITS
}

function trainingKinds(training: readonly TrainJob[]): string {
  return training.map((job) => job.typeId).join(',')
}

function drifted(held: UnitSnapshot | undefined, unit: UnitSnapshot): boolean {
  if (!held) return true
  if (Math.hypot(held.x - unit.x, held.z - unit.z) > DRIFT_TILES) return true
  if (Math.abs(wrapAngle(held.facing - unit.facing)) > DRIFT_TURN) return true
  if (Math.abs(wrapAngle(held.turretYaw - unit.turretYaw)) > DRIFT_TURN) return true
  if (Math.abs((held.altitude ?? 0) - (unit.altitude ?? 0)) > DRIFT_ALTITUDE) return true
  return held.path.length !== unit.path.length
}
