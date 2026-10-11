import {
  ServerMessageKind,
  type MapPoint,
  type ServerMessage,
  type ShotEvent,
  type TrainJob,
  type CityState,
  type UnitSnapshot,
  type WorldSnapshot,
} from '../shared/protocol.ts'
import { buildingCost, canPlaceCityBuilding, cityContains, footprintNearCity, layoutCities, populationOf, projectCity, settledCity, type CityLayout } from '../shared/cities.ts'
import { footprintCovers, tileOccupied } from '../shared/footprint.ts'
import { UNIT_TYPES } from '../shared/unit-types.ts'
import { isWalkableTerrain, type TileCoord } from '../shared/tiles.ts'

export class Replica {
  playerId: number | null = null
  world: WorldSnapshot | null = null
  units: UnitSnapshot[] = []
  credits = 0
  training: TrainJob[] = []
  cities: CityState[] = []
  primaryFactoryId = 0
  rally: TileCoord | null = null
  cleared: TileCoord[] = []
  private pendingShots: ShotEvent[] = []
  private pendingYields: MapPoint[] = []
  private readonly clearedTiles = new Set<string>()
  private bases: CityLayout[] | null = null
  private evolved: CityLayout[] = []
  private full: CityLayout[] = []
  private blockedBuildings = new Set<string>()
  private blockKey = ''

  reset() {
    this.playerId = null
    this.world = null
    this.units = []
    this.credits = 0
    this.training = []
    this.cities = []
    this.primaryFactoryId = 0
    this.rally = null
    this.cleared = []
    this.clearedTiles.clear()
    this.pendingShots = []
    this.pendingYields = []
    this.bases = null
    this.evolved = []
    this.blockedBuildings.clear()
    this.blockKey = ''
  }

  apply(message: ServerMessage) {
    if (message.kind === ServerMessageKind.Welcome) {
      this.playerId = message.playerId
      this.pendingShots = []
      this.pendingYields = []
    }
    else if (message.kind === ServerMessageKind.World) {
      this.world = message
      this.bases = null
      this.blockKey = ''
      this.cleared = []
      this.clearedTiles.clear()
    } else if (message.kind === ServerMessageKind.Shots) this.pendingShots.push(...message.shots)
    else {
      this.units = message.units
      this.credits = message.credits
      this.training = message.training
      this.cities = message.cities
      this.primaryFactoryId = message.primaryFactoryId
      this.rally = message.rally
      this.noteCleared(message.cleared)
      if (message.yields.length > 0) this.pendingYields.push(...message.yields)
    }
  }

  takeShots(): ShotEvent[] {
    const shots = this.pendingShots
    this.pendingShots = []
    return shots
  }

  takeYields(): MapPoint[] {
    const yields = this.pendingYields
    this.pendingYields = []
    return yields
  }

  unit(id: number): UnitSnapshot | undefined {
    return this.units.find((unit) => unit.id === id)
  }

  occupant(tile: TileCoord): UnitSnapshot | undefined {
    return this.units.find((unit) =>
      footprintCovers(unit.tileX, unit.tileY, UNIT_TYPES[unit.typeId].footprint, tile),
    )
  }

  isOpen(tile: TileCoord, ignore: number | readonly number[]): boolean {
    const world = this.world
    if (!world) return false
    if (tile.x < 0 || tile.y < 0 || tile.x >= world.width || tile.y >= world.height) return false
    const open =
      isWalkableTerrain(world.terrain[tile.y * world.width + tile.x]) || this.clearedTiles.has(`${tile.x},${tile.y}`)
    if (!open) return false
    if (this.buildingBlocks().has(`${tile.x},${tile.y}`)) return false
    const skip = typeof ignore === 'number' ? [ignore] : ignore
    return !tileOccupied(this.units, tile, skip)
  }

  nearCity(origin: TileCoord, footprint: number): boolean {
    const owned = this.cityLayouts().filter((_, index) => this.cities[index]?.ownerId === this.playerId)
    return footprintNearCity(owned, origin, footprint)
  }

  canRaise(tile: TileCoord): boolean {
    if (this.citySizeAt(tile, true) === null || !this.isOpen(tile, [])) return false
    const cost = this.cityBuildCost(tile)
    return cost !== null && this.credits >= cost
  }

  cityBuildCost(tile: TileCoord | null): number | null {
    if (!tile) return null
    const size = this.citySizeAt(tile, false)
    return size === null ? null : buildingCost(size)
  }

  private citySizeAt(tile: TileCoord, plotOnly: boolean): number | null {
    const world = this.world
    if (!world || this.playerId === null) return null
    this.cityLayouts()
    for (let i = 0; i < this.full.length; i++) {
      const state = this.cities[i]
      const layout = this.full[i]
      if (!state || !layout || state.ownerId !== this.playerId) continue
      const plot = canPlaceCityBuilding(layout, tile.x, tile.y, world.terrain, world.width, world.height)
      if (!plot && (plotOnly || !cityContains(layout, tile.x, tile.y))) continue
      return populationOf(layout, state.ruins)
    }
    return null
  }

  private cityLayouts(): CityLayout[] {
    const world = this.world
    if (!world) return []
    const key = this.cities
      .map((city) => {
        const sites = (city.sites ?? []).map((site) => `${site.at},${site.x},${site.y},${site.model},${site.yaw}`).join(';')
        return `${city.grown}:${city.ruins.map((tile) => `${tile.x},${tile.y}`).join('.')}:${sites}`
      })
      .join(',')
    if (this.bases && key === this.blockKey) return this.evolved
    if (!this.bases) this.bases = layoutCities(world.towns, world.seed, world.terrain, world.width, world.height)
    this.full = this.bases.map((base, index) =>
      projectCity(base, this.cities[index]?.grown ?? 0, world.terrain, world.width, world.height, this.cities[index]?.sites ?? []),
    )
    this.evolved = this.full.map((layout, index) => settledCity(layout, this.cities[index]?.ruins ?? []))
    const blocked = new Set<string>()
    for (const city of this.evolved) {
      for (const building of city.buildings) blocked.add(`${building.x},${building.y}`)
    }
    this.blockedBuildings = blocked
    this.blockKey = key
    return this.evolved
  }

  private noteCleared(tiles: readonly TileCoord[]) {
    this.cleared = tiles.map((tile) => ({ x: tile.x, y: tile.y }))
    for (const tile of tiles) this.clearedTiles.add(`${tile.x},${tile.y}`)
  }

  private buildingBlocks(): Set<string> {
    this.cityLayouts()
    return this.blockedBuildings
  }
}
