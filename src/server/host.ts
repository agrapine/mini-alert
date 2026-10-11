import { createLocalLink } from '../shared/local-link.ts'
import {
  ClientMessageKind,
  ServerMessageKind,
  type ClientMessage,
  type ClientPort,
  type MapPoint,
  type ServerMessage,
  type WorldSnapshot,
} from '../shared/protocol.ts'
import { type Terrain } from '../shared/tiles.ts'
import { shotsForPlayer, unitsForPlayer } from '../shared/vision.ts'
import type { AiPlayer } from '../ai/player.ts'
import type { Game } from './game.ts'
import type { Player } from './player.ts'

type Session = {
  playerId: number
  playing: boolean
  send(message: ServerMessage): void
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
  private readonly sessions: Session[] = []
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

  attach(playerId: number, playing: boolean, send: (message: ServerMessage) => void): RemotePlay {
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
        this.pushWelcome(session)
        this.pushUnits(session)
      },
      sync: () => this.pushSync(session),
      close: () => {
        const index = this.sessions.indexOf(session)
        if (index >= 0) this.sessions.splice(index, 1)
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
    const yields = this.game.takeYields()
    const sights = this.game.citySights()
    const living = this.game.unitSnapshots()
    const deaths = this.game.takeDeaths()
    const all = deaths.length > 0 ? living.concat(deaths) : living
    for (const session of this.sessions) {
      const units = unitsForPlayer(all, session.playerId, sights)
      session.send(this.unitsMessage(session, units, yields))
      const seen = shotsForPlayer(shots, living, session.playerId, sights)
      if (seen.length > 0) session.send({ kind: ServerMessageKind.Shots, shots: seen })
    }
  }

  private onCommand(session: Session, message: ClientMessage) {
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
    this.pushWelcome(session)
    session.send(this.worldSnapshot())
    this.pushUnits(session)
  }

  private pushWelcome(session: Session) {
    session.send({ kind: ServerMessageKind.Welcome, playerId: session.playerId })
  }

  private pushUnits(session: Session) {
    const units = unitsForPlayer(this.game.unitSnapshots(), session.playerId, this.game.citySights())
    session.send(this.unitsMessage(session, units))
  }

  private unitsMessage(session: Session, units: ReturnType<Game['unitSnapshots']>, yields: MapPoint[] = []) {
    return {
      kind: ServerMessageKind.Units as const,
      units,
      credits: this.creditsFor(session.playerId),
      training: this.game.trainingFor(session.playerId),
      cities: this.game.cityStates(),
      cleared: this.game.clearedTiles(),
      yields,
      primaryFactoryId: this.game.primaryFactory(session.playerId),
      rally: this.game.rally(session.playerId),
    }
  }

  private creditsFor(playerId: number): number {
    return this.game.player(playerId)?.credits ?? 0
  }

  private worldSnapshot(): WorldSnapshot {
    const { width, height } = this.game.world
    const terrain: Terrain[] = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) terrain.push(this.game.world.terrainAt(x, y))
    }
    const scenery = this.game.scenery
    return {
      kind: ServerMessageKind.World,
      width,
      height,
      terrain,
      coast: scenery.coast,
      holes: scenery.holes,
      roads: scenery.roads,
      towns: scenery.towns,
      seed: scenery.seed,
    }
  }
}
