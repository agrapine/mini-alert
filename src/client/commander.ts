import type { ClientPort } from '../shared/protocol.ts'
import { ClientMessageKind } from '../shared/protocol.ts'
import type { TileCoord } from '../shared/tiles.ts'
import { UNIT_TYPES, UnitTypeId } from '../shared/unit-types.ts'
import type { UnitSnapshot } from '../shared/protocol.ts'
import type { Replica } from './replica.ts'

const GROUP_SLOTS = 10

export class Commander {
  private selectedIds: number[] = []
  private groups: number[][] = emptyGroups()
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

  reset() {
    this.selectedIds = []
    this.groups = emptyGroups()
    this.cancelPlace()
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

  addIds(ids: readonly number[]) {
    this.selectIds([...this.selectedIds, ...ids])
  }

  toggle(id: number) {
    if (this.selectedIds.includes(id)) this.selectIds(this.selectedIds.filter((other) => other !== id))
    else this.addIds([id])
  }

  assignGroup(slot: number) {
    if (this.spectating) return
    const ids = this.selected()
      .filter((unit) => UNIT_TYPES[unit.typeId].topSpeed > 0)
      .map((unit) => unit.id)
    this.groups = this.groups.map((group) => group.filter((id) => !ids.includes(id)))
    this.groups[slot] = ids
  }

  recallGroup(slot: number, add: boolean): UnitSnapshot[] {
    const units: UnitSnapshot[] = []
    for (const id of this.groups[slot]) {
      const unit = this.replica.unit(id)
      if (unit && unit.ownerId === this.replica.playerId && unit.health > 0) units.push(unit)
    }
    this.groups[slot] = units.map((unit) => unit.id)
    if (units.length === 0) return units
    if (add) this.addIds(this.groups[slot])
    else this.selectIds(this.groups[slot])
    return units
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
    const unitIds = this.orderable()
    if (unitIds.length > 0) this.port.send({ kind: ClientMessageKind.OrderMove, unitIds, tile })
  }

  orderAttack(targetId: number) {
    const unitIds = this.orderable()
    if (unitIds.length > 0) this.port.send({ kind: ClientMessageKind.OrderAttack, unitIds, targetId })
  }

  orderAttackGround(tile: TileCoord) {
    const unitIds = this.orderable()
    if (unitIds.length > 0) this.port.send({ kind: ClientMessageKind.OrderAttackGround, unitIds, tile })
  }

  private orderable(): number[] {
    if (this.spectating) return []
    return this.selected().map((unit) => unit.id)
  }

  spawn(typeId: UnitTypeId) {
    if (this.spectating) return
    this.port.send({ kind: ClientMessageKind.Spawn, typeId })
  }

  cancelSpawn(typeId: UnitTypeId) {
    if (this.spectating) return
    this.port.send({ kind: ClientMessageKind.CancelSpawn, typeId })
  }

  cancelBuild(typeId: UnitTypeId) {
    if (this.spectating) return
    this.port.send({ kind: ClientMessageKind.CancelBuilding, typeId })
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

function emptyGroups(): number[][] {
  return Array.from({ length: GROUP_SLOTS }, () => [])
}
