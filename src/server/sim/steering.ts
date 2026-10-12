import type { TileCoord } from '../../shared/tiles.ts'
import type { PathFinder } from '../path/pathfinder.ts'
import type { Unit } from '../units/unit.ts'

export function redirect(unit: Unit, paths: PathFinder, units: readonly Unit[]): boolean {
  const goal = unit.path[unit.path.length - 1]
  if (!goal) return false
  if (!paths.isWalkable(goal.x, goal.y, unit.id)) {
    const blocker = occupant(paths, goal, units, unit.id)
    if (!blocker || blocker.path.length === 0) unit.commitPath([])
    return false
  }

  const next = unit.path[0]
  const other = occupant(paths, next, units, unit.id)
  if (other && isHeadOn(unit, other)) {
    const passed = passPath(unit, other, paths, goal)
    if (passed && paths.isWalkable(passed[0].x, passed[0].y, unit.id)) {
      unit.commitPath(passed)
      return true
    }
  } else if (other && other.path.length > 0) {
    return false
  }

  if (other && isIdle(other) && shove(other, unit, paths)) return false

  const reroute = paths.findPath(unit.tile, goal, unit.id)
  if (reroute === null || reroute.length === 0) return false
  if (!paths.isPassable(reroute[0].x, reroute[0].y, unit.id)) return false
  if (reroute[0].x === next.x && reroute[0].y === next.y) return false
  unit.commitPath(reroute)
  return true
}

function passPath(unit: Unit, other: Unit, paths: PathFinder, goal: TileCoord): TileCoord[] | null {
  const dx = Math.sign(other.tile.x - unit.tile.x)
  const dy = Math.sign(other.tile.y - unit.tile.y)
  if (dx === 0 && dy === 0) return null
  const sides = [
    { x: unit.tile.x - dy, y: unit.tile.y + dx },
    { x: unit.tile.x + dy, y: unit.tile.y - dx },
  ]
  for (const side of sides) {
    if (!paths.isWalkable(side.x, side.y, unit.id)) continue
    if (side.x === goal.x && side.y === goal.y) return [side]
    const rest = paths.findPath(side, goal, unit.id)
    if (rest === null) continue
    return [side, ...rest]
  }
  return null
}

function isHeadOn(unit: Unit, other: Unit): boolean {
  const theirNext = other.path[0]
  return theirNext !== undefined && theirNext.x === unit.tile.x && theirNext.y === unit.tile.y
}

function isIdle(unit: Unit): boolean {
  return unit.path.length === 0 && unit.attackId === null && unit.attackPoint === null
}

function shove(blocker: Unit, mover: Unit, paths: PathFinder): boolean {
  if (blocker.ownerId !== mover.ownerId || blocker.type.topSpeed <= 0) return false
  const reserved = new Set<string>()
  reserved.add(tileKey(mover.tile))
  for (const step of mover.path) reserved.add(tileKey(step))
  const around = [
    { x: blocker.tile.x + 1, y: blocker.tile.y },
    { x: blocker.tile.x - 1, y: blocker.tile.y },
    { x: blocker.tile.x, y: blocker.tile.y + 1 },
    { x: blocker.tile.x, y: blocker.tile.y - 1 },
    { x: blocker.tile.x + 1, y: blocker.tile.y + 1 },
    { x: blocker.tile.x + 1, y: blocker.tile.y - 1 },
    { x: blocker.tile.x - 1, y: blocker.tile.y + 1 },
    { x: blocker.tile.x - 1, y: blocker.tile.y - 1 },
  ]
  const open = around.filter((tile) => paths.isWalkable(tile.x, tile.y, blocker.id))
  open.sort((a, b) => Number(reserved.has(tileKey(a))) - Number(reserved.has(tileKey(b))))
  for (const tile of open) {
    if (blocker.orderMove(tile, paths)) return true
  }
  return false
}

function tileKey(tile: TileCoord): string {
  return `${tile.x},${tile.y}`
}

function occupant(
  paths: PathFinder,
  tile: TileCoord,
  units: readonly Unit[],
  selfId: number,
): Unit | undefined {
  if (!paths.inBounds(tile.x, tile.y)) return undefined
  const id = paths.occupant(tile.x, tile.y)
  if (id == null || id === selfId) return undefined
  return units.find((candidate) => candidate.id === id)
}
