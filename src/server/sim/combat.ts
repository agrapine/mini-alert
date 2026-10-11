import { CITY_SIGHT } from '../../shared/cities.ts'
import type { ShotEvent } from '../../shared/protocol.ts'
import { WeaponKind } from '../../shared/unit-types.ts'
import { seesPoint, type CitySight, type SightSource } from '../../shared/vision.ts'
import { clamp, wrapAngle } from '../sim/drive.ts'
import type { Unit } from '../units/unit.ts'

export type Impact = {
  time: number
  x: number
  z: number
  ownerId: number
  damage: number
  splash: number
  shell: boolean
}

export type Blast = {
  x: number
  z: number
  damage: number
  splash: number
}

export type StructureTarget = {
  x: number
  z: number
  ownerId: number
}

export function engage(
  units: readonly Unit[],
  dt: number,
  time: number,
  impacts: Impact[],
  cities: readonly CitySight[] = [],
  blasts: Blast[] = [],
  structures: readonly StructureTarget[] = [],
): ShotEvent[] {
  const vision = teamVision(units, cities)
  const shots: ShotEvent[] = []
  for (const unit of units) {
    if (unit.health <= 0 || unit.progress < 1 || unit.type.weapon.damage <= 0) continue
    const weapon = unit.type.weapon
    unit.sinceShot += dt
    unit.cooldown = Math.max(0, unit.cooldown - dt)
    if (unit.sinceShot >= weapon.reload && unit.rounds < weapon.magazine) {
      unit.rounds = weapon.magazine
    }

    const ordered = unit.attackPoint
    const friends = vision.get(unit.ownerId) ?? []
    const target = ordered ? null : pickTarget(unit, units, friends)
    const structure = ordered || target ? null : pickStructure(unit, structures, friends)
    const aim = weapon.turretRate > 0 ? unit.turretYaw : unit.facing
    if (!ordered && !target && !structure) continue
    const predicted = target && weapon.kind === WeaponKind.Shell ? lead(unit, target) : null
    const aimX = ordered?.x ?? predicted?.x ?? target?.pos.x ?? structure?.x ?? unit.pos.x
    const aimZ = ordered?.z ?? predicted?.z ?? target?.pos.z ?? structure?.z ?? unit.pos.z
    const desired = Math.atan2(aimX - unit.pos.x, aimZ - unit.pos.z)
    if (weapon.turretRate > 0) {
      const err = wrapAngle(desired - unit.turretYaw)
      const step = clamp(err, -weapon.turretRate * dt, weapon.turretRate * dt)
      unit.turretYaw = wrapAngle(unit.turretYaw + step)
    }
    const gun = weapon.turretRate > 0 ? unit.turretYaw : aim
    const dist = target ? distance(unit, target) : Math.hypot(aimX - unit.pos.x, aimZ - unit.pos.z)
    const aligned = Math.abs(wrapAngle(desired - gun)) <= weapon.aimTolerance
    if (dist > weapon.range || !aligned || unit.rounds <= 0 || unit.cooldown > 0) continue

    unit.rounds -= 1
    unit.cooldown = weapon.fireInterval
    unit.sinceShot = 0
    const shell = weapon.kind === WeaponKind.Shell
    const flight = predicted?.flight ?? (shell && weapon.shellSpeed > 0 ? dist / weapon.shellSpeed : 0)
    if (flight === 0) {
      strike(units, aimX, aimZ, unit.ownerId, weapon.damage, weapon.splash)
      if (shell) blasts.push({ x: aimX, z: aimZ, damage: weapon.damage, splash: weapon.splash })
    } else {
      impacts.push({
        time: time + flight,
        x: aimX,
        z: aimZ,
        ownerId: unit.ownerId,
        damage: weapon.damage,
        splash: weapon.splash,
        shell,
      })
    }
    shots.push({
      kind: weapon.kind,
      shooterId: unit.id,
      x: unit.pos.x,
      z: unit.pos.z,
      aimX,
      aimZ,
      flight,
    })
  }
  return shots
}

export function applyImpacts(units: readonly Unit[], impacts: Impact[], time: number, blasts: Blast[] = []) {
  for (let i = impacts.length - 1; i >= 0; i--) {
    const impact = impacts[i]
    if (impact.time > time) continue
    impacts.splice(i, 1)
    strike(units, impact.x, impact.z, impact.ownerId, impact.damage, impact.splash)
    if (impact.shell) blasts.push({ x: impact.x, z: impact.z, damage: impact.damage, splash: impact.splash })
  }
}

function lead(shooter: Unit, target: Unit): { x: number; z: number; flight: number } {
  const vx = Math.sin(target.facing) * target.speed
  const vz = Math.cos(target.facing) * target.speed
  const rx = target.pos.x - shooter.pos.x
  const rz = target.pos.z - shooter.pos.z
  const flight = interceptTime(rx, rz, vx, vz, shooter.type.weapon.shellSpeed)
  return { x: target.pos.x + vx * flight, z: target.pos.z + vz * flight, flight }
}

