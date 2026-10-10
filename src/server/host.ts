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
    session.send({ kind: ServerMessageKind.Units, units: this.game.unitSnapshots() })
  }

  tick(dt: number) {
    this.ai.update(dt)
    this.game.tick(dt)
    const units = { kind: ServerMessageKind.Units, units: this.game.unitSnapshots() } as const
    for (const session of this.sessions) session.send(units)
  }

  private onCommand(playerId: number, message: ClientMessage) {
    if (message.kind === ClientMessageKind.OrderMove) {
      this.game.orderMove(playerId, message.unitId, message.tile)
    }
  }

  private worldSnapshot(): WorldSnapshot {
    const { width, height } = this.game.world
    const terrain: Terrain[] = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) terrain.push(this.game.world.terrainAt(x, y))
    }
    return { kind: ServerMessageKind.World, width, height, terrain }
  }
}
