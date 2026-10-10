import { describe, expect, it } from 'vitest'
import { isMinimapShore, minimapRgb } from '../../shared/minimap.ts'
import { isWalkableTerrain, Terrain } from '../../shared/tiles.ts'
import { UnitTypeId } from '../../shared/unit-types.ts'
import { createIslandMatch } from '../island-match.ts'
import { MAX_HOPS, countyHops, fillWaterCracks, generateIsland } from './generate.ts'

const island = generateIsland(1)

describe('island generator', () => {
  it('keeps the map edge as water', () => {
    const { width, height, terrain } = island
    for (let x = 0; x < width; x++) {
      expect(terrain[x]).toBe(Terrain.Water)
      expect(terrain[(height - 1) * width + x]).toBe(Terrain.Water)
    }
    for (let y = 0; y < height; y++) {
      expect(terrain[y * width]).toBe(Terrain.Water)
      expect(terrain[y * width + width - 1]).toBe(Terrain.Water)
    }
    expect(island.coast.length).toBeGreaterThan(8)
  })

  it('joins counties into one road network within the hop limit', () => {
    const count = island.towns.length
    expect(count).toBeGreaterThan(1)
    for (let a = 0; a < count; a++) {
      for (let b = a + 1; b < count; b++) {
        expect(countyHops(island.roadEdges, count, a, b)).not.toBe(Infinity)
      }
    }
    for (const [a, b] of island.borders) {
      expect(countyHops(island.roadEdges, count, a, b)).toBeLessThanOrEqual(MAX_HOPS)
    }
  })

  it('fills water cracks and keeps lake blobs', () => {
    const { width, height, terrain } = island
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (terrain[y * width + x] !== Terrain.Water) continue
        expect(oppositeLand(terrain, width, height, x, y)).toBe(false)
      }
    }
    expect(terrain.includes(Terrain.Lake)).toBe(true)
  })

  it('follows the minimap color rules', () => {
    expect(minimapRgb(Terrain.Flowers, false)).toEqual(minimapRgb(Terrain.Land, false))
    const inland = minimapRgb(Terrain.Land, false)
    const shore = minimapRgb(Terrain.Land, true)
    expect(shore[1]).toBeLessThan(inland[1])
    expect(minimapRgb(Terrain.Forest, true)).toEqual(minimapRgb(Terrain.Forest, false))
    expect(minimapRgb(Terrain.Water, true)).toEqual(minimapRgb(Terrain.Water, false))

    let shoreLand = false
    let inlandLand = false
    let shoreForest = false
    for (let y = 0; y < island.height; y++) {
      for (let x = 0; x < island.width; x++) {
        const tile = island.terrain[y * island.width + x]
        const atShore = isMinimapShore(island.terrain, island.width, island.height, x, y)
        if (tile === Terrain.Land && atShore) shoreLand = true
        if (tile === Terrain.Land && !atShore) inlandLand = true
        if (tile === Terrain.Forest && atShore) shoreForest = true
      }
    }
    expect(shoreLand).toBe(true)
    expect(inlandLand).toBe(true)
    expect(shoreForest).toBe(true)
    expect(minimapRgb(Terrain.Forest, true)).toEqual(minimapRgb(Terrain.Forest, false))
  })
})

describe('island match', () => {
  it('spawns both sides on walkable tiles and anchors the spawn buttons', () => {
    const { game, human, ai } = createIslandMatch()
    const humans = game.units.filter((unit) => unit.ownerId === human.id)
    const bots = game.units.filter((unit) => unit.ownerId === ai.id)
    expect(humans.length).toBe(3)
    expect(bots.length).toBe(3)
    for (const unit of game.units) {
      expect(isWalkableTerrain(game.world.terrainAt(unit.tile.x, unit.tile.y))).toBe(true)
    }
    expect(game.trySpawn(human.id, UnitTypeId.Scout)).toBe(true)
    const spawned = game.units[game.units.length - 1]
    expect(isWalkableTerrain(game.world.terrainAt(spawned.tile.x, spawned.tile.y))).toBe(true)
    expect(spawned.ownerId).toBe(human.id)
  })
})

describe('fillWaterCracks', () => {
  it('fills a one-tile crack and leaves a lake blob', () => {
    const width = 9
    const height = 7
    const tiles = new Uint8Array(width * height).fill(Terrain.Land)
    tiles[3 * width + 7] = Terrain.Water
    for (let y = 2; y <= 4; y++) {
      for (let x = 2; x <= 4; x++) tiles[y * width + x] = Terrain.Lake
    }
    fillWaterCracks(tiles, width, height)
    expect(tiles[3 * width + 7]).toBe(Terrain.Land)
    for (let y = 2; y <= 4; y++) {
      for (let x = 2; x <= 4; x++) expect(tiles[y * width + x]).toBe(Terrain.Lake)
    }
  })
})

function oppositeLand(terrain: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  const land = (nx: number, ny: number) => {
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false
    const tile = terrain[ny * width + nx]
    return tile !== Terrain.Water && tile !== Terrain.Lake
  }
  return (land(x - 1, y) && land(x + 1, y)) || (land(x, y - 1) && land(x, y + 1))
}
