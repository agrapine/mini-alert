export const ROCKET_SPEED = 28
export const ROCKET_ACCEL = 42

export function flightTime(distance: number, speed: number, accel: number): number {
  if (distance <= 0) return 0
  if (accel <= 0) return distance / Math.max(speed, 0.01)
  const disc = speed * speed + 2 * accel * distance
  return (-speed + Math.sqrt(Math.max(0, disc))) / accel
}

export function flightProgress(age: number, flight: number, speed: number, accel: number): number {
  if (flight <= 0) return 1
  const t = Math.min(Math.max(0, age), flight)
  if (accel <= 0) return t / flight
  const total = speed * flight + 0.5 * accel * flight * flight
  if (total <= 0) return 1
  return Math.min(1, (speed * t + 0.5 * accel * t * t) / total)
}
