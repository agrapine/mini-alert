import type { ClientPort } from '../shared/protocol.ts'
import { ClientMessageKind } from '../shared/protocol.ts'
import type { TileCoord } from '../shared/tiles.ts'
import type { UnitSnapshot } from '../shared/protocol.ts'
import type { Replica } from './replica.ts'

export class Commander {
  selectedId: number | null = null
  private readonly replica: Replica
  private readonly port: ClientPort

  constructor(replica: Replica, port: ClientPort) {
    this.replica = replica
    this.port = port
  }

  select(id: number | null) {
    if (id === null) {
      this.selectedId = null
      return
    }
    const unit = this.replica.unit(id)
    if (!unit || unit.ownerId !== this.replica.playerId) return
    this.selectedId = id
  }

  selected(): UnitSnapshot | null {
    if (this.selectedId === null) return null
    const unit = this.replica.unit(this.selectedId)
    if (!unit || unit.ownerId !== this.replica.playerId) return null
    return unit
  }

  orderMove(tile: TileCoord) {
    if (this.selectedId === null) return
    this.port.send({
      kind: ClientMessageKind.OrderMove,
      unitId: this.selectedId,
      tile,
    })
  }
}
