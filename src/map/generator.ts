import { Map, type TileCoord } from './map.ts'

export const MAP_SIZE = 24

export function createSkirmishMap(): Map {
  const obstacles: TileCoord[] = []
  for (let y = 3; y <= 20; y++) {
    if (y === 8 || y === 16) continue
    obstacles.push({ x: 11, y })
  }
  obstacles.push(
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 6, y: 6 },
    { x: 2, y: 18 },
    { x: 3, y: 18 },
    { x: 16, y: 4 },
    { x: 17, y: 4 },
    { x: 18, y: 5 },
    { x: 20, y: 18 },
    { x: 19, y: 19 },
    { x: 8, y: 21 },
    { x: 15, y: 15 },
  )
  return new Map(MAP_SIZE, MAP_SIZE, obstacles)
}
