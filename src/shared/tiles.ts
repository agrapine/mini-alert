export const enum Terrain {
  Clear = 0,
  Obstacle = 1,
}

export type TileCoord = { x: number; y: number }

export function tileCenter(tile: TileCoord): { x: number; z: number } {
  return { x: tile.x + 0.5, z: tile.y + 0.5 }
}
