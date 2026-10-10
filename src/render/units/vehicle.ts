import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { TILE_TOP } from '../terrain.ts'
import { UNIT_TYPES } from '../../units/catalog.ts'
import { BodyKind, type UnitType } from '../../units/types.ts'
import type { Unit } from '../../units/unit.ts'

export function createUnitMesh(unit: Unit): Group {
  const type = UNIT_TYPES[unit.typeId]
  if (type.body === BodyKind.Mesh) return createVehicle(unit, type)
  throw new Error(`no view for body ${type.body}`)
}

export function syncUnitMesh(group: Group, unit: Unit, selected: boolean) {
  const bodyHeight = meshNumber(group, 'bodyHeight', 0.44)
  group.position.set(unit.pos.x, TILE_TOP + bodyHeight / 2, unit.pos.z)
  group.rotation.y = unit.facing
  group.traverse((obj) => {
    const material = obj instanceof Mesh ? obj.material : null
    if (material instanceof MeshStandardMaterial) {
      material.emissive.set(selected ? 0x3a2e10 : 0x000000)
      material.emissiveIntensity = selected ? 0.45 : 0
    }
  })
}

export function unitSpan(group: Group): number {
  return meshNumber(group, 'span', 0.7)
}

function createVehicle(unit: Unit, type: UnitType): Group {
  const hull = type.hull
  const hullMaterial = new MeshStandardMaterial({
    color: type.color,
    roughness: 0.42,
    metalness: 0.32,
  })
  const turretMaterial = hullMaterial.clone()
  turretMaterial.color.multiplyScalar(0.72)
  const body = new Mesh(new BoxGeometry(hull.x, hull.y, hull.z), hullMaterial)
  const turret = new Mesh(
    new BoxGeometry(hull.x * 0.55, hull.y * 0.5, hull.z * 0.42),
    turretMaterial,
  )
  turret.position.set(0, hull.y * 0.62, -hull.z * 0.04)
  const barrel = new Mesh(
    new BoxGeometry(hull.x * 0.16, hull.y * 0.22, hull.z * 0.4),
    turretMaterial,
  )
  barrel.position.set(0, hull.y * 0.62, hull.z * 0.38)
  const group = new Group()
  group.add(body, turret, barrel)
  group.userData.unitId = unit.id
  group.userData.bodyHeight = hull.y
  group.userData.span = Math.max(hull.x, hull.z)
  return group
}

function meshNumber(group: Group, key: string, fallback: number): number {
  const value = group.userData[key]
  return typeof value === 'number' ? value : fallback
}
