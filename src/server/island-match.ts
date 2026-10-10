import type { MapPoint } from '../shared/protocol.ts'
import { isWalkableTerrain, type TileCoord } from '../shared/tiles.ts'
import { UnitTypeId } from '../shared/unit-types.ts'
import { Game } from './game.ts'
import { generateIsland, type Island } from './mapgen/generate.ts'
import type { Player } from './player.ts'
import { World } from './world.ts'

// const MATCH_SEED = Math.random()*100;
const MATCH_SEED = 101;

const SQUAD = [UnitTypeId.MedTank, UnitTypeId.Scout, UnitTypeId.HeavyTank, UnitTypeId.Artillery]

const OFFSETS: TileCoord[] = [
  { x: 0, y: 1 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
  { x: 0, y: 2 },
  { x: 2, y: 0 },
  { x: 0, y: -2 },
  { x: -2, y: 0 },
  { x: 0, y: 0 },
]

export function createIslandMatch(seed = MATCH_SEED): { game: Game; human: Player; ai: Player } {
  const island = generateIsland(seed)
  const game = new Game(World.fromTiles(island.width, island.height, island.terrain))
  game.scenery = {
    coast: island.coast,
    holes: island.holes,
    roads: island.roads,
    towns: island.towns,
    seed: island.seed,
  }
  const human = game.addPlayer()
  const ai = game.addPlayer()
  const [humanTown, aiTown] = farTowns(island)
  const humanFacing = facingAlongRoad(island, humanTown)
  const aiFacing = facingAlongRoad(island, aiTown)
  const humanTiles = spawnSquad(game, human, island, humanTown, humanFacing)
  const aiTiles = spawnSquad(game, ai, island, aiTown, aiFacing)
  game.setSpawnAnchor(human.id, humanTiles[0] ?? tileOf(humanTown))
  game.setSpawnAnchor(ai.id, aiTiles[0] ?? tileOf(aiTown))
  return { game, human, ai }
}

function farTowns(island: Island): [MapPoint, MapPoint] {
  const count = island.towns.length
  const adj: number[][] = Array.from({ length: count }, () => [])
  for (const [a, b] of island.roadEdges) {
    adj[a].push(b)
    adj[b].push(a)
  }
  const farthest = (start: number) => {
    const dist = new Int16Array(count).fill(-1)
    const queue = [start]
    dist[start] = 0
    let best = start
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]
      if (dist[current] > dist[best]) best = current
      for (const next of adj[current]) {
        if (dist[next] >= 0) continue
        dist[next] = dist[current] + 1
        queue.push(next)
      }
    }
    return best
  }
  const start = farthest(0)
  const end = farthest(start)
  return [island.towns[start], island.towns[end]]
}

function facingAlongRoad(island: Island, town: MapPoint): number {
  let best = Infinity
  let facing = 0
  for (const road of island.roads) {
    for (let i = 0; i < road.length - 1; i++) {
      const from = road[i]
      const to = road[i + 1]
      const dx = to.x - from.x
      const dy = to.y - from.y
      const len = Math.hypot(dx, dy) || 1
      const along = ((town.x - from.x) * dx + (town.y - from.y) * dy) / (len * len)
      const clamped = Math.min(1, Math.max(0, along))
      const px = from.x + dx * clamped - town.x
      const py = from.y + dy * clamped - town.y
      const dist = px * px + py * py
      if (dist < best) {
        best = dist
        facing = Math.atan2(dx, dy)
      }
    }
  }
  return facing
}

function spawnSquad(
  game: Game,
  player: Player,
  island: Island,
  town: MapPoint,
  facing: number,
): TileCoord[] {
  const origin = tileOf(town)
  const used = new Set<string>()
  const placed: TileCoord[] = []
  for (const typeId of SQUAD) {
    const tile = openTile(island, origin, used)
    if (!tile) continue
    used.add(`${tile.x},${tile.y}`)
    game.spawn(player, typeId, tile, facing)
    placed.push(tile)
  }
  return placed
}

function openTile(island: Island, origin: TileCoord, used: ReadonlySet<string>): TileCoord | null {
  for (const step of OFFSETS) {
    const tile = { x: origin.x + step.x, y: origin.y + step.y }
    if (used.has(`${tile.x},${tile.y}`)) continue
    if (tile.x < 0 || tile.y < 0 || tile.x >= island.width || tile.y >= island.height) continue
    if (!isWalkableTerrain(island.terrain[tile.y * island.width + tile.x])) continue
    return tile
  }
  return null
}

function tileOf(point: MapPoint): TileCoord {
  return { x: Math.floor(point.x), y: Math.floor(point.y) }
}
