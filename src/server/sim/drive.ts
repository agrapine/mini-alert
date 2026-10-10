export function wrapAngle(angle: number): number {
  const turn = Math.PI * 2
  let wrapped = angle % turn
  if (wrapped > Math.PI) wrapped -= turn
  if (wrapped < -Math.PI) wrapped += turn
  return wrapped
}

export function approach(current: number, target: number, maxDelta: number): number {
  const delta = target - current
  if (Math.abs(delta) <= maxDelta) return target
  return current + Math.sign(delta) * maxDelta
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
