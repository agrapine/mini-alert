import type { MapPoint } from '../shared/protocol.ts'
import type { TileCoord } from '../shared/tiles.ts'
import { UnitTypeId } from '../shared/unit-types.ts'
import { Game } from './game.ts'
import { generateIsland, type Island } from './mapgen/generate.ts'
import type { Player } from './player.ts'
import { World } from './world.ts'

const MATCH_SEED = Math.random()*100;
//const MATCH_SEED = 101;

const SQUAD = [UnitTypeId.MedTank, UnitTypeId.Scout, UnitTypeId.HeavyTank, UnitTypeId.Artillery]

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
  game.bindCities()
  const human = game.addPlayer()
  const ai = game.addPlayer()
  const [humanTown, aiTown] = farTowns(island)
  game.claimCity(humanTown, human.id)
  game.claimCity(aiTown, ai.id)
  const humanFacing = facingAlongRoad(island, humanTown)
  const aiFacing = facingAlongRoad(island, aiTown)
  const humanTiles = spawnSquad(game, human, humanTown, humanFacing)
  const aiTiles = spawnSquad(game, ai, aiTown, aiFacing)
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

function spawnSquad(game: Game, player: Player, town: MapPoint, facing: number): TileCoord[] {
  const origin = tileOf(town)
  const placed: TileCoord[] = []
  for (const typeId of SQUAD) {
    const unit = game.spawn(player, typeId, origin, facing)
    placed.push(unit.tile)
  }
  return placed
}

function tileOf(point: MapPoint): TileCoord {
  return { x: Math.floor(point.x), y: Math.floor(point.y) }
}
