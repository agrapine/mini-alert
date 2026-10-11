import { CITY_SIGHT } from './cities.ts'
import type { ShotEvent, UnitSnapshot } from './protocol.ts'
import { UNIT_TYPES } from './unit-types.ts'

export const EXPLORED_FOG = 0.55
export const FOG_FEATHER = 0.8
export const FOG_TEXELS = 2

export type SightSource = {
  x: number
  z: number
  sight: number
}

export function seesPoint(friends: readonly SightSource[], x: number, z: number): boolean {
  for (const friend of friends) {
    const dx = x - friend.x
    const dz = z - friend.z
    if (dx * dx + dz * dz <= friend.sight * friend.sight) return true
  }
  return false
}

export type CitySight = {
  ownerId: number
  x: number
  z: number
}

export function friendsOf(
  units: readonly UnitSnapshot[],
  playerId: number,
  cities: readonly CitySight[] = [],
): SightSource[] {
  const friends: SightSource[] = []
  for (const unit of units) {
    if (unit.ownerId !== playerId || unit.health <= 0 || unit.progress < 1) continue
    const sight = UNIT_TYPES[unit.typeId].weapon.sight
    if (sight <= 0) continue
    friends.push({ x: unit.x, z: unit.z, sight })
  }
  for (const city of cities) {
    if (city.ownerId !== playerId) continue
    friends.push({ x: city.x, z: city.z, sight: CITY_SIGHT })
  }
  return friends
}

export function unitsForPlayer(
  units: readonly UnitSnapshot[],
  playerId: number,
  cities: readonly CitySight[] = [],
): UnitSnapshot[] {
  const friends = friendsOf(units, playerId, cities)
  return units.filter((unit) => unit.ownerId === playerId || seesPoint(friends, unit.x, unit.z))
}

export function shotsForPlayer(
  shots: readonly ShotEvent[],
  units: readonly UnitSnapshot[],
  playerId: number,
  cities: readonly CitySight[] = [],
): ShotEvent[] {
  const friends = friendsOf(units, playerId, cities)
  return shots.filter(
    (shot) => seesPoint(friends, shot.x, shot.z) || seesPoint(friends, shot.aimX, shot.aimZ),
  )
}

export function stampSight(
  width: number,
  height: number,
  friends: readonly SightSource[],
  explored: Uint8Array,
  visible: Uint8Array,
) {
  visible.fill(0)
  for (const friend of friends) {
    const reach = Math.ceil(friend.sight)
    const originX = Math.floor(friend.x)
    const originY = Math.floor(friend.z)
    const reachSq = friend.sight * friend.sight
    for (let dy = -reach; dy <= reach; dy++) {
      const y = originY + dy
      if (y < 0 || y >= height) continue
      for (let dx = -reach; dx <= reach; dx++) {
        const x = originX + dx
        if (x < 0 || x >= width) continue
        const cx = x + 0.5 - friend.x
        const cz = y + 0.5 - friend.z
        if (cx * cx + cz * cz > reachSq) continue
        const index = y * width + x
        visible[index] = 1
        explored[index] = 1
      }
    }
  }
}

export function stampExploredDistance(
  texelsPerTile: number,
  width: number,
  height: number,
  friends: readonly SightSource[],
  field: Float32Array,
  feather = FOG_FEATHER,
): void {
  const cols = width * texelsPerTile
  const rows = height * texelsPerTile
  for (const friend of friends) {
    const reach = friend.sight + feather
    const x0 = Math.max(0, Math.floor((friend.x - reach) * texelsPerTile))
    const x1 = Math.min(cols - 1, Math.ceil((friend.x + reach) * texelsPerTile) - 1)
    const y0 = Math.max(0, Math.floor((friend.z - reach) * texelsPerTile))
    const y1 = Math.min(rows - 1, Math.ceil((friend.z + reach) * texelsPerTile) - 1)
    for (let ty = y0; ty <= y1; ty++) {
      const wz = (ty + 0.5) / texelsPerTile
      const dz = wz - friend.z
      for (let tx = x0; tx <= x1; tx++) {
        const wx = (tx + 0.5) / texelsPerTile
        const dx = wx - friend.x
        const distance = Math.hypot(dx, dz) - friend.sight
        if (distance >= feather) continue
        const index = ty * cols + tx
        const next = distance < -feather ? -feather : distance
        if (next < field[index]) field[index] = next
      }
    }
  }
}
