import type { UnitSnapshot } from '../../../shared/protocol.ts'
import { buildStage } from '../../../shared/unit-types.ts'
import { type Part, assemble } from './assemble.ts'

const CONCRETE = 0x8a8474
const STEEL = 0x4e564c
const WALL = 0x3c433c
const WINDOW = 0x1c201c

export function createFactory(unit: UnitSnapshot) {
  const stage = buildStage(unit.progress)
  const height = stage === 0 ? 0.12 : stage === 1 ? 0.52 : stage === 2 ? 0.86 : 1.16
  const group = assemble(unit, factoryParts(stage), height, 1.8)
  group.userData.stage = stage
  return group
}

function factoryParts(stage: number): Part[] {
  const parts: Part[] = [{ w: 1.8, h: 0.08, d: 1.8, x: 0, y: 0.04, z: 0, tint: CONCRETE }]
  if (stage === 0) return parts
  const posts = [
    [-0.78, -0.78],
    [0.78, -0.78],
    [-0.78, 0.78],
    [0.78, 0.78],
  ]
  for (const [x, z] of posts) {
    parts.push({ w: 0.16, h: 0.4, d: 0.16, x, y: 0.26, z, tint: STEEL })
  }
  parts.push(
    { w: 1.56, h: 0.18, d: 0.1, x: 0, y: 0.16, z: -0.8, tint: STEEL },
    { w: 0.1, h: 0.18, d: 1.4, x: -0.8, y: 0.16, z: 0, tint: STEEL },
    { w: 0.1, h: 0.18, d: 1.4, x: 0.8, y: 0.16, z: 0, tint: STEEL },
    { w: 1.4, h: 0.06, d: 0.08, x: 0, y: 0.24, z: 0.82 },
  )
  if (stage === 1) return parts
  parts.push(
    { w: 1.64, h: 0.55, d: 0.12, x: 0, y: 0.48, z: -0.82, tint: WALL },
    { w: 0.12, h: 0.55, d: 1.5, x: -0.82, y: 0.48, z: -0.05, tint: WALL },
    { w: 0.12, h: 0.55, d: 1.5, x: 0.82, y: 0.48, z: -0.05, tint: WALL },
    { w: 0.5, h: 0.55, d: 0.12, x: -0.55, y: 0.48, z: 0.82, tint: WALL },
    { w: 0.5, h: 0.55, d: 0.12, x: 0.55, y: 0.48, z: 0.82, tint: WALL },
  )
  if (stage === 2) return parts
  parts.push(
    { w: 1.92, h: 0.1, d: 1.92, x: 0, y: 0.86, z: 0, tint: WALL },
    { w: 0.22, h: 0.28, d: 0.22, x: 0.48, y: 1.04, z: -0.42, tint: STEEL },
    { w: 0.52, h: 0.08, d: 0.08, x: 0, y: 0.7, z: 0.9 },
    { w: 0.08, h: 0.62, d: 0.08, x: -0.22, y: 0.38, z: 0.9 },
    { w: 0.08, h: 0.62, d: 0.08, x: 0.22, y: 0.38, z: 0.9 },
    { w: 0.28, h: 0.16, d: 0.06, x: 0.55, y: 0.52, z: 0.9, tint: WINDOW },
  )
  return parts
}
