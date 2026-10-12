import { MoveDomain, spanOf, UNIT_TYPES, type UnitTypeId } from './unit-types.ts'
import { isWalkableTerrain, Terrain, type TileCoord } from './tiles.ts'

export type FootprintUnit = {
  id: number
  typeId: UnitTypeId
  tileX: number
  tileY: number
}

export function footprintCovers(originX: number, originY: number, spanX: number, spanY: number, tile: TileCoord): boolean {
  return tile.x >= originX && tile.y >= originY && tile.x < originX + spanX && tile.y < originY + spanY
}

export function tileOccupied(units: readonly FootprintUnit[], tile: TileCoord, ignore: readonly number[]): boolean {
  return units.some((unit) => {
    if (ignore.includes(unit.id)) return false
    const span = spanOf(UNIT_TYPES[unit.typeId])
    return footprintCovers(unit.tileX, unit.tileY, span.x, span.y, tile)
  })
}

export function canPlaceFootprint(
  origin: TileCoord,
  footprint: number,
  width: number,
  height: number,
  terrainAt: (x: number, y: number) => Terrain,
  units: readonly FootprintUnit[],
  spanY = footprint,
  domain: MoveDomain = MoveDomain.Ground,
): boolean {
  for (let dy = 0; dy < spanY; dy++) {
    for (let dx = 0; dx < footprint; dx++) {
      const x = origin.x + dx
      const y = origin.y + dy
      if (x < 0 || y < 0 || x >= width || y >= height) return false
      const terrain = terrainAt(x, y)
      const open = domain === MoveDomain.Water ? terrain === Terrain.Water || terrain === Terrain.Lake : isWalkableTerrain(terrain)
      if (!open) return false
      if (tileOccupied(units, { x, y }, [])) return false
    }
  }
  return footprint > 0 && spanY > 0
}
