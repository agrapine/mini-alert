import type { UnitSnapshot } from '../../../shared/protocol.ts'
import { DETAIL, assemble } from './assemble.ts'

const HEIGHT = 0.38

export function createArtillery(unit: UnitSnapshot) {
  return assemble(
    unit,
    [
      { w: 0.12, h: 0.14, d: 0.62, x: -0.24, y: 0.07, z: -0.02, shade: DETAIL },
      { w: 0.12, h: 0.14, d: 0.62, x: 0.24, y: 0.07, z: -0.02, shade: DETAIL },
      { w: 0.34, h: 0.12, d: 0.48, x: 0, y: 0.16, z: -0.06 },
      { w: 0.2, h: 0.1, d: 0.2, x: 0, y: 0.26, z: -0.1, turret: true },
      { w: 0.045, h: 0.045, d: 1.05, x: 0, y: 0.3, z: 0.46, shade: DETAIL, turret: true },
    ],
    HEIGHT,
    1.15,
  )
}
