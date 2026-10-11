import type { UnitSnapshot } from '../../../shared/protocol.ts'
import { DETAIL, assemble, type Part } from './assemble.ts'

const SCALE = 0.5
const HEIGHT = 0.36 * SCALE

function fit(part: Part): Part {
  return {
    ...part,
    w: part.w * SCALE,
    h: part.h * SCALE,
    d: part.d * SCALE,
    x: part.x * SCALE,
    y: part.y * SCALE,
    z: part.z * SCALE,
  }
}

export function createScout(unit: UnitSnapshot) {
  const wheels = [-0.28, 0.28].flatMap((z) =>
    [-0.22, 0.22].map((x) =>
      fit({
        w: 0.12,
        h: 0.14,
        d: 0.14,
        x,
        y: 0.07,
        z,
        shade: DETAIL,
      }),
    ),
  )
  return assemble(
    unit,
    [
      ...wheels,
      fit({ w: 0.34, h: 0.12, d: 0.7, x: 0, y: 0.16, z: 0 }),
      fit({ w: 0.28, h: 0.12, d: 0.26, x: 0, y: 0.26, z: -0.06 }),
      fit({ w: 0.4, h: 0.05, d: 0.06, x: 0, y: 0.1, z: 0.38, shade: DETAIL }),
      fit({ w: 0.04, h: 0.04, d: 0.22, x: 0, y: 0.32, z: 0.18, shade: DETAIL }),
    ],
    HEIGHT,
    0.78 * SCALE,
  )
}