function interceptTime(rx: number, rz: number, vx: number, vz: number, speed: number): number {
  const fallback = Math.hypot(rx, rz) / speed
  const a = vx * vx + vz * vz - speed * speed
  const b = 2 * (rx * vx + rz * vz)
  const c = rx * rx + rz * rz
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) < 1e-6) return fallback
    const linear = -c / b
    return linear > 0 ? linear : fallback
  }
  const disc = b * b - 4 * a * c
  if (disc < 0) return fallback
  const root = Math.sqrt(disc)
  const first = (-b - root) / (2 * a)
  const second = (-b + root) / (2 * a)
  const soonest = [first, second].filter((time) => time > 0).sort((left, right) => left - right)[0]
  return soonest ?? fallback
}

function strike(units: readonly Unit[], x: number, z: number, ownerId: number, damage: number, splash: number) {
  for (const unit of units) {
    if (unit.health <= 0 || unit.ownerId === ownerId) continue
    const dist = Math.hypot(unit.pos.x - x, unit.pos.z - z)
    const dealt = splash > 0 ? damage * Math.max(0, 1 - dist / splash) : dist <= bodyReach(unit) ? damage : 0
    if (dealt <= 0) continue
    unit.health = Math.max(0, unit.health - dealt)
  }
}

function bodyReach(unit: Unit): number {
  const hull = Math.max(unit.type.hull.x, unit.type.hull.z) / 2
  if (unit.type.footprint <= 1) return hull
  return Math.max(hull, (unit.type.footprint * Math.SQRT2) / 2)
}

const ATTACK_COMMIT = 1.5

function teamVision(units: readonly Unit[], cities: readonly CitySight[]): Map<number, SightSource[]> {
  const vision = new Map<number, SightSource[]>()
  for (const unit of units) {
    if (unit.health <= 0 || unit.progress < 1) continue
    const sight = unit.type.weapon.sight
    if (sight <= 0) continue
    const friends = vision.get(unit.ownerId) ?? []
    friends.push({ x: unit.pos.x, z: unit.pos.z, sight })
    vision.set(unit.ownerId, friends)
  }
  for (const city of cities) {
    if (city.ownerId <= 0) continue
    const friends = vision.get(city.ownerId) ?? []
    friends.push({ x: city.x, z: city.z, sight: CITY_SIGHT })
    vision.set(city.ownerId, friends)
  }
  return vision
}

function pickTarget(unit: Unit, units: readonly Unit[], friends: readonly SightSource[]): Unit | null {
  const weapon = unit.type.weapon
  const reach = Math.max(weapon.sight, weapon.range)
  const ordered = orderedTarget(unit, units)
  const orderedVisible = ordered !== null && seesPoint(friends, ordered.pos.x, ordered.pos.z)
  if (ordered && orderedVisible && distance(unit, ordered) <= weapon.range * ATTACK_COMMIT) return ordered
  const gun = weapon.turretRate > 0 ? unit.turretYaw : unit.facing
  let closest: Unit | null = null
  let closestDist = Infinity
  let locked: Unit | null = null
  let lockedDist = Infinity
  for (const other of units) {
    if (other.id === unit.id || other.ownerId === unit.ownerId || other.health <= 0) continue
    if (!seesPoint(friends, other.pos.x, other.pos.z)) continue
    const dist = distance(unit, other)
    if (dist > reach) continue
    if (dist < closestDist) {
      closest = other
      closestDist = dist
    }
    if (weapon.turretRate <= 0) continue
    const err = Math.abs(wrapAngle(bearing(unit, other) - gun))
    if (err <= weapon.lockAngle && dist < lockedDist) {
      locked = other
      lockedDist = dist
    }
  }
  return locked ?? closest
}

function pickStructure(unit: Unit, structures: readonly StructureTarget[], friends: readonly SightSource[]): StructureTarget | null {
  const weapon = unit.type.weapon
  if (weapon.kind !== WeaponKind.Shell || weapon.splash <= 0) return null
  const reach = Math.max(weapon.sight, weapon.range)
  const gun = weapon.turretRate > 0 ? unit.turretYaw : unit.facing
  let closest: StructureTarget | null = null
  let closestDist = Infinity
  let locked: StructureTarget | null = null
  let lockedDist = Infinity
  for (const building of structures) {
    if (building.ownerId === 0 || building.ownerId === unit.ownerId) continue
    if (!seesPoint(friends, building.x, building.z)) continue
    const dist = Math.hypot(building.x - unit.pos.x, building.z - unit.pos.z)
    if (dist > reach) continue
    if (dist < closestDist) {
      closest = building
      closestDist = dist
    }
    if (weapon.turretRate <= 0) continue
    const err = Math.abs(wrapAngle(Math.atan2(building.x - unit.pos.x, building.z - unit.pos.z) - gun))
    if (err <= weapon.lockAngle && dist < lockedDist) {
      locked = building
      lockedDist = dist
    }
  }
  return locked ?? closest
}

function orderedTarget(unit: Unit, units: readonly Unit[]): Unit | null {
  if (unit.attackId === null) return null
  const target = units.find((other) => other.id === unit.attackId)
  if (!target || target.health <= 0 || target.ownerId === unit.ownerId) return null
  return target
}

function bearing(from: Unit, to: Unit): number {
  return Math.atan2(to.pos.x - from.pos.x, to.pos.z - from.pos.z)
}

function distance(from: Unit, to: Unit): number {
  return Math.hypot(to.pos.x - from.pos.x, to.pos.z - from.pos.z)
}
