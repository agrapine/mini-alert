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
  tint?: number
  turret?: boolean
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
  const group = new Group()
  const turret = new Group()
  turret.name = 'turret'
  for (const part of parts) {
    const shade = part.shade ?? 1
    const material = part.tint !== undefined || shade !== 1 ? panel.clone() : panel
    const mesh = new Mesh(new BoxGeometry(part.w, part.h, part.d), material)
    mesh.position.set(part.x, part.y - bodyHeight / 2, part.z)
    if (part.tint !== undefined) mesh.userData.tint = part.tint
    else if (shade !== 1) mesh.userData.shade = shade
    if (part.turret) turret.add(mesh)
    else group.add(mesh)
  }
  if (turret.children.length > 0) group.add(turret)
  group.userData.unitId = unit.id
  group.userData.bodyHeight = bodyHeight
  group.userData.span = span
  return group
}
