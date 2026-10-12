import { createLocalLink } from '../shared/local-link.ts'
import { KEEPALIVE_TICKS, MOTION_HEARTBEAT, SNAPSHOT_COOLDOWN } from '../shared/motion.ts'
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
  type ShotHit,
  type UnitSnapshot,
} from '../shared/protocol.ts'
import type { CityLayout } from '../shared/cities.ts'
import { type TileCoord } from '../shared/tiles.ts'
import { UNIT_TYPES } from '../shared/unit-types.ts'
import { friendsOf, growExplored, stampSight } from '../shared/vision.ts'
import type { AiPlayer } from '../ai/player.ts'
import type { Game } from './game.ts'
import type { Player } from './player.ts'

const UNSET = 255

type Session = {
  playerId: number
  playing: boolean
  send(message: ServerFrame): void
}

type Memory = {
  explored: Uint8Array
  visible: Uint8Array
  seen: Set<number>
  route: Map<number, number>
  motionTick: Map<number, number>
  health: Map<number, number>
  progress: Map<number, number>
  citySig: Map<number, string>
  credits: number | null
  training: string | null
  rally: string | null
  primary: number | null
  terrainSent: Uint8Array
  lastSnapshotTick: number
  lastSentTick: number
}

export type RemotePlay = {
  readonly playing: boolean
  retire(): void
  command(message: ClientMessage): void
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
      send: (message) => link.server.send(message),
    }
    link.server.onClient((message) => this.onCommand(session, message))
    this.sessions.push(session)
    return link.client
  }

  attach(playerId: number, playing: boolean, send: (message: ServerFrame) => void): RemotePlay {
    const session: Session = { playerId, playing, send }
    this.sessions.push(session)
    return {
      get playing() {
        return session.playing
      },
      retire() {
        session.playing = false
      },
      command: (message) => this.onCommand(session, message),
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

  private onCommand(session: Session, message: ClientMessage) {
    if (message.kind === ClientMessageKind.RequestSnapshot) {
      const memory = this.memory.get(session)
      if (memory && this.tickNo - memory.lastSnapshotTick < SNAPSHOT_COOLDOWN) return
      this.pushSync(session)
      return
    }
    if (!session.playing) return
    const playerId = session.playerId
    if (message.kind === ClientMessageKind.OrderMove) {
      this.game.orderMove(playerId, message.unitId, message.tile)
    } else if (message.kind === ClientMessageKind.OrderAttack) {
      this.game.orderAttack(playerId, message.unitId, message.targetId)
    } else if (message.kind === ClientMessageKind.OrderAttackGround) {
      this.game.orderAttackGround(playerId, message.unitId, message.tile)
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
    session.send({
      tick: this.tickNo,
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
    })
  }

  private pushTick(
    session: Session,
    living: readonly UnitSnapshot[],
    shots: readonly ShotEvent[],
    hits: readonly ShotHit[],
    yields: readonly MapPoint[],
  ) {
    const memory = this.memory.get(session)
    if (!memory) return
    const { width, height } = this.game.world
    const fresh = this.reveal(memory, living)
    const events: ServerEvent[] = []
    const patch = this.changedMap(memory, fresh)
    if (patch) events.push({ kind: ServerEventKind.MapPatch, map: patch })
    for (const city of this.changedCities(memory)) events.push({ kind: ServerEventKind.CityUpdate, city })

    const known = new Set<number>()
    for (const unit of living) {
      if (!this.knows(memory, unit, width)) continue
      known.add(unit.id)
      const mobile = unit.path.length > 0 || unit.speed !== 0 || this.routeOf(unit) !== 0
      const freshUnit = !memory.seen.has(unit.id)
      const routeChanged = memory.route.get(unit.id) !== this.routeOf(unit)
      const due = this.tickNo - (memory.motionTick.get(unit.id) ?? -MOTION_HEARTBEAT) >= MOTION_HEARTBEAT
      if (freshUnit || (mobile && (routeChanged || due)) || (!mobile && freshUnit)) {
        events.push({ kind: ServerEventKind.UnitMotion, unit })
        memory.seen.add(unit.id)
        memory.route.set(unit.id, this.routeOf(unit))
        memory.motionTick.set(unit.id, this.tickNo)
      }
      if (memory.health.get(unit.id) !== unit.health) {
        if (!freshUnit) events.push({ kind: ServerEventKind.UnitHealth, id: unit.id, health: unit.health })
        memory.health.set(unit.id, unit.health)
      }
      if (memory.progress.get(unit.id) !== unit.progress) {
        if (!freshUnit) events.push({ kind: ServerEventKind.UnitProgress, id: unit.id, progress: unit.progress })
        memory.progress.set(unit.id, unit.progress)
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
    this.economy(session, memory, events)
    if (events.length === 0 && this.tickNo - memory.lastSentTick < KEEPALIVE_TICKS) return
    memory.lastSentTick = this.tickNo
    session.send({ tick: this.tickNo, events })
  }

  private economy(session: Session, memory: Memory, events: ServerEvent[]) {
    const credits = this.game.player(session.playerId)?.credits ?? 0
    if (memory.credits !== credits) {
      memory.credits = credits
      events.push({ kind: ServerEventKind.Credits, credits })
    }
    const training = this.game.trainingFor(session.playerId)
    const trainingKey = JSON.stringify(training)
    if (memory.training !== trainingKey) {
      memory.training = trainingKey
      events.push({ kind: ServerEventKind.Training, training })
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
    cities: readonly CityRecord[],
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
    memory.citySig.clear()
    for (const city of cities) memory.citySig.set(city.index, cityKey(city))
    memory.credits = credits
    memory.training = JSON.stringify(training)
    memory.rally = rally ? `${rally.x},${rally.y}` : ''
    memory.primary = primary
  }

  private blank(playerId: number): Memory {
    const tiles = this.game.world.width * this.game.world.height
    void playerId
    return {
      explored: new Uint8Array(tiles),
      visible: new Uint8Array(tiles),
      seen: new Set(),
      route: new Map(),
      motionTick: new Map(),
      health: new Map(),
      progress: new Map(),
      citySig: new Map(),
      credits: null,
      training: null,
      rally: null,
      primary: null,
      terrainSent: new Uint8Array(tiles).fill(UNSET),
      lastSnapshotTick: -SNAPSHOT_COOLDOWN,
      lastSentTick: this.tickNo,
    }
  }

  private reveal(memory: Memory, units: readonly UnitSnapshot[]): TileCoord[] {
    const { width, height } = this.game.world
    const before = memory.explored.slice()
    const playerId = this.ownerOf(memory)
    const friends = friendsOf(units, playerId, this.game.citySights())
    const revealed = new Uint8Array(memory.explored.length)
    stampSight(width, height, friends, revealed, memory.visible)
    for (const unit of units) {
      if (unit.ownerId !== playerId || unit.health <= 0) continue
      const footprint = UNIT_TYPES[unit.typeId].footprint
      for (let dy = 0; dy < footprint; dy++) {
        for (let dx = 0; dx < footprint; dx++) {
          const x = unit.tileX + dx
          const y = unit.tileY + dy
          if (x < 0 || y < 0 || x >= width || y >= height) continue
          const index = y * width + x
          revealed[index] = 1
          memory.visible[index] = 1
        }
      }
    }
    growExplored(revealed, width, height)
    for (let i = 0; i < revealed.length; i++) if (revealed[i] === 1) memory.explored[i] = 1
    const fresh: TileCoord[] = []
    for (let i = 0; i < memory.explored.length; i++) {
      if (memory.explored[i] === 1 && before[i] === 0) fresh.push({ x: i % width, y: Math.floor(i / width) })
    }
    return fresh
  }

  private ownerOf(memory: Memory): number {
    for (const [session, known] of this.memory) {
      if (known === memory) return session.playerId
    }
    return 0
  }

  private knows(memory: Memory, unit: UnitSnapshot, width: number): boolean {
    if (unit.ownerId === this.ownerOf(memory)) return true
    const index = unit.tileY * width + unit.tileX
    return index >= 0 && index < memory.visible.length && memory.visible[index] === 1
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
    return memory.visible[ty * width + tx] === 1
  }

  private visibleCities(memory: Memory): CityRecord[] {
    const records: CityRecord[] = []
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

  private changedCities(memory: Memory): CityRecord[] {
    const next = this.visibleCities(memory)
    const changed: CityRecord[] = []
    const live = new Set<number>()
    for (const city of next) {
      live.add(city.index)
      const key = cityKey(city)
      if (memory.citySig.get(city.index) === key) continue
      memory.citySig.set(city.index, key)
      changed.push(city)
    }
    for (const index of [...memory.citySig.keys()]) {
      if (live.has(index)) continue
      memory.citySig.delete(index)
    }
    return changed
  }

  private mapOf(memory: Memory): MapData {
    const { width, height } = this.game.world
    const cells = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x
        if (memory.explored[index] !== 1) continue
        const terrain = this.game.world.terrainAt(x, y)
        cells.push({ x, y, terrain, shift: this.game.world.shiftAt(x, y) })
        memory.terrainSent[index] = terrain
      }
    }
    const scenery = this.game.scenery
    return {
      width,
      height,
      cells,
      coast: [],
      holes: [],
      roads: [],
      towns: scenery.towns.filter((point) => this.pointVisible(memory, point.x, point.y, width, height)),
      cleared: this.game.clearedTiles().filter((tile) => memory.explored[tile.y * width + tile.x] === 1),
    }
  }

  private changedMap(memory: Memory, fresh: readonly TileCoord[]): MapData | null {
    const { width, height } = this.game.world
    const wanted = new Set(fresh.map((tile) => `${tile.x},${tile.y}`))
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x
        if (memory.explored[index] !== 1) continue
        const terrain = this.game.world.terrainAt(x, y)
        if (memory.terrainSent[index] !== terrain) wanted.add(`${x},${y}`)
      }
    }
    if (wanted.size === 0) return null
    const cells = []
    for (const key of wanted) {
      const [x, y] = key.split(',').map(Number)
      const terrain = this.game.world.terrainAt(x, y)
      cells.push({ x, y, terrain, shift: this.game.world.shiftAt(x, y) })
      memory.terrainSent[y * width + x] = terrain
    }
    const scenery = this.game.scenery
    return {
      width,
      height,
      cells,
      coast: [],
      holes: [],
      roads: [],
      towns: scenery.towns.filter((point) => wanted.has(`${Math.floor(point.x)},${Math.floor(point.y)}`)),
      cleared: this.game.clearedTiles().filter((tile) => wanted.has(`${tile.x},${tile.y}`)),
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

function cityKey(city: CityRecord): string {
  const ruins = city.state.ruins.map((tile) => `${tile.x},${tile.y}`).join('.')
  const sites = city.state.sites.map((site) => `${site.at}:${site.x},${site.y},${site.model},${site.yaw}`).join(';')
  const buildings = city.layout.buildings.map((building) => `${building.x},${building.y},${building.model}`).join(';')
  return `${city.state.ownerId}:${city.state.progress.toFixed(3)}:${city.state.challengerId}:${city.state.grown}:${ruins}:${sites}:${buildings}`
}
