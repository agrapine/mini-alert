import { createLocalLink } from '../shared/local-link.ts'
import {
  ClientMessageKind,
  ServerMessageKind,
  type ClientMessage,
  type ClientPort,
  type ServerPort,
  type WorldSnapshot,
} from '../shared/protocol.ts'
import { type Terrain } from '../shared/tiles.ts'
import { shotsForPlayer, unitsForPlayer } from '../shared/vision.ts'
import type { AiPlayer } from './ai.ts'
import type { Game } from './game.ts'
import type { Player } from './player.ts'

export class ServerHost {
  private readonly sessions: ServerPort[] = []

  constructor(
    readonly game: Game,
    private readonly ai: AiPlayer,
  ) {}

  join(player: Player): ClientPort {
    const link = createLocalLink(player.id)
    link.server.onClient((message) => this.onCommand(link.server.playerId, message))
    this.sessions.push(link.server)
    return link.client
  }

  sync(playerId: number) {
    const session = this.sessions.find((port) => port.playerId === playerId)
    if (!session) return
    session.send({ kind: ServerMessageKind.Welcome, playerId })
    session.send(this.worldSnapshot())
    session.send({
      kind: ServerMessageKind.Units,
      units: this.unitsFor(playerId),
      credits: this.creditsFor(playerId),
      training: this.game.trainingFor(playerId),
    })
  }

  tick(dt: number) {
    this.ai.update(dt)
    const shots = this.game.tick(dt)
    const living = this.game.unitSnapshots()
    const deaths = this.game.takeDeaths()
    const all = deaths.length > 0 ? living.concat(deaths) : living
    for (const session of this.sessions) {
      const units = unitsForPlayer(all, session.playerId)
      session.send({
        kind: ServerMessageKind.Units,
        units,
        credits: this.creditsFor(session.playerId),
        training: this.game.trainingFor(session.playerId),
      })
      const seen = shotsForPlayer(shots, living, session.playerId)
      if (seen.length > 0) session.send({ kind: ServerMessageKind.Shots, shots: seen })
    }
  }

  private onCommand(playerId: number, message: ClientMessage) {
    if (message.kind === ClientMessageKind.OrderMove) {
      this.game.orderMove(playerId, message.unitId, message.tile)
    } else if (message.kind === ClientMessageKind.OrderAttack) {
      this.game.orderAttack(playerId, message.unitId, message.targetId)
    } else if (message.kind === ClientMessageKind.Spawn) {
      this.game.trySpawn(playerId, message.typeId)
    } else if (message.kind === ClientMessageKind.PlaceBuilding) {
      this.game.placeBuilding(playerId, message.typeId, message.tile)
    }
  }

  private creditsFor(playerId: number): number {
    return this.game.player(playerId)?.credits ?? 0
  }

  private unitsFor(playerId: number) {
    return unitsForPlayer(this.game.unitSnapshots(), playerId)
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
