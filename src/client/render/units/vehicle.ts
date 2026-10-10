import { Group, Mesh, MeshStandardMaterial } from 'three'
import type { UnitSnapshot } from '../../../shared/protocol.ts'
import { UnitTypeId } from '../../../shared/unit-types.ts'
import { TILE_TOP } from '../terrain.ts'
import { createHeavyTank } from './heavy-tank.ts'
import { createMedTank } from './med-tank.ts'
import { createScout } from './scout-car.ts'

export function createUnitMesh(unit: UnitSnapshot): Group {
  switch (unit.typeId) {
    case UnitTypeId.Scout:
      return createScout(unit)
    case UnitTypeId.MedTank:
      return createMedTank(unit)
    case UnitTypeId.HeavyTank:
      return createHeavyTank(unit)
  }
}

export function syncUnitMesh(group: Group, unit: UnitSnapshot, selected: boolean) {
  const bodyHeight = meshNumber(group, 'bodyHeight', 0.44)
  group.position.set(unit.x, TILE_TOP + bodyHeight / 2, unit.z)
  group.rotation.y = unit.facing
  group.traverse((obj) => {
    const material = obj instanceof Mesh ? obj.material : null
    if (!(material instanceof MeshStandardMaterial)) return
    const shade = typeof obj.userData.shade === 'number' ? obj.userData.shade : 1
    material.color.set(unit.color).multiplyScalar(shade)
    material.emissive.set(selected ? 0x3a2e10 : 0x000000)
    material.emissiveIntensity = selected ? 0.45 : 0
  })
}

export function unitSpan(group: Group): number {
  return meshNumber(group, 'span', 0.7)
}

function meshNumber(group: Group, key: string, fallback: number): number {
  const value = group.userData[key]
  return typeof value === 'number' ? value : fallback
}
