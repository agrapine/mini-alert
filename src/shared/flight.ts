import { tileCenter, type TileCoord } from './tiles.ts'
import { Locomotion } from './unit-types.ts'

export const enum Flight {
  Ground = 0,
  Takeoff = 1,
  Cruise = 2,
  Orbit = 3,
  Landing = 4,
}

export const PLANE_ALTITUDE = 2.6
export const ROTOR_ALTITUDE = 1.5
export const CLIMB_RATE = 1.6
export const RUNWAY_LENGTH = 4
export const RUNWAY_WIDTH = 2

export function onRunway(tileX: number, tileY: number, homeX: number, homeY: number): boolean {
  return tileX >= homeX && tileY >= homeY && tileX < homeX + RUNWAY_WIDTH && tileY < homeY + RUNWAY_LENGTH
}
export const ORBIT_RADIUS = 7

export function cruiseAltitude(locomotion: Locomotion): number {
  return locomotion === Locomotion.Plane ? PLANE_ALTITUDE : ROTOR_ALTITUDE
}

export function runwayEnd(origin: TileCoord): TileCoord {
  return { x: origin.x, y: origin.y + RUNWAY_LENGTH - 1 }
}

export function joinPaths(head: readonly TileCoord[], tail: readonly TileCoord[]): TileCoord[] {
  const path = head.map((tile) => ({ x: tile.x, y: tile.y }))
  for (const tile of tail) {
    const last = path[path.length - 1]
    if (last && last.x === tile.x && last.y === tile.y) continue
    path.push({ x: tile.x, y: tile.y })
  }
  return path
}

export function orbitLoop(center: TileCoord, from: { x: number; z: number }, radius = ORBIT_RADIUS): TileCoord[] {
  const steps = 18
  const points: TileCoord[] = []
  let prev = ''
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2
    const tile = {
      x: center.x + Math.round(Math.cos(angle) * radius),
      y: center.y + Math.round(Math.sin(angle) * radius),
    }
    const key = `${tile.x},${tile.y}`
    if (key === prev) continue
    prev = key
    points.push(tile)
  }
  if (points.length === 0) return points
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < points.length; i++) {
    const centerOf = tileCenter(points[i])
    const dist = (centerOf.x - from.x) ** 2 + (centerOf.z - from.z) ** 2
    if (dist >= bestDist) continue
    bestDist = dist
    best = i
  }
  return points.slice(best).concat(points.slice(0, best))
}
