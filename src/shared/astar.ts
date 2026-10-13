import type { TileCoord } from './tiles.ts'

export const enum Cell {
  Blocked = 0,
  Open = 1,
  /** A movable unit stands here: passable at a higher cost, but never a goal or a corner to cut. */
  Crowded = 2,
}

export type PathGrid = {
  readonly width: number
  readonly height: number
  cell(x: number, y: number): Cell
}

const CROWD_COST = 3

const DX = [1, -1, 0, 0, 1, 1, -1, -1]
const DY = [0, 0, 1, -1, 1, -1, 1, -1]
const COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2]

let seen = new Uint32Array(0)
let gScore = new Float64Array(0)
let came = new Int32Array(0)
let generation = 0
let heapNode = new Int32Array(64)
let heapF = new Float64Array(64)
let heapG = new Float64Array(64)
let heapSize = 0

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx)
  const dy = Math.abs(ay - by)
  const min = dx < dy ? dx : dy
  const max = dx < dy ? dy : dx
  return max + (Math.SQRT2 - 1) * min
}

/** Path from start to goal, excluding start. Null when the goal cannot be reached. */
export function findPath(grid: PathGrid, start: TileCoord, goal: TileCoord): TileCoord[] | null {
  const { width, height } = grid
  if (start.x < 0 || start.y < 0 || start.x >= width || start.y >= height) return null
  if (goal.x < 0 || goal.y < 0 || goal.x >= width || goal.y >= height) return null
  if (start.x === goal.x && start.y === goal.y) return []
  if (grid.cell(goal.x, goal.y) !== Cell.Open) return null

  prepare(width * height)
  const startKey = start.y * width + start.x
  const goalKey = goal.y * width + goal.x
  visit(startKey, 0, -1)
  heapSize = 0
  push(startKey, octile(start.x, start.y, goal.x, goal.y), 0)

  while (heapSize > 0) {
    const current = heapNode[0]
    const currentG = heapG[0]
    pop()
    if (gScore[current] !== currentG) continue
    if (current === goalKey) return reconstruct(width, startKey, goalKey)
    const cx = current % width
    const cy = (current - cx) / width
    for (let dir = 0; dir < 8; dir++) {
      const nx = cx + DX[dir]
      const ny = cy + DY[dir]
      const kind = grid.cell(nx, ny)
      if (kind === Cell.Blocked) continue
      if (dir >= 4 && (grid.cell(nx, cy) !== Cell.Open || grid.cell(cx, ny) !== Cell.Open)) continue
      const next = ny * width + nx
      const nextG = currentG + COST[dir] * (kind === Cell.Crowded ? CROWD_COST : 1)
      if (seen[next] === generation && nextG >= gScore[next]) continue
      visit(next, nextG, current)
      push(next, nextG + octile(nx, ny, goal.x, goal.y), nextG)
    }
  }

  return null
}

function prepare(size: number) {
  if (seen.length < size) {
    seen = new Uint32Array(size)
    gScore = new Float64Array(size)
    came = new Int32Array(size)
    generation = 0
  }
  generation += 1
  if (generation === 0xffffffff) {
    seen.fill(0)
    generation = 1
  }
}

function visit(node: number, g: number, from: number) {
  seen[node] = generation
  gScore[node] = g
  came[node] = from
}

function reconstruct(width: number, startKey: number, goalKey: number): TileCoord[] {
  const path: TileCoord[] = []
  for (let cursor = goalKey; cursor !== startKey; cursor = came[cursor]) {
    const x = cursor % width
    path.push({ x, y: (cursor - x) / width })
  }
  path.reverse()
  return path
}

function before(a: number, b: number): boolean {
  return heapF[a] < heapF[b] || (heapF[a] === heapF[b] && heapG[a] > heapG[b])
}

function swap(a: number, b: number) {
  const node = heapNode[a]
  const f = heapF[a]
  const g = heapG[a]
  heapNode[a] = heapNode[b]
  heapF[a] = heapF[b]
  heapG[a] = heapG[b]
  heapNode[b] = node
  heapF[b] = f
  heapG[b] = g
}

function push(node: number, f: number, g: number) {
  if (heapSize === heapNode.length) {
    const nodes = new Int32Array(heapSize * 2)
    const fs = new Float64Array(heapSize * 2)
    const gs = new Float64Array(heapSize * 2)
    nodes.set(heapNode)
    fs.set(heapF)
    gs.set(heapG)
    heapNode = nodes
    heapF = fs
    heapG = gs
  }
  let index = heapSize++
  heapNode[index] = node
  heapF[index] = f
  heapG[index] = g
  while (index > 0) {
    const parent = (index - 1) >> 1
    if (!before(index, parent)) break
    swap(index, parent)
    index = parent
  }
}

function pop() {
  heapSize -= 1
  if (heapSize === 0) return
  heapNode[0] = heapNode[heapSize]
  heapF[0] = heapF[heapSize]
  heapG[0] = heapG[heapSize]
  let index = 0
  for (;;) {
    const left = index * 2 + 1
    if (left >= heapSize) break
    const right = left + 1
    const child = right < heapSize && before(right, left) ? right : left
    if (!before(child, index)) break
    swap(index, child)
    index = child
  }
}
