import { describe, expect, it } from 'vitest'
import { landLoops } from './contour.ts'
import { decodeShift, encodeShift, encodeVertex, SHIFT_LIMIT } from './shift.ts'
import { Terrain } from './tiles.ts'

describe('shift byte', () => {
  it('round-trips nibbles and stays inside the tile', () => {
    for (let step = -7; step <= 7; step++) {
      const value = step / 16
      const back = decodeShift(encodeShift(value, -value))
      expect(back.x).toBeCloseTo(value)
      expect(back.y).toBeCloseTo(-value)
      expect(Math.abs(back.x)).toBeLessThanOrEqual(SHIFT_LIMIT)
      expect(Math.abs(back.y)).toBeLessThanOrEqual(SHIFT_LIMIT)
    }
    const clamped = decodeShift(encodeShift(0.5, -0.5))
    expect(clamped.x).toBeCloseTo(SHIFT_LIMIT)
    expect(clamped.y).toBeCloseTo(-SHIFT_LIMIT)
  })
})

describe('layer contours', () => {
  it('follows a shifted shore and ignores an unknown neighbor', () => {
    const width = 8
    const height = 4
    const shore = 4
    const terrain = new Uint8Array(width * height)
    const known = new Uint8Array(width * height)
    const shifts = new Uint8Array(width * height)
    shifts.fill(0x88)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const land = x >= shore
        terrain[y * width + x] = land ? Terrain.Land : Terrain.Water
        known[y * width + x] = 1
        if (x === shore || x === shore - 1) shifts[y * width + x] = encodeVertex(x, y, shore, y + 0.5)
      }
    }
    const loops = landLoops(terrain, known, shifts, width, height)
    const points = bankPoints(loops)
    expect(points.length).toBeGreaterThan(0)
    for (const point of points) expect(Math.abs(point.x - shore)).toBeLessThanOrEqual(1 / 16)

    for (let y = 0; y < height; y++) known[y * width + (shore - 1)] = 0
    const hidden = landLoops(terrain, known, shifts, width, height)
    expect(hidden.length).toBeGreaterThan(0)
    expect(hidden.some((loop) => loop.bank.some(Boolean))).toBe(false)
  })
})

function bankPoints(loops: ReturnType<typeof landLoops>) {
  const points = []
  for (const loop of loops) {
    for (let i = 0; i < loop.points.length; i++) {
      if (!loop.bank[i]) continue
      points.push(loop.points[i], loop.points[(i + 1) % loop.points.length])
    }
  }
  return points
}
