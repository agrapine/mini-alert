import { describe, expect, it } from 'vitest'
import { tileVertex } from '../../shared/shift.ts'
import { Terrain } from '../../shared/tiles.ts'
import { generateIsland } from './generate.ts'
import { bisectorDistance, fitShifts } from './shifts.ts'

describe('shore shifts', () => {
  it('moves a coastal tile closer to the voronoi bisector than its center', () => {
    const terrain = new Uint8Array([Terrain.Water, Terrain.Land])
    const kept = [{ x: 0.5, y: 3 }]
    const dropped = [{ x: 0.5, y: -1 }]
    const shifts = fitShifts(terrain, 1, 2, 1, kept, dropped, [])
    const vertex = tileVertex(0, 1, shifts[1])
    const center = bisectorDistance(0.5, 1.5, kept, dropped)
    expect(bisectorDistance(vertex.x, vertex.y, kept, dropped)).toBeLessThan(center)
  })

  it('fits a generated coast closer than the tile centers', () => {
    const island = generateIsland(1, 64, 64)
    let vertex = 0
    let center = 0
    let count = 0
    for (let y = 0; y < island.height; y++) {
      for (let x = 0; x < island.width; x++) {
        const index = y * island.width + x
        if (island.terrain[index] === Terrain.Water || island.terrain[index] === Terrain.Lake) continue
        if (!touchesWater(island.terrain, island.width, island.height, x, y)) continue
        const point = tileVertex(x, y, island.shifts[index])
        vertex += bisectorDistance(point.x, point.y, island.keptSites, island.droppedSites)
        center += bisectorDistance(x + 0.5, y + 0.5, island.keptSites, island.droppedSites)
        count += 1
      }
    }
    expect(count).toBeGreaterThan(0)
    expect(vertex).toBeLessThan(center)
  })
})

function touchesWater(terrain: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  const neighbors = [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ]
  return neighbors.some(([nx, ny]) => {
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false
    return terrain[ny * width + nx] === Terrain.Water
  })
}
