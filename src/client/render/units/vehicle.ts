import {
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  type Material,
} from 'three'
import type { UnitSnapshot } from '../../../shared/protocol.ts'
import { UNIT_TYPES, UnitTypeId, Locomotion } from '../../../shared/unit-types.ts'
import { PITCH, cameraYaw } from '../stage.ts'
import { TILE_TOP } from '../terrain.ts'
import { createArtillery } from './artillery.ts'
import { createAirport, createCruiser, createGunship, createHelipad, createJet, createShipyard } from './craft.ts'
import { createFactory } from './factory.ts'
import { createHeavyTank } from './heavy-tank.ts'
import { createMedTank } from './med-tank.ts'
import { createScout } from './scout-car.ts'
import { createTurret } from './turret.ts'

export function createUnitMesh(unit: UnitSnapshot): Group {
  const group = meshFor(unit)
  addHealthBar(group, UNIT_TYPES[unit.typeId].maxHealth)
  const weapon = UNIT_TYPES[unit.typeId].weapon
  if (weapon.magazine > 1 && (UNIT_TYPES[unit.typeId].locomotion === Locomotion.Plane || UNIT_TYPES[unit.typeId].locomotion === Locomotion.Rotor)) {
    addAmmoBar(group)
  }
  return group
}

function meshFor(unit: UnitSnapshot): Group {
  switch (unit.typeId) {
    case UnitTypeId.Scout:
      return createScout(unit)
    case UnitTypeId.MedTank:
      return createMedTank(unit)
    case UnitTypeId.HeavyTank:
      return createHeavyTank(unit)
    case UnitTypeId.Artillery:
      return createArtillery(unit)
    case UnitTypeId.Factory:
      return createFactory(unit)
    case UnitTypeId.Turret:
      return createTurret(unit)
    case UnitTypeId.Jet:
      return createJet(unit)
    case UnitTypeId.Gunship:
      return createGunship(unit)
    case UnitTypeId.Cruiser:
      return createCruiser(unit)
    case UnitTypeId.Airport:
      return createAirport(unit)
    case UnitTypeId.Helipad:
      return createHelipad(unit)
    case UnitTypeId.Shipyard:
      return createShipyard(unit)
  }
}

export function syncUnitMesh(group: Group, unit: UnitSnapshot, selected: boolean, showBars = true) {
  const bodyHeight = meshNumber(group, 'bodyHeight', 0.44)
  group.position.set(unit.x, TILE_TOP + lift(unit) + bodyHeight / 2, unit.z)
  group.rotation.y = unit.facing
  const turret = group.getObjectByName('turret')
  if (turret) turret.rotation.y = wrapAngle(unit.turretYaw - unit.facing)
  syncHealthBar(group, unit, showBars)
  syncAmmoBar(group, unit, selected && showBars)
  if (group.userData.paint === unit.color && group.userData.selected === selected) return
  group.userData.paint = unit.color
  group.userData.selected = selected
  group.traverse((obj) => {
    if (obj.userData.healthBar) return
    const material = obj instanceof Mesh ? obj.material : null
    if (!(material instanceof MeshStandardMaterial)) return
    if (typeof obj.userData.tint === 'number') material.color.set(obj.userData.tint)
    else {
      const shade = typeof obj.userData.shade === 'number' ? obj.userData.shade : 1
      material.color.set(unit.color).multiplyScalar(shade)
    }
    material.emissive.set(selected ? 0x3a2e10 : 0x000000)
    material.emissiveIntensity = selected ? 0.45 : 0
  })
}

function lift(unit: UnitSnapshot): number {
  const type = UNIT_TYPES[unit.typeId]
  if (type.locomotion === Locomotion.Rotor || type.locomotion === Locomotion.Plane) return unit.altitude ?? 0
  if (type.locomotion === Locomotion.Hull) return -0.06
  return 0
}

export function unitSpan(group: Group): number {
  return meshNumber(group, 'span', 0.7)
}

export function scorchUnit(group: Group) {
  const bar = group.getObjectByName('health-bar')
  if (bar) {
    bar.removeFromParent()
    releaseMesh(bar)
  }
  const ammo = group.getObjectByName('ammo-bar')
  if (ammo) {
    ammo.removeFromParent()
    releaseMesh(ammo)
  }
  group.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    const material = obj.material
    if (!(material instanceof MeshStandardMaterial)) return
    material.color.set(0x111111)
    material.emissive.set(0x000000)
    material.emissiveIntensity = 0
    material.roughness = 0.92
    material.metalness = 0.04
  })
}

