import { describe, expect, it } from 'vitest'
import type { MapPoint } from './protocol.ts'
import { blockerHoles, signedArea, smoothShore } from './shore.ts'
import { Terrain } from './tiles.ts'

describe('smooth shore', () => {
  it('rounds a stair-step blob into one ring near the mask', () => {
    const width = 18
    const height = 16
    const tiles = new Uint8Array(width * height).fill(Terrain.Water)
    for (let y = 4; y <= 11; y++) {
      for (let x = 4; x <= 12; x++) tiles[y * width + x] = Terrain.Land
    }
    tiles[7 * width + 13] = Terrain.Land
    const shore = smoothShore(tiles, width, height, 3)
    expect(shore.holes).toEqual([])
    expect(shore.coast.length).toBeGreaterThan(8)
    expect(signedArea(shore.coast)).toBeGreaterThan(0)
    expect(gap(shore.coast)).toBeLessThan(2)
    for (const point of shore.coast) expect(distanceToMask(point, tiles, width, height)).toBeLessThanOrEqual(2)
    expect(hasStairRun(shore.coast)).toBe(false)
  })

  it('keeps a lake as a clockwise hole', () => {
    const width = 20
    const height = 20
    const tiles = new Uint8Array(width * height).fill(Terrain.Water)
    for (let y = 2; y <= 17; y++) {
      for (let x = 2; x <= 17; x++) tiles[y * width + x] = Terrain.Land
    }
    for (let y = 7; y <= 12; y++) {
      for (let x = 7; x <= 12; x++) tiles[y * width + x] = Terrain.Lake
    }
    const shore = smoothShore(tiles, width, height, 5)
    expect(shore.coast.length).toBeGreaterThan(8)
    expect(signedArea(shore.coast)).toBeGreaterThan(0)
    expect(shore.holes.length).toBe(1)
    expect(signedArea(shore.holes[0])).toBeLessThan(0)
    for (const point of shore.holes[0]) expect(distanceToMask(point, tiles, width, height)).toBeLessThanOrEqual(2)
    tiles[10 * width + 13] = Terrain.Lake
    tiles[10 * width + 14] = Terrain.Lake
    const holes = blockerHoles(tiles, width, height, shore.coast, 5)
    expect(holes.length).toBeGreaterThan(0)
    for (let y = 7; y <= 12; y++) {
      for (let x = 7; x <= 12; x++) {
        expect(holes.some((hole) => contains(hole, x + 0.5, y + 0.5))).toBe(true)
      }
    }
    for (const hole of holes) expect(hasStairRun(hole)).toBe(false)
  })
})

function contains(loop: readonly MapPoint[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]
    const b = loop[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function gap(loop: readonly MapPoint[]): number {
  const first = loop[0]
  const last = loop[loop.length - 1]
  return Math.hypot(first.x - last.x, first.y - last.y)
}

function distanceToMask(point: MapPoint, tiles: Uint8Array, width: number, height: number): number {
  let best = Infinity
  const x0 = Math.max(0, Math.floor(point.x) - 4)
  const x1 = Math.min(width - 1, Math.floor(point.x) + 4)
  const y0 = Math.max(0, Math.floor(point.y) - 4)
  const y1 = Math.min(height - 1, Math.floor(point.y) + 4)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (tiles[y * width + x] === Terrain.Water) continue
      const dx = point.x < x ? x - point.x : point.x > x + 1 ? point.x - (x + 1) : 0
      const dy = point.y < y ? y - point.y : point.y > y + 1 ? point.y - (y + 1) : 0
      best = Math.min(best, Math.hypot(dx, dy))
    }
  }
  return best
}

function hasStairRun(loop: readonly MapPoint[]): boolean {
  let run = 0
  let prevHorizontal: boolean | null = null
  for (let i = 0; i < loop.length; i++) {
    const from = loop[i]
    const to = loop[(i + 1) % loop.length]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.hypot(dx, dy)
    const horizontal = Math.abs(dy) <= Math.abs(dx) * 0.18
    const vertical = Math.abs(dx) <= Math.abs(dy) * 0.18
    const step = (horizontal || vertical) && len > 0.25 && len < 1.55
    if (!step) {
      run = 0
      prevHorizontal = null
      continue
    }
    if (prevHorizontal === null || prevHorizontal !== horizontal) run += 1
    else run = 1
    prevHorizontal = horizontal
    if (run >= 4) return true
  }
  return false
}
