import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import type { UnitSnapshot } from '../../../shared/protocol.ts'

export const DETAIL = 0.25

export type Part = {
  w: number
  h: number
  d: number
  x: number
  y: number
  z: number
  shade?: number
}

export function assemble(
  unit: UnitSnapshot,
  parts: readonly Part[],
  bodyHeight: number,
  span: number,
): Group {
  const panel = new MeshStandardMaterial({
    color: unit.color,
    roughness: 0.48,
    metalness: 0.22,
  })
  const detail = panel.clone()
  const group = new Group()
  for (const part of parts) {
    const shade = part.shade ?? 1
    const mesh = new Mesh(new BoxGeometry(part.w, part.h, part.d), shade === 1 ? panel : detail)
    mesh.position.set(part.x, part.y - bodyHeight / 2, part.z)
    if (shade !== 1) mesh.userData.shade = shade
    group.add(mesh)
  }
  group.userData.unitId = unit.id
  group.userData.bodyHeight = bodyHeight
  group.userData.span = span
  return group
}
