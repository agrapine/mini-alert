import type { UnitSnapshot } from '../../../shared/protocol.ts'
import { DETAIL, assemble } from './assemble.ts'

const HEIGHT = 0.58

export function createHeavyTank(unit: UnitSnapshot) {
  return assemble(
    unit,
    [
      { w: 0.22, h: 0.24, d: 1.08, x: -0.44, y: 0.12, z: 0, shade: DETAIL },
      { w: 0.22, h: 0.24, d: 1.08, x: 0.44, y: 0.12, z: 0, shade: DETAIL },
      { w: 0.08, h: 0.1, d: 0.72, x: -0.3, y: 0.24, z: 0, shade: DETAIL },
      { w: 0.08, h: 0.1, d: 0.72, x: 0.3, y: 0.24, z: 0, shade: DETAIL },
      { w: 0.58, h: 0.2, d: 0.82, x: 0, y: 0.28, z: -0.02 },
      { w: 0.42, h: 0.18, d: 0.46, x: 0, y: 0.46, z: -0.04, turret: true },
      { w: 0.09, h: 0.09, d: 0.52, x: 0, y: 0.5, z: 0.38, shade: DETAIL, turret: true },
      { w: 0.16, h: 0.06, d: 0.16, x: 0, y: 0.56, z: -0.08, shade: DETAIL, turret: true },
    ],
    HEIGHT,
    1.1,
  )
}
