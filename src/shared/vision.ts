import type { ShotEvent, UnitSnapshot } from './protocol.ts'
import { UNIT_TYPES } from './unit-types.ts'

export const EXPLORED_FOG = 0.55

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

export function friendsOf(units: readonly UnitSnapshot[], playerId: number): SightSource[] {
  const friends: SightSource[] = []
  for (const unit of units) {
    if (unit.ownerId !== playerId || unit.health <= 0 || unit.progress < 1) continue
    const sight = UNIT_TYPES[unit.typeId].weapon.sight
    if (sight <= 0) continue
    friends.push({ x: unit.x, z: unit.z, sight })
  }
  return friends
}

export function unitsForPlayer(units: readonly UnitSnapshot[], playerId: number): UnitSnapshot[] {
  const friends = friendsOf(units, playerId)
  return units.filter((unit) => unit.ownerId === playerId || seesPoint(friends, unit.x, unit.z))
}

export function shotsForPlayer(
  shots: readonly ShotEvent[],
  units: readonly UnitSnapshot[],
  playerId: number,
): ShotEvent[] {
  const friends = friendsOf(units, playerId)
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
