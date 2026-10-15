export function instantBuilds(): boolean {
  const flag = process.env.INSTANT
  return flag === '1' || flag === 'true'
}
