import type { ClientPort } from '../shared/protocol.ts'
import { ClientMessageKind } from '../shared/protocol.ts'
import type { TileCoord } from '../shared/tiles.ts'
import { UNIT_TYPES, UnitTypeId } from '../shared/unit-types.ts'
import type { UnitSnapshot } from '../shared/protocol.ts'
import type { Replica } from './replica.ts'

export class Commander {
  private selectedIds: number[] = []
  private placing: UnitTypeId | null = null
  private raising = false
  private aim: TileCoord | null = null
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
    this.raising = false
    this.aim = null
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
    if (!unit || unit.ownerId !== this.replica.playerId) return
    const mobile = UNIT_TYPES[unit.typeId].topSpeed > 0
    if (!mobile && unit.typeId !== UnitTypeId.Factory) return
    if (this.selectedIds.length === 1 && this.selectedIds[0] === id && unit.typeId === UnitTypeId.Factory) {
      this.port.send({ kind: ClientMessageKind.SetPrimary, unitId: id })
      return
    }
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

  commanding(): boolean {
    return this.selected().some((unit) => UNIT_TYPES[unit.typeId].topSpeed > 0)
  }

  factorySelected(): boolean {
    const units = this.selected()
    return units.length === 1 && units[0].typeId === UnitTypeId.Factory
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

  setRally(tile: TileCoord) {
    if (this.spectating || !this.factorySelected()) return
    this.port.send({ kind: ClientMessageKind.SetRally, tile })
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

  orderAttackGround(tile: TileCoord) {
    if (this.spectating) return
    for (const unit of this.selected()) {
      this.port.send({
        kind: ClientMessageKind.OrderAttackGround,
        unitId: unit.id,
        tile,
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

  raisingCity(): boolean {
    return this.raising
  }

  aimedTile(): TileCoord | null {
    return this.aim
  }

  setAim(tile: TileCoord | null) {
    this.aim = tile
  }

  armBuilding(typeId: UnitTypeId) {
    if (this.spectating) return
    this.raising = false
    this.aim = null
    this.placing = this.placing === typeId ? null : typeId
  }

  armCity() {
    if (this.spectating) return
    this.placing = null
    this.raising = !this.raising
    if (!this.raising) this.aim = null
  }

  cancelPlace() {
    this.placing = null
    this.raising = false
    this.aim = null
  }

  placeBuilding(tile: TileCoord) {
    if (this.spectating || this.placing === null) return
    this.port.send({ kind: ClientMessageKind.PlaceBuilding, typeId: this.placing, tile })
    this.placing = null
  }

  placeCity(tile: TileCoord) {
    if (this.spectating || !this.raising) return
    this.port.send({ kind: ClientMessageKind.PlaceCity, tile })
    this.raising = false
    this.aim = null
  }
}
