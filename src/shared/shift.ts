export const SHIFT_ZERO = 0x88
export const SHIFT_LIMIT = 7 / 16

export function encodeShift(x: number, y: number): number {
  return (nibble(x) << 4) | nibble(y)
}

export function decodeShift(byte: number): { x: number; y: number } {
  return { x: ((clampNibble(byte >> 4) - 8) / 16), y: ((clampNibble(byte) - 8) / 16) }
}

export function tileVertex(x: number, y: number, byte: number): { x: number; y: number } {
  const shift = decodeShift(byte)
  return { x: x + 0.5 + shift.x, y: y + 0.5 + shift.y }
}

export function encodeVertex(tx: number, ty: number, x: number, y: number): number {
  const inset = 1 / 16
  const cx = Math.min(tx + 1 - inset, Math.max(tx + inset, x))
  const cy = Math.min(ty + 1 - inset, Math.max(ty + inset, y))
  return encodeShift(cx - (tx + 0.5), cy - (ty + 0.5))
}

function nibble(delta: number): number {
  const steps = Math.round(delta * 16)
  return Math.max(-7, Math.min(7, steps)) + 8
}

function clampNibble(value: number): number {
  const bits = value & 15
  return Math.max(1, Math.min(15, bits))
}
