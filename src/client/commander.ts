import type { ClientPort } from '../shared/protocol.ts'
import { ClientMessageKind } from '../shared/protocol.ts'
import type { TileCoord } from '../shared/tiles.ts'
import { UNIT_TYPES, type UnitTypeId } from '../shared/unit-types.ts'
import type { UnitSnapshot } from '../shared/protocol.ts'
import type { Replica } from './replica.ts'

export class Commander {
  private selectedIds: number[] = []
  private placing: UnitTypeId | null = null
  private spectating = false
  private readonly replica: Replica
  private readonly port: ClientPort

  constructor(replica: Replica, port: ClientPort) {
    this.replica = replica
    this.port = port
  }

  setSpectating(on: boolean) {
    this.spectating = on
    if (!on) return
    this.selectedIds = []
    this.placing = null
  }

  select(id: number | null) {
    if (this.spectating) {
      this.selectedIds = []
      return
    }
    if (id === null) {
      this.selectedIds = []
      return
    }
    const unit = this.replica.unit(id)
    if (!unit || unit.ownerId !== this.replica.playerId || UNIT_TYPES[unit.typeId].topSpeed <= 0) return
    this.selectedIds = [id]
  }

  selectIds(ids: readonly number[]) {
    const own: number[] = []
    for (const id of ids) {
      const unit = this.replica.unit(id)
      if (!unit || unit.ownerId !== this.replica.playerId || UNIT_TYPES[unit.typeId].topSpeed <= 0 || own.includes(id)) continue
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
    if (this.spectating) return
    for (const unit of this.selected()) {
      this.port.send({
        kind: ClientMessageKind.OrderMove,
        unitId: unit.id,
        tile,
      })
    }
  }

  orderAttack(targetId: number) {
    if (this.spectating) return
    for (const unit of this.selected()) {
      this.port.send({
        kind: ClientMessageKind.OrderAttack,
        unitId: unit.id,
        targetId,
      })
    }
  }

  spawn(typeId: UnitTypeId) {
    if (this.spectating) return
    this.port.send({ kind: ClientMessageKind.Spawn, typeId })
  }

  cancelSpawn(typeId: UnitTypeId) {
    if (this.spectating) return
    this.port.send({ kind: ClientMessageKind.CancelSpawn, typeId })
  }

  placingType(): UnitTypeId | null {
    return this.placing
  }

  armBuilding(typeId: UnitTypeId) {
    if (this.spectating) return
    this.placing = this.placing === typeId ? null : typeId
  }

  cancelPlace() {
    this.placing = null
  }

  placeBuilding(tile: TileCoord) {
    if (this.spectating || this.placing === null) return
    this.port.send({ kind: ClientMessageKind.PlaceBuilding, typeId: this.placing, tile })
    this.placing = null
  }
}
