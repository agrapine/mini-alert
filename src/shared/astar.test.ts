import { describe, expect, it } from 'vitest'
import { Cell, descend, distanceField, findPath, type PathGrid } from './astar.ts'
import type { TileCoord } from './tiles.ts'

const STEPS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const

function randomGrid(seed: number, size: number): PathGrid {
  let state = seed
  const cells: Cell[] = []
  for (let i = 0; i < size * size; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    const roll = state % 10
    cells.push(roll < 2 ? Cell.Blocked : roll < 3 ? Cell.Crowded : Cell.Open)
  }
  return {
    width: size,
    height: size,
    cell: (x, y) => (x < 0 || y < 0 || x >= size || y >= size ? Cell.Blocked : cells[y * size + x]),
  }
}

function moveCost(grid: PathGrid, from: TileCoord, to: TileCoord, crowds = true): number | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return null
  const kind = grid.cell(to.x, to.y)
  if (kind === Cell.Blocked) return null
  const corner = (x: number, y: number) => (crowds ? grid.cell(x, y) === Cell.Open : grid.cell(x, y) !== Cell.Blocked)
  if (dx !== 0 && dy !== 0 && (!corner(to.x, from.y) || !corner(from.x, to.y))) return null
  return (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1) * (crowds && kind === Cell.Crowded ? 3 : 1)
}

function cheapest(grid: PathGrid, start: TileCoord, goal: TileCoord, crowds = true): number | null {
  const dist = new Map<number, number>([[start.y * grid.width + start.x, 0]])
  const done = new Set<number>()
  for (;;) {
    let best = -1
    let bestCost = Infinity
    for (const [key, cost] of dist) {
      if (!done.has(key) && cost < bestCost) {
        best = key
        bestCost = cost
      }
    }
    if (best < 0) return null
    done.add(best)
    const x = best % grid.width
    const y = (best - x) / grid.width
    if (x === goal.x && y === goal.y) return bestCost
    for (const [dx, dy] of STEPS) {
      const step = moveCost(grid, { x, y }, { x: x + dx, y: y + dy }, crowds)
      if (step === null) continue
      const key = (y + dy) * grid.width + x + dx
      if (bestCost + step < (dist.get(key) ?? Infinity)) dist.set(key, bestCost + step)
    }
  }
}

describe('findPath', () => {
  it('returns a legal path as cheap as an exhaustive search', () => {
    let compared = 0
    for (let seed = 1; seed <= 60; seed++) {
      const grid = randomGrid(seed, 14)
      const start = { x: 0, y: seed % 14 }
      const goal = { x: 13, y: (seed * 5) % 14 }
      const path = findPath(grid, start, goal)
      const expected = grid.cell(goal.x, goal.y) === Cell.Open ? cheapest(grid, start, goal) : null
      if (expected === null) {
        expect(path).toBeNull()
        continue
      }
      expect(path).not.toBeNull()
      let cost = 0
      let at = start
      for (const tile of path ?? []) {
        const step = moveCost(grid, at, tile)
        expect(step).not.toBeNull()
        cost += step ?? 0
        at = tile
      }
      expect(at).toEqual(goal)
      expect(cost).toBeCloseTo(expected, 9)
      compared += 1
    }
    expect(compared).toBeGreaterThan(20)
  })

  it('descends a distance field along a cheapest route to the nearest source', () => {
    let compared = 0
    for (let seed = 1; seed <= 40; seed++) {
      const grid = randomGrid(seed, 14)
      const sources = [{ x: 13, y: seed % 14 }, { x: 12, y: (seed * 3) % 14 }].filter((tile) => grid.cell(tile.x, tile.y) !== Cell.Blocked)
      const start = { x: 0, y: (seed * 7) % 14 }
      if (sources.length === 0 || grid.cell(start.x, start.y) === Cell.Blocked) continue
      const path = descend(grid, distanceField(grid, sources, [start]), start)
      const costs = sources.map((source) => cheapest(grid, start, source, false)).filter((cost) => cost !== null)
      if (costs.length === 0) {
        expect(path).toBeNull()
        continue
      }
      let cost = 0
      let at = start
      for (const tile of path ?? []) {
        cost += moveCost(grid, at, tile, false) ?? Infinity
        at = tile
      }
      expect(sources).toContainEqual(at)
      expect(cost).toBeCloseTo(Math.min(...costs), 9)
      compared += 1
    }
    expect(compared).toBeGreaterThan(15)
  })
})
