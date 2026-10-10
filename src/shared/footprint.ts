import { UNIT_TYPES, type UnitTypeId } from './unit-types.ts'
import { isWalkableTerrain, type Terrain, type TileCoord } from './tiles.ts'

export type FootprintUnit = {
  id: number
  typeId: UnitTypeId
  tileX: number
  tileY: number
}

export function footprintCovers(originX: number, originY: number, footprint: number, tile: TileCoord): boolean {
  return tile.x >= originX && tile.y >= originY && tile.x < originX + footprint && tile.y < originY + footprint
}

export function tileOccupied(units: readonly FootprintUnit[], tile: TileCoord, ignore: readonly number[]): boolean {
  return units.some((unit) => {
    if (ignore.includes(unit.id)) return false
    const footprint = UNIT_TYPES[unit.typeId].footprint
    return footprintCovers(unit.tileX, unit.tileY, footprint, tile)
  })
}

export function canPlaceFootprint(
  origin: TileCoord,
  footprint: number,
  width: number,
  height: number,
  terrainAt: (x: number, y: number) => Terrain,
  units: readonly FootprintUnit[],
): boolean {
  for (let dy = 0; dy < footprint; dy++) {
    for (let dx = 0; dx < footprint; dx++) {
      const x = origin.x + dx
      const y = origin.y + dy
      if (x < 0 || y < 0 || x >= width || y >= height) return false
      if (!isWalkableTerrain(terrainAt(x, y))) return false
      if (tileOccupied(units, { x, y }, [])) return false
    }
  }
  return true
}
