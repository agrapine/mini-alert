import type { UnitSnapshot } from '../../../shared/protocol.ts'
import { DETAIL, assemble } from './assemble.ts'

const HEIGHT = 0.36

export function createScout(unit: UnitSnapshot) {
  const wheels = [-0.28, 0.28].flatMap((z) =>
    [-0.22, 0.22].map((x) => ({
      w: 0.12,
      h: 0.14,
      d: 0.14,
      x,
      y: 0.07,
      z,
      shade: DETAIL,
    })),
  )
  return assemble(
    unit,
    [
      ...wheels,
      { w: 0.34, h: 0.12, d: 0.7, x: 0, y: 0.16, z: 0 },
      { w: 0.28, h: 0.12, d: 0.26, x: 0, y: 0.26, z: -0.06 },
      { w: 0.4, h: 0.05, d: 0.06, x: 0, y: 0.1, z: 0.38, shade: DETAIL },
      { w: 0.04, h: 0.04, d: 0.22, x: 0, y: 0.32, z: 0.18, shade: DETAIL },
    ],
    HEIGHT,
    0.78,
  )
}
