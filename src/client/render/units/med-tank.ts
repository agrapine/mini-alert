import type { UnitSnapshot } from '../../../shared/protocol.ts'
import { DETAIL, assemble } from './assemble.ts'

const HEIGHT = 0.46

export function createMedTank(unit: UnitSnapshot) {
  return assemble(
    unit,
    [
      { w: 0.16, h: 0.2, d: 0.92, x: -0.34, y: 0.1, z: 0, shade: DETAIL },
      { w: 0.16, h: 0.2, d: 0.92, x: 0.34, y: 0.1, z: 0, shade: DETAIL },
      { w: 0.5, h: 0.16, d: 0.7, x: 0, y: 0.2, z: -0.02 },
      { w: 0.46, h: 0.08, d: 0.18, x: 0, y: 0.16, z: 0.36 },
      { w: 0.32, h: 0.14, d: 0.34, x: 0, y: 0.34, z: -0.04 },
      { w: 0.07, h: 0.07, d: 0.34, x: 0, y: 0.36, z: 0.28, shade: DETAIL },
    ],
    HEIGHT,
    0.92,
  )
}
