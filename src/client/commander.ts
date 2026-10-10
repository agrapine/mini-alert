import type { ClientPort } from '../shared/protocol.ts'
import { ClientMessageKind } from '../shared/protocol.ts'
import type { TileCoord } from '../shared/tiles.ts'
import type { UnitTypeId } from '../shared/unit-types.ts'
import type { UnitSnapshot } from '../shared/protocol.ts'
import type { Replica } from './replica.ts'

export class Commander {
  private selectedIds: number[] = []
  private readonly replica: Replica
  private readonly port: ClientPort

  constructor(replica: Replica, port: ClientPort) {
    this.replica = replica
    this.port = port
  }

  select(id: number | null) {
    if (id === null) {
      this.selectedIds = []
      return
    }
    const unit = this.replica.unit(id)
    if (!unit || unit.ownerId !== this.replica.playerId) return
    this.selectedIds = [id]
  }

  selectIds(ids: readonly number[]) {
    const own: number[] = []
    for (const id of ids) {
      const unit = this.replica.unit(id)
      if (!unit || unit.ownerId !== this.replica.playerId || own.includes(id)) continue
      own.push(id)
    }
    this.selectedIds = own
  }

  selected(): UnitSnapshot[] {
    const units: UnitSnapshot[] = []
    for (const id of this.selectedIds) {
      const unit = this.replica.unit(id)
      if (!unit || unit.ownerId !== this.replica.playerId) continue
      units.push(unit)
    }
    return units
  }

  orderMove(tile: TileCoord) {
    for (const unit of this.selected()) {
      this.port.send({
        kind: ClientMessageKind.OrderMove,
        unitId: unit.id,
        tile,
      })
    }
  }

  spawn(typeId: UnitTypeId) {
    this.port.send({ kind: ClientMessageKind.Spawn, typeId })
  }
}
