export const enum Terrain {
  Clear = 0,
  Obstacle = 1,
  Water = 2,
  Land = 3,
  Forest = 4,
  Lake = 5,
  Flowers = 6,
  Road = 7,
  Town = 8,
  Tree = 9,
}

export function isWalkableTerrain(terrain: Terrain): boolean {
  return terrain !== Terrain.Obstacle && terrain !== Terrain.Water && terrain !== Terrain.Lake && terrain !== Terrain.Tree
}

export type TileCoord = { x: number; y: number }

export function tileCenter(tile: TileCoord): { x: number; z: number } {
  return { x: tile.x + 0.5, z: tile.y + 0.5 }
}
