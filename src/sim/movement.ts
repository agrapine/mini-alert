import { tileCenter, type GridMap, type TileCoord } from '../map/grid.ts'
import type { UnitType } from '../units/types.ts'
import type { Unit } from '../units/unit.ts'

export function stepUnit(unit: Unit, map: GridMap, dt: number, type: UnitType) {
  let remaining = type.speed * dt

  while (remaining > 0 && unit.path.length > 0) {
    const next = unit.path[0]
    if (!map.isWalkable(next.x, next.y, unit.id)) {
      unit.path = []
      return
    }

    const target = tileCenter(next)
    const dx = target.x - unit.pos.x
    const dz = target.z - unit.pos.z
    const dist = Math.hypot(dx, dz)

    if (dist <= 1e-6) {
      claimTile(map, unit, next, type.footprint)
      unit.path.shift()
      continue
    }

    unit.facing = Math.atan2(dx, dz)
    if (remaining >= dist) {
      unit.pos.x = target.x
      unit.pos.z = target.z
      remaining -= dist
      claimTile(map, unit, next, type.footprint)
      unit.path.shift()
    } else {
      unit.pos.x += (dx / dist) * remaining
      unit.pos.z += (dz / dist) * remaining
      remaining = 0
      const entered = { x: Math.floor(unit.pos.x), y: Math.floor(unit.pos.z) }
      if (
        (entered.x !== unit.tile.x || entered.y !== unit.tile.y) &&
        map.isWalkable(entered.x, entered.y, unit.id)
      ) {
        claimTile(map, unit, entered, type.footprint)
      }
    }
  }
}

function claimTile(map: GridMap, unit: Unit, tile: TileCoord, footprint: number) {
  if (unit.tile.x === tile.x && unit.tile.y === tile.y) return
  clearFootprint(map, unit.tile, footprint, unit.id)
  fillFootprint(map, tile, footprint, unit.id)
  unit.tile = { x: tile.x, y: tile.y }
}

function clearFootprint(map: GridMap, origin: TileCoord, footprint: number, unitId: number) {
  for (let dy = 0; dy < footprint; dy++) {
    for (let dx = 0; dx < footprint; dx++) {
      const x = origin.x + dx
      const y = origin.y + dy
      if (!map.inBounds(x, y)) continue
      if (map.get(x, y).occupantId === unitId) map.setOccupant(x, y, null)
    }
  }
}

function fillFootprint(map: GridMap, origin: TileCoord, footprint: number, unitId: number) {
  for (let dy = 0; dy < footprint; dy++) {
    for (let dx = 0; dx < footprint; dx++) {
      map.setOccupant(origin.x + dx, origin.y + dy, unitId)
    }
  }
}
