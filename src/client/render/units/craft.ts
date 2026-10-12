import type { UnitSnapshot } from '../../../shared/protocol.ts'
import { buildStage } from '../../../shared/unit-types.ts'
import { assemble, type Part } from './assemble.ts'

const STEEL = 0x4e564c
const DARK = 0x2a3028
const CONCRETE = 0x8a8474
const GLASS = 0x1c2830

export function createJet(unit: UnitSnapshot) {
  return assemble(
    unit,
    [
      { w: 0.16, h: 0.1, d: 0.86, x: 0, y: 0.12, z: 0 },
      { w: 0.78, h: 0.04, d: 0.22, x: 0, y: 0.12, z: 0.02, shade: 0.8 },
      { w: 0.22, h: 0.04, d: 0.16, x: 0, y: 0.16, z: -0.28, shade: 0.75 },
      { w: 0.1, h: 0.08, d: 0.16, x: 0, y: 0.18, z: 0.12, tint: GLASS },
      { w: 0.04, h: 0.04, d: 0.28, x: 0.32, y: 0.08, z: 0.04, tint: 0xe4e0d4 },
      { w: 0.04, h: 0.04, d: 0.28, x: -0.32, y: 0.08, z: 0.04, tint: 0xe4e0d4 },
    ],
    0.22,
    0.9,
  )
}

export function createGunship(unit: UnitSnapshot) {
  return assemble(
    unit,
    [
      { w: 0.28, h: 0.16, d: 0.62, x: 0, y: 0.16, z: 0 },
      { w: 0.08, h: 0.08, d: 0.42, x: 0, y: 0.2, z: -0.48, shade: 0.75 },
      { w: 0.46, h: 0.03, d: 0.08, x: 0, y: 0.32, z: 0.02, shade: 0.55 },
      { w: 0.04, h: 0.14, d: 0.04, x: 0, y: 0.28, z: 0.02, shade: 0.7 },
      { w: 0.36, h: 0.04, d: 0.1, x: 0, y: 0.14, z: 0.08, shade: 0.8, turret: true },
    ],
    0.36,
    0.7,
  )
}

export function createCruiser(unit: UnitSnapshot) {
  return assemble(
    unit,
    [
      { w: 0.42, h: 0.16, d: 1.2, x: 0, y: 0.1, z: 0, tint: 0x3d4a44 },
      { w: 0.28, h: 0.18, d: 0.36, x: 0, y: 0.26, z: -0.12, shade: 0.85 },
      { w: 0.12, h: 0.22, d: 0.12, x: 0, y: 0.28, z: 0.28, turret: true },
      { w: 0.04, h: 0.04, d: 0.28, x: 0, y: 0.4, z: 0.42, shade: 0.6, turret: true },
    ],
    0.42,
    1.2,
  )
}

export function createAirport(unit: UnitSnapshot) {
  const stage = buildStage(unit.progress)
  const parts: Part[] = [{ w: 1.55, h: 0.08, d: 3.55, x: 0, y: 0.04, z: 0, tint: CONCRETE }]
  if (stage > 0) {
    parts.push(
      { w: 0.08, h: 0.02, d: 3.15, x: 0, y: 0.09, z: 0, tint: 0xe4e0d4 },
      { w: 0.55, h: 0.02, d: 0.1, x: 0, y: 0.09, z: 1.15, tint: 0xe4e0d4 },
      { w: 0.55, h: 0.02, d: 0.1, x: 0, y: 0.09, z: -1.15, tint: 0xe4e0d4 },
    )
  }
  if (stage > 1) {
    parts.push(
      { w: 0.28, h: 0.55, d: 0.28, x: 0.95, y: 0.32, z: -1.35, tint: STEEL },
      { w: 0.42, h: 0.08, d: 0.42, x: 0.95, y: 0.62, z: -1.35, tint: DARK },
    )
  }
  if (stage > 2) parts.push({ w: 0.16, h: 0.1, d: 0.16, x: 0.95, y: 0.72, z: -1.35, tint: GLASS })
  const group = assemble(unit, parts, stage === 0 ? 0.12 : 0.8, 3.6)
  group.userData.stage = stage
  return group
}

export function createHelipad(unit: UnitSnapshot) {
  const stage = buildStage(unit.progress)
  const parts: Part[] = [{ w: 0.9, h: 0.08, d: 0.9, x: 0, y: 0.04, z: 0, tint: CONCRETE }]
  if (stage > 0) {
    parts.push(
      { w: 0.08, h: 0.02, d: 0.42, x: 0, y: 0.09, z: 0, tint: 0xd8d2c2 },
      { w: 0.28, h: 0.02, d: 0.08, x: 0, y: 0.09, z: 0, tint: 0xd8d2c2 },
    )
  }
  if (stage > 1) parts.push({ w: 0.16, h: 0.28, d: 0.16, x: 0.3, y: 0.22, z: 0.3, tint: STEEL })
  if (stage > 2) parts.push({ w: 0.22, h: 0.04, d: 0.22, x: 0.3, y: 0.38, z: 0.3, tint: DARK })
  const group = assemble(unit, parts, stage > 1 ? 0.42 : 0.12, 0.9)
  group.userData.stage = stage
  return group
}

export function createShipyard(unit: UnitSnapshot) {
  const stage = buildStage(unit.progress)
  const parts: Part[] = [
    { w: 1.7, h: 0.1, d: 0.55, x: 0, y: 0.05, z: 0.45, tint: CONCRETE },
    { w: 1.5, h: 0.08, d: 0.9, x: 0, y: 0.02, z: -0.3, tint: 0x2a3a34 },
  ]
  if (stage > 0) parts.push({ w: 0.12, h: 0.7, d: 0.12, x: -0.7, y: 0.4, z: 0.4, tint: STEEL })
  if (stage > 1) parts.push({ w: 0.9, h: 0.08, d: 0.08, x: -0.2, y: 0.72, z: 0.4, tint: STEEL })
  if (stage > 2) parts.push({ w: 0.16, h: 0.16, d: 0.16, x: 0.2, y: 0.62, z: 0.4, tint: DARK })
  const group = assemble(unit, parts, stage > 0 ? 0.8 : 0.16, 1.8)
  group.userData.stage = stage
  return group
}