export function releaseMesh(root: Object3D) {
  root.removeFromParent()
  const materials = new Set<Material>()
  const geometries = new Set<BufferGeometry>()
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    geometries.add(obj.geometry)
    const list = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const material of list) materials.add(material)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}

function meshNumber(group: Group, key: string, fallback: number): number {
  const value = group.userData[key]
  return typeof value === 'number' ? value : fallback
}

function addHealthBar(group: Group, maxHealth: number) {
  const span = meshNumber(group, 'span', 0.7)
  const bodyHeight = meshNumber(group, 'bodyHeight', 0.44)
  const width = span < 0.7 ? span * 0.9 : Math.max(0.72, span * 0.55)
  const height = 0.09
  const bar = new Group()
  bar.name = 'health-bar'
  bar.position.y = bodyHeight / 2 + Math.min(0.22, bodyHeight * 0.65)
  const back = new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ color: 0x1a1c14, side: DoubleSide }),
  )
  back.userData.healthBar = true
  const fill = new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ color: 0x7dce4a, side: DoubleSide }),
  )
  fill.name = 'health-fill'
  fill.position.z = 0.01
  fill.userData.healthBar = true
  fill.userData.barWidth = width
  bar.add(back, fill)
  group.add(bar)
  group.userData.maxHealth = maxHealth
}

function addAmmoBar(group: Group) {
  const span = meshNumber(group, 'span', 0.7)
  const bodyHeight = meshNumber(group, 'bodyHeight', 0.44)
  const width = span < 0.7 ? span * 0.9 : Math.max(0.72, span * 0.55)
  const height = 0.045
  const bar = new Group()
  bar.name = 'ammo-bar'
  bar.position.y = -bodyHeight / 2 - 0.08
  const back = new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ color: 0x1a1c14, side: DoubleSide }),
  )
  back.userData.healthBar = true
  const fill = new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ color: 0xe6c15a, side: DoubleSide }),
  )
  fill.name = 'ammo-fill'
  fill.position.z = 0.01
  fill.userData.healthBar = true
  fill.userData.barWidth = width
  bar.add(back, fill)
  group.add(bar)
}

function syncAmmoBar(group: Group, unit: UnitSnapshot, show: boolean) {
  const bar = group.getObjectByName('ammo-bar')
  if (!bar) return
  const magazine = UNIT_TYPES[unit.typeId].weapon.magazine
  bar.visible = show && magazine > 1
  if (!bar.visible) return
  bar.rotation.set(0, 0, 0)
  bar.rotateY(cameraYaw - unit.facing)
  bar.rotateX(-PITCH)
  const fill = group.getObjectByName('ammo-fill')
  if (!(fill instanceof Mesh)) return
  const rounds = unit.rounds ?? magazine
  const ratio = magazine <= 0 ? 0 : Math.max(0, Math.min(1, rounds / magazine))
  const width = typeof fill.userData.barWidth === 'number' ? fill.userData.barWidth : 0.72
  fill.scale.x = Math.max(ratio, 0.001)
  fill.position.x = ((ratio - 1) * width) / 2
}

function syncHealthBar(group: Group, unit: UnitSnapshot, show: boolean) {
  const bar = group.getObjectByName('health-bar')
  if (bar) bar.visible = show
  if (!show || !bar) return
  bar.rotation.set(0, 0, 0)
  bar.rotateY(cameraYaw - unit.facing)
  bar.rotateX(-PITCH)
  const fill = group.getObjectByName('health-fill')
  if (!(fill instanceof Mesh)) return
  const building = unit.progress < 1
  const maxHealth = meshNumber(group, 'maxHealth', unit.health)
  const ratio = building ? unit.progress : maxHealth <= 0 ? 0 : Math.max(0, Math.min(1, unit.health / maxHealth))
  const width = typeof fill.userData.barWidth === 'number' ? fill.userData.barWidth : 0.72
  fill.scale.x = Math.max(ratio, 0.001)
  fill.position.x = ((ratio - 1) * width) / 2
  const material = fill.material
  if (material instanceof MeshBasicMaterial) {
    material.color.set(building ? 0xe0a040 : ratio > 0.35 ? 0x7dce4a : 0xd64545)
  }
}

function wrapAngle(angle: number): number {
  const turn = Math.PI * 2
  let wrapped = angle % turn
  if (wrapped > Math.PI) wrapped -= turn
  if (wrapped < -Math.PI) wrapped += turn
  return wrapped
}
