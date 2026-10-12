import { tileCenter, type TileCoord } from './tiles.ts'
import type { UnitType } from './unit-types.ts'

const ARRIVE = 0.38
const BEHIND = (Math.PI * 2) / 3

export const SIM_STEP = 1 / 30
export const MOTION_HEARTBEAT = 60
export const SNAPSHOT_GAP = 60
export const SNAPSHOT_COOLDOWN = 30
export const SNAP_DISTANCE = 0.5
export const KEEPALIVE_TICKS = 150

export const enum MotionResult {
  Moved = 0,
  Waiting = 1,
  Denied = 2,
}

export type MotionState = {
  x: number
  z: number
  facing: number
  speed: number
  tileX: number
  tileY: number
  path: TileCoord[]
}

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

export function timeScale(localTick: number, serverTick: number): number {
  const gap = serverTick - localTick
  if (gap < -2) return 0.5
  if (gap > 2) return Math.min(2, 1 + gap * 0.05)
  return 1
}

export function stepMotion(
  state: MotionState,
  type: UnitType,
  dt: number,
  occupied?: (x: number, y: number) => boolean,
): MotionResult {
  if (type.topSpeed <= 0) return MotionResult.Moved
  if (state.path.length > 0 && occupied?.(state.path[0].x, state.path[0].y)) {
    state.speed = approach(state.speed, 0, type.acceleration * dt)
    return MotionResult.Waiting
  }
  if (state.path.length === 0) state.speed = approach(state.speed, 0, type.acceleration * dt)
  else driveMotion(state, type, dt)
  const next = integrateMotion(state, dt)
  const enteredX = Math.floor(next.x)
  const enteredY = Math.floor(next.z)
  const changing = enteredX !== state.tileX || enteredY !== state.tileY
  if (changing && occupied?.(enteredX, enteredY)) {
    state.speed = 0
    return MotionResult.Denied
  }
  state.x = next.x
  state.z = next.z
  state.tileX = enteredX
  state.tileY = enteredY
  if (state.path.length > 0) consumePath(state)
  return MotionResult.Moved
}

export function driveMotion(state: MotionState, type: UnitType, dt: number): void {
  if (type.topSpeed <= 0 || state.path.length === 0) return
  if (type.wheelbase > 0) steerWheels(state, type, dt)
  else steerTracks(state, type, dt)
}

export function integrateMotion(state: MotionState, dt: number): { x: number; z: number } {
  const dist = state.speed * dt
  if (Math.abs(dist) < 1e-8) return { x: state.x, z: state.z }
  return {
    x: state.x + Math.sin(state.facing) * dist,
    z: state.z + Math.cos(state.facing) * dist,
  }
}

export function consumePath(state: MotionState): void {
  const dir = state.speed < -0.02 ? -1 : 1
  const hx = Math.sin(state.facing) * dir
  const hz = Math.cos(state.facing) * dir
  while (state.path.length > 0) {
    const center = tileCenter(state.path[0])
    const dx = center.x - state.x
    const dz = center.z - state.z
    const dist = Math.hypot(dx, dz)
    const ahead = dx * hx + dz * hz
    if (state.path.length === 1) {
      if (dist < ARRIVE && Math.abs(state.speed) < 0.85) state.path.shift()
      break
    }
    const onTile = Math.floor(state.x) === state.path[0].x && Math.floor(state.z) === state.path[0].y
    if (dist < 0.4 || (onTile && ahead < 0.15) || (ahead < -0.05 && dist < 0.85)) {
      state.path.shift()
      continue
    }
    break
  }
}

function steerTracks(state: MotionState, type: UnitType, dt: number): void {
  const aim = aimPoint(state)
  if (!aim) return
  const err = headingError(state, aim)
  const step = clamp(err, -type.turnRate * dt, type.turnRate * dt)
  state.facing = wrapAngle(state.facing + step)
  const limit = Math.abs(state.speed) > 0.15 ? 0.75 : 0.35
  const target = Math.abs(err) <= limit ? cruiseSpeed(state, type, 1) : 0
  state.speed = approach(state.speed, target, type.acceleration * dt)
}

function steerWheels(state: MotionState, type: UnitType, dt: number): void {
  const aim = aimPoint(state)
  if (!aim) return
  const desired = Math.atan2(aim.x - state.x, aim.z - state.z)
  const noseErr = wrapAngle(desired - state.facing)
  const reverse = Math.abs(noseErr) > BEHIND
  const moveHeading = state.speed < -0.02 ? wrapAngle(state.facing + Math.PI) : state.facing
  const err = wrapAngle(desired - moveHeading)
  const steerSign = state.speed < 0 ? -1 : 1
  const steer = clamp(err * steerSign, -type.maxSteer, type.maxSteer)
  if (Math.abs(state.speed) > 0.02) {
    const yaw = (state.speed / type.wheelbase) * Math.tan(steer)
    state.facing = wrapAngle(state.facing + yaw * dt)
  }
  state.speed = approach(state.speed, cruiseSpeed(state, type, reverse ? -1 : 1), type.acceleration * dt)
}

function aimPoint(state: MotionState): { x: number; z: number } | null {
  if (state.path.length === 0) return null
  let index = 0
  while (index < state.path.length - 1) {
    const prev = index === 0 ? { x: state.tileX, y: state.tileY } : state.path[index - 1]
    const curr = state.path[index]
    const next = state.path[index + 1]
    const same = curr.x - prev.x === next.x - curr.x && curr.y - prev.y === next.y - curr.y
    if (!same) break
    index++
  }
  return tileCenter(state.path[index])
}

function headingError(state: MotionState, aim: { x: number; z: number }): number {
  const desired = Math.atan2(aim.x - state.x, aim.z - state.z)
  return wrapAngle(desired - state.facing)
}

function cruiseSpeed(state: MotionState, type: UnitType, direction: number): number {
  const goal = state.path[state.path.length - 1]
  if (!goal) return 0
  const center = tileCenter(goal)
  const dist = Math.hypot(center.x - state.x, center.z - state.z)
  let mag = type.topSpeed
  const stopping = (state.speed * state.speed) / (2 * type.acceleration)
  if (dist < stopping + 0.2) mag = Math.min(mag, Math.max(0.45, dist * 1.6))
  return mag * direction
}
