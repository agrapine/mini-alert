import type { MapPoint } from '../shared/protocol.ts'
import { playerColor } from '../shared/players.ts'
import type { TileCoord } from '../shared/tiles.ts'
import { UnitTypeId } from '../shared/unit-types.ts'
import { Game } from './game.ts'
import { generateIsland, type Island } from './mapgen/generate.ts'
import { Player } from './player.ts'
import { World } from './world.ts'

const MATCH_SEED = Math.random() * 100

const SQUAD = [UnitTypeId.MedTank, UnitTypeId.Scout, UnitTypeId.HeavyTank, UnitTypeId.Artillery]

export type MatchSeat = {
  ai: boolean
  color: number
}

export function createIslandMatch(seed = MATCH_SEED): { game: Game; human: Player; ai: Player } {
  const island = generateIsland(seed)
  const { game, players } = seatIsland(island, [
    { ai: false, color: playerColor(1) },
    { ai: true, color: playerColor(2) },
  ])
  return { game, human: players[0], ai: players[1] }
}

export function seatIsland(
  island: Island,
  seats: readonly MatchSeat[],
  towns: readonly MapPoint[] = spreadTowns(island, seats.length),
): { game: Game; players: Player[] } {
  const game = new Game(World.fromTiles(island.width, island.height, island.terrain))
  game.scenery = {
    coast: island.coast,
    holes: island.holes,
    roads: island.roads,
    towns: island.towns,
    seed: island.seed,
  }
  game.bindCities()
  const players = seats.map((seat) => game.addPlayer(seat.color))
  for (let i = 0; i < players.length; i++) {
    const town = towns[i]
    if (!town) continue
    const player = players[i]
    const facing = facingAlongRoad(island, town)
    const tiles = spawnSquad(game, player, town, facing)
    game.claimCity(town, player.id)
    game.setSpawnAnchor(player.id, tiles[0] ?? tileOf(town))
  }
  return { game, players }
}

export function spreadTowns(island: Island, count: number): MapPoint[] {
  const towns = island.towns
  if (count <= 0 || towns.length === 0) return []
  if (count >= towns.length) return towns.slice(0, count)
  const dist = hopDistances(island)
  const chosen: number[] = []
  let first = 0
  let firstScore = -1
  for (let i = 1; i < towns.length; i++) {
    const score = hop(dist, 0, i)
    if (score > firstScore) {
      firstScore = score
      first = i
    }
  }
  chosen.push(first)
  while (chosen.length < count) {
    let pick = 0
    let pickScore = -1
    for (let i = 0; i < towns.length; i++) {
      if (chosen.includes(i)) continue
      let nearest = Infinity
      for (const held of chosen) nearest = Math.min(nearest, hop(dist, held, i))
      if (nearest > pickScore) {
        pickScore = nearest
        pick = i
      }
    }
    chosen.push(pick)
  }
  return chosen.map((index) => towns[index])
}

function hopDistances(island: Island): Int16Array[] {
  const count = island.towns.length
  const adj: number[][] = Array.from({ length: count }, () => [])
  for (const [a, b] of island.roadEdges) {
    adj[a].push(b)
    adj[b].push(a)
  }
  return Array.from({ length: count }, (_, start) => {
    const dist = new Int16Array(count).fill(-1)
    const queue = [start]
    dist[start] = 0
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]
      for (const next of adj[current]) {
        if (dist[next] >= 0) continue
        dist[next] = dist[current] + 1
        queue.push(next)
      }
    }
    return dist
  })
}

function hop(dist: readonly Int16Array[], from: number, to: number): number {
  const value = dist[from][to]
  return value < 0 ? 10_000 : value
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
      const distance = px * px + py * py
      if (distance < best) {
        best = distance
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
