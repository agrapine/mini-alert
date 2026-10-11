import {
  ServerMessageKind,
  type ServerMessage,
  type ShotEvent,
  type TrainJob,
  type CityState,
  type UnitSnapshot,
  type WorldSnapshot,
} from '../shared/protocol.ts'
import { footprintNearCity, layoutCities, projectCity, type CityLayout } from '../shared/cities.ts'
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
  private pendingShots: ShotEvent[] = []
  private bases: CityLayout[] | null = null
  private evolved: CityLayout[] = []
  private blockedBuildings = new Set<string>()
  private blockKey = ''

  reset() {
    this.playerId = null
    this.world = null
    this.units = []
    this.credits = 0
    this.training = []
    this.cities = []
    this.pendingShots = []
    this.bases = null
    this.evolved = []
    this.blockedBuildings.clear()
    this.blockKey = ''
  }

  apply(message: ServerMessage) {
    if (message.kind === ServerMessageKind.Welcome) {
      this.playerId = message.playerId
      this.pendingShots = []
    }
    else if (message.kind === ServerMessageKind.World) {
      this.world = message
      this.bases = null
      this.blockKey = ''
    } else if (message.kind === ServerMessageKind.Shots) this.pendingShots.push(...message.shots)
    else {
      this.units = message.units
      this.credits = message.credits
      this.training = message.training
      this.cities = message.cities
    }
  }

  takeShots(): ShotEvent[] {
    const shots = this.pendingShots
    this.pendingShots = []
    return shots
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
    if (!isWalkableTerrain(world.terrain[tile.y * world.width + tile.x])) return false
    if (this.buildingBlocks().has(`${tile.x},${tile.y}`)) return false
    const skip = typeof ignore === 'number' ? [ignore] : ignore
    return !tileOccupied(this.units, tile, skip)
  }

  nearCity(origin: TileCoord, footprint: number): boolean {
    return footprintNearCity(this.cityLayouts(), origin, footprint)
  }

  private cityLayouts(): CityLayout[] {
    const world = this.world
    if (!world) return []
    const key = this.cities.map((city) => city.grown).join(',')
    if (this.bases && key === this.blockKey) return this.evolved
    if (!this.bases) this.bases = layoutCities(world.towns, world.seed, world.terrain, world.width, world.height)
    this.evolved = this.bases.map((base, index) =>
      projectCity(base, this.cities[index]?.grown ?? 0, world.terrain, world.width, world.height),
    )
    const blocked = new Set<string>()
    for (const city of this.evolved) {
      for (const building of city.buildings) blocked.add(`${building.x},${building.y}`)
    }
    this.blockedBuildings = blocked
    this.blockKey = key
    return this.evolved
  }

  private buildingBlocks(): Set<string> {
    this.cityLayouts()
    return this.blockedBuildings
  }
}
