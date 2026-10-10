import { Terrain } from './tiles.ts'

export type Rgb = [number, number, number]

const WATER: Rgb = [127, 206, 232]
const LAKE: Rgb = [110, 196, 224]
const LAND: Rgb = [118, 164, 72]
const SHORE: Rgb = [86, 128, 54]
const FOREST: Rgb = [61, 154, 74]
const ROAD: Rgb = [102, 119, 85]
const TOWN: Rgb = [26, 26, 26]

const SHORE_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

export function isMinimapShore(
  terrain: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  for (const [dx, dy] of SHORE_DIRS) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true
    const neighbor = terrain[ny * width + nx]
    if (neighbor === Terrain.Water || neighbor === Terrain.Lake) return true
  }
  return false
}

export function minimapRgb(terrain: Terrain, shore: boolean): Rgb {
  if (terrain === Terrain.Water) return WATER
  if (terrain === Terrain.Lake) return LAKE
  if (terrain === Terrain.Forest) return FOREST
  if (terrain === Terrain.Road) return ROAD
  if (terrain === Terrain.Town) return TOWN
  return shore ? SHORE : LAND
}
