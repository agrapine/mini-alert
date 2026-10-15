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
  /** Shelled ground at strength 1. Strengths 2 and 3 are the next two values. */
  Scar = 10,
}

export const SCAR_MAX = 3
/** Splash damage that marks a tile. */
export const SCAR_MARK = 8
/** Chance that a qualifying hit marks a tile or raises its strength. */
export const SCAR_CHANCE = 0.25
/** Seconds at one strength before a scar drops to the next weaker mark. */
export const SCAR_FADE = 10
/** Splash damage that raises a scar by two strengths. A rocket does this; a tank shell does not. */
export const SCAR_HEAVY = 90

/** 0 when the tile is not shelled, otherwise 1, 2, or 3. */
export function scarStrength(terrain: number): number {
  const strength = terrain - Terrain.Scar + 1
  return strength >= 1 && strength <= SCAR_MAX ? strength : 0
}

export function scarTerrain(strength: number): Terrain {
  const level = strength < 1 ? 1 : strength > SCAR_MAX ? SCAR_MAX : strength
  return (Terrain.Scar + level - 1) as Terrain
}

export function scarGain(dealt: number): number {
  if (dealt < SCAR_MARK) return 0
  return dealt >= SCAR_HEAVY ? 2 : 1
}

export function isWalkableTerrain(terrain: Terrain): boolean {
  return terrain !== Terrain.Obstacle && terrain !== Terrain.Water && terrain !== Terrain.Lake && terrain !== Terrain.Tree
}

export type TileCoord = { x: number; y: number }

export function tileCenter(tile: TileCoord): { x: number; z: number } {
  return { x: tile.x + 0.5, z: tile.y + 0.5 }
}
