import type { UnitSnapshot } from '../../../shared/protocol.ts'
import { buildStage } from '../../../shared/unit-types.ts'
import { type Part, assemble } from './assemble.ts'

const PAD = 0x6b6558
const PEDESTAL = 0x4a4038
const BARREL = 0x2a2e2c

export function createTurret(unit: UnitSnapshot) {
  const stage = buildStage(unit.progress)
  const height = stage >= 2 ? 0.62 : stage === 1 ? 0.4 : 0.12
  const group = assemble(unit, turretParts(stage), height, 0.9)
  group.userData.stage = stage
  return group
}

function turretParts(stage: number): Part[] {
  const parts: Part[] = [
    { w: 0.72, h: 0.08, d: 0.72, x: 0, y: 0.04, z: 0, tint: PAD },
    { w: 0.28, h: 0.08, d: 0.9, x: 0, y: 0.05, z: 0, tint: PAD },
    { w: 0.9, h: 0.08, d: 0.28, x: 0, y: 0.05, z: 0, tint: PAD },
  ]
  if (stage === 0) return parts
  parts.push({ w: 0.42, h: 0.28, d: 0.42, x: 0, y: 0.22, z: 0, tint: PEDESTAL })
  if (stage === 1) return parts
  parts.push({ w: 0.36, h: 0.2, d: 0.36, x: 0, y: 0.46, z: 0, turret: true })
  if (stage === 2) return parts
  parts.push({ w: 0.08, h: 0.08, d: 0.55, x: 0, y: 0.48, z: 0.4, tint: BARREL, turret: true })
  return parts
}
