import type { TileCoord } from '../../shared/tiles.ts'

export type PathGrid = {
  readonly width: number
  inBounds(x: number, y: number): boolean
  isWalkable(x: number, y: number, ignoreUnitId: number): boolean
  isPassable(x: number, y: number, ignoreUnitId: number): boolean
  stepCost(x: number, y: number, ignoreUnitId: number): number
}

const DIRS = [
  { x: 1, y: 0, cost: 1 },
  { x: -1, y: 0, cost: 1 },
  { x: 0, y: 1, cost: 1 },
  { x: 0, y: -1, cost: 1 },
  { x: 1, y: 1, cost: Math.SQRT2 },
  { x: 1, y: -1, cost: Math.SQRT2 },
  { x: -1, y: 1, cost: Math.SQRT2 },
  { x: -1, y: -1, cost: Math.SQRT2 },
] as const

type OpenNode = { x: number; y: number; g: number; f: number }

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx)
  const dy = Math.abs(ay - by)
  const min = dx < dy ? dx : dy
  const max = dx < dy ? dy : dx
  return max + (Math.SQRT2 - 1) * min
}

function key(x: number, y: number, width: number): number {
  return y * width + x
}

/** Path from start to goal, excluding start. Null when the goal cannot be reached. */
export function findPath(
  grid: PathGrid,
  start: TileCoord,
  goal: TileCoord,
  ignoreUnitId: number,
): TileCoord[] | null {
  if (!grid.inBounds(start.x, start.y) || !grid.inBounds(goal.x, goal.y)) return null
  if (start.x === goal.x && start.y === goal.y) return []
  if (!grid.isWalkable(goal.x, goal.y, ignoreUnitId)) return null

  const width = grid.width
  const startKey = key(start.x, start.y, width)
  const goalKey = key(goal.x, goal.y, width)
  const gScore = new Map<number, number>([[startKey, 0]])
  const came = new Map<number, number>()
  const open: OpenNode[] = [
    { x: start.x, y: start.y, g: 0, f: octile(start.x, start.y, goal.x, goal.y) },
  ]

  while (open.length > 0) {
    let best = 0
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[best].f) best = i
    }
    const current = open.splice(best, 1)[0]
    const currentKey = key(current.x, current.y, width)
    if (gScore.get(currentKey) !== current.g) continue
    if (currentKey === goalKey) return reconstruct(came, width, startKey, goal)

    for (const dir of DIRS) {
      const nx = current.x + dir.x
      const ny = current.y + dir.y
      if (!grid.isPassable(nx, ny, ignoreUnitId)) continue
      if (dir.x !== 0 && dir.y !== 0) {
        if (!grid.isWalkable(current.x + dir.x, current.y, ignoreUnitId)) continue
        if (!grid.isWalkable(current.x, current.y + dir.y, ignoreUnitId)) continue
      }

      const nextKey = key(nx, ny, width)
      const nextG = current.g + dir.cost * grid.stepCost(nx, ny, ignoreUnitId)
      const previous = gScore.get(nextKey)
      if (previous !== undefined && nextG >= previous) continue
      gScore.set(nextKey, nextG)
      came.set(nextKey, currentKey)
      open.push({
        x: nx,
        y: ny,
        g: nextG,
        f: nextG + octile(nx, ny, goal.x, goal.y),
      })
    }
  }

  return null
}

function reconstruct(
  came: Map<number, number>,
  width: number,
  startKey: number,
  goal: TileCoord,
): TileCoord[] | null {
  const path: TileCoord[] = []
  let cursor = key(goal.x, goal.y, width)
  while (cursor !== startKey) {
    const x = cursor % width
    const y = (cursor - x) / width
    path.push({ x, y })
    const previous = came.get(cursor)
    if (previous === undefined) return null
    cursor = previous
  }
  path.reverse()
  return path
}
