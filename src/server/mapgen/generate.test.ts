import { describe, expect, it } from 'vitest'
import { blockerHoles, blockerTiles, smoothShore } from '../../shared/shore.ts'
import { isMinimapShore, minimapRgb } from '../../shared/minimap.ts'
import { isWalkableTerrain, Terrain } from '../../shared/tiles.ts'
import { SCOUT, UnitTypeId } from '../../shared/unit-types.ts'
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
    expect(minimapRgb(Terrain.Land, false)).toEqual([118, 164, 72])
    expect(minimapRgb(Terrain.Road, false)).toEqual([102, 119, 85])
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
    expect(humans.length).toBe(4)
    expect(bots.length).toBe(4)
    for (const unit of game.units) {
      expect(isWalkableTerrain(game.world.terrainAt(unit.tile.x, unit.tile.y))).toBe(true)
    }
    let placed = false
    for (let y = 0; y < game.world.height && !placed; y++) {
      for (let x = 0; x < game.world.width && !placed; x++) {
        placed = game.placeBuilding(human.id, UnitTypeId.Factory, { x, y })
      }
    }
    expect(placed).toBe(true)
    game.finishBuild(human.id)
    expect(game.trySpawn(human.id, UnitTypeId.Scout)).toBe(true)
    game.tick(SCOUT.buildTime)
    const spawned = game.units[game.units.length - 1]
    expect(isWalkableTerrain(game.world.terrainAt(spawned.tile.x, spawned.tile.y))).toBe(true)
    expect(spawned.ownerId).toBe(human.id)
  })
})

function inside(loop: { x: number; y: number }[], x: number, y: number): boolean {
  let c = false
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]
    const b = loop[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

describe('coverage', () => {
  it('opens a hole in the grass for every lake the shore covers', () => {
    for (const seed of [101, 1]) {
      const map = generateIsland(seed)
      const shore = smoothShore(map.terrain, map.width, map.height, map.seed)
      const tiles = new Set(
        blockerTiles(map.terrain, map.width, map.height, shore.coast).map((tile) => tile.y * map.width + tile.x),
      )
      const holes = blockerHoles(map.terrain, map.width, map.height, shore.coast, map.seed)
      const prepared = holes.map((hole) => {
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const point of hole) {
          minX = Math.min(minX, point.x)
          minY = Math.min(minY, point.y)
          maxX = Math.max(maxX, point.x)
          maxY = Math.max(maxY, point.y)
        }
        return { hole, minX, minY, maxX, maxY }
      })
      let lakes = 0
      let seen = 0
      let missed = 0
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (map.terrain[y * map.width + x] !== Terrain.Lake) continue
          const cx = x + 0.5
          const cy = y + 0.5
          if (!inside(shore.coast, cx, cy)) continue
          lakes++
          if ((x + y * 3) % 17 !== 0) continue
          seen++
          expect(tiles.has(y * map.width + x)).toBe(true)
          const covered = prepared.some(
            (item) =>
              cx >= item.minX && cx <= item.maxX && cy >= item.minY && cy <= item.maxY && inside(item.hole, cx, cy),
          )
          if (!covered) missed++
        }
      }
      expect(lakes).toBeGreaterThan(0)
      expect(seen).toBeGreaterThan(0)
      expect(missed).toBeLessThan(Math.max(2, Math.round(seen * 0.02)))
      for (const hole of holes) {
        for (const point of hole) expect(inside(shore.coast, point.x, point.y)).toBe(true)
      }
    }
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
