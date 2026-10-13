import { tileCenter, type TileCoord } from './tiles.ts'
import { Locomotion } from './unit-types.ts'

export const enum Flight {
  Ground = 0,
  Takeoff = 1,
  Cruise = 2,
  Orbit = 3,
  Landing = 4,
  Taxi = 5,
}

export const PLANE_ALTITUDE = 2.6
export const ROTOR_ALTITUDE = 1.5
export const CLIMB_RATE = 1.6
export const FLIGHT_CLEARANCE = 1

export function planeInFlight(flight: Flight, altitude: number): boolean {
  return flight !== Flight.Ground && altitude >= FLIGHT_CLEARANCE
}
export const BAY_COUNT = 6
export const RUNWAY_LENGTH = 3

export function runwayStart(origin: TileCoord): TileCoord {
  return { x: origin.x + 1, y: origin.y }
}

export function onRunway(tileX: number, tileY: number, homeX: number, homeY: number): boolean {
  return tileX === homeX + 1 && tileY >= homeY && tileY < homeY + RUNWAY_LENGTH
}

export function bayTile(origin: TileCoord, bay: number): TileCoord {
  const slot = ((bay % BAY_COUNT) + BAY_COUNT) % BAY_COUNT
  const col = slot < 3 ? 0 : 2
  const row = slot % 3
  return { x: origin.x + col, y: origin.y + row }
}

export function bayFacing(bay: number): number {
  return bay < 3 ? Math.PI / 2 : -Math.PI / 2
}

export function onBay(tileX: number, tileY: number, homeX: number, homeY: number, bay: number): boolean {
  const spot = bayTile({ x: homeX, y: homeY }, bay)
  return tileX === spot.x && tileY === spot.y
}

export function openBay(taken: ReadonlySet<number>): number {
  for (let bay = 0; bay < BAY_COUNT; bay++) if (!taken.has(bay)) return bay
  return -1
}

export function baysFree(pads: readonly TileCoord[], parked: readonly { x: number; y: number; bay: number }[]): number {
  let room = 0
  for (const pad of pads) {
    const taken = new Set<number>()
    for (const jet of parked) {
      if (jet.x !== pad.x || jet.y !== pad.y) continue
      if (jet.bay >= 0 && jet.bay < BAY_COUNT) taken.add(jet.bay)
    }
    room += BAY_COUNT - taken.size
  }
  return room
}
export const ORBIT_RADIUS = 7

export function cruiseAltitude(locomotion: Locomotion): number {
  return locomotion === Locomotion.Plane ? PLANE_ALTITUDE : ROTOR_ALTITUDE
}

export function runwayEnd(origin: TileCoord): TileCoord {
  return { x: origin.x + 1, y: origin.y + RUNWAY_LENGTH - 1 }
}

function pushOrthogonal(path: TileCoord[], from: TileCoord, to: TileCoord): TileCoord {
  let x = from.x
  let y = from.y
  const sx = Math.sign(to.x - x)
  const sy = Math.sign(to.y - y)
  while (x !== to.x) {
    x += sx
    path.push({ x, y })
  }
  while (y !== to.y) {
    y += sy
    path.push({ x, y })
  }
  return { x: to.x, y: to.y }
}

export function taxiRoute(from: TileCoord, origin: TileCoord, bay: number): TileCoord[] {
  const spot = bayTile(origin, bay)
  const path: TileCoord[] = []
  const row = Math.min(origin.y + RUNWAY_LENGTH - 1, Math.max(origin.y, from.y))
  let cursor = pushOrthogonal(path, from, { x: origin.x + 1, y: row })
  cursor = pushOrthogonal(path, cursor, { x: origin.x + 1, y: spot.y })
  pushOrthogonal(path, cursor, spot)
  return path
}

export function rollout(from: TileCoord, origin: TileCoord): TileCoord[] {
  const path: TileCoord[] = []
  const row = Math.min(origin.y + RUNWAY_LENGTH - 1, Math.max(origin.y, from.y))
  let cursor = pushOrthogonal(path, from, { x: origin.x + 1, y: row })
  cursor = pushOrthogonal(path, cursor, runwayStart(origin))
  pushOrthogonal(path, cursor, runwayEnd(origin))
  return path
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
