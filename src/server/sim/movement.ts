import { tileCenter } from '../../shared/tiles.ts'
import type { UnitType } from '../../shared/unit-types.ts'
import type { PathFinder } from '../path/pathfinder.ts'
import type { Unit } from '../units/unit.ts'
import { redirect } from './steering.ts'

export function stepUnit(
  unit: Unit,
  dt: number,
  type: UnitType,
  paths: PathFinder,
  units: readonly Unit[],
) {
  let remaining = type.speed * dt
  let redirects = 0

  while (remaining > 0 && unit.path.length > 0) {
    const next = unit.path[0]
    if (!paths.isWalkable(next.x, next.y, unit.id)) {
      if (redirects++ > 3 || !redirect(unit, paths, units)) return
      continue
    }

    const target = tileCenter(next)
    const dx = target.x - unit.pos.x
    const dz = target.z - unit.pos.z
    const dist = Math.hypot(dx, dz)

    if (dist <= 1e-6) {
      if (!paths.claim(unit, next, type.footprint)) {
        if (redirects++ > 3 || !redirect(unit, paths, units)) return
        continue
      }
      unit.path.shift()
      continue
    }

    unit.facing = Math.atan2(dx, dz)
    if (remaining >= dist) {
      if (!paths.claim(unit, next, type.footprint)) {
        if (redirects++ > 3 || !redirect(unit, paths, units)) return
        continue
      }
      unit.pos.x = target.x
      unit.pos.z = target.z
      remaining -= dist
      unit.path.shift()
    } else {
      const nx = unit.pos.x + (dx / dist) * remaining
      const nz = unit.pos.z + (dz / dist) * remaining
      const entered = { x: Math.floor(nx), y: Math.floor(nz) }
      const changing = entered.x !== unit.tile.x || entered.y !== unit.tile.y
      if (changing && !paths.claim(unit, entered, type.footprint)) {
        if (redirects++ > 3 || !redirect(unit, paths, units)) return
        continue
      }
      unit.pos.x = nx
      unit.pos.z = nz
      remaining = 0
    }
  }
}
