import { describe, expect, it } from 'vitest'
import { Quad } from './quad.ts'

describe('quad seek', () => {
  it('returns only points inside the rectangle', () => {
    const quad = new Quad()
    quad.clear(64, 64)
    quad.insert(1, 2.5, 3.5)
    quad.insert(2, 40.2, 41.2)
    quad.insert(3, 2.9, 3.1)
    const found: number[] = []
    quad.seek(2, 3, 4, 4, found)
    expect(found.sort((a, b) => a - b)).toEqual([1, 3])
  })

  it('finds every point a full scan would, including a pile on one spot', () => {
    const quad = new Quad()
    quad.clear(128, 96)
    const points: { index: number; x: number; z: number }[] = []
    for (let i = 0; i < 40; i++) points.push({ index: i, x: 10.25, z: 12.5 })
    for (let i = 40; i < 500; i++) points.push({ index: i, x: (i * 17) % 128, z: (i * 13) % 96 })
    for (const point of points) quad.insert(point.index, point.x, point.z)
    const minX = 20
    const minZ = 30
    const maxX = 55.5
    const maxZ = 70
    const found: number[] = []
    quad.seek(minX, minZ, maxX, maxZ, found)
    const brute = points
      .filter((point) => point.x >= minX && point.z >= minZ && point.x <= maxX && point.z <= maxZ)
      .map((point) => point.index)
      .sort((a, b) => a - b)
    expect(found.sort((a, b) => a - b)).toEqual(brute)
  })
})