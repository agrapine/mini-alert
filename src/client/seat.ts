const TOKEN = /^[a-f0-9]{32}$/

export function ensureSeatToken(
  loc: { hash: string } = location,
  write: (token: string) => void = writeSeatToken,
): string {
  const current = loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash
  if (TOKEN.test(current)) return current
  const next = randomToken()
  write(next)
  return next
}

export function holdSeatToken(token: string, loc: { hash: string } = location, write: (token: string) => void = writeSeatToken) {
  if (!TOKEN.test(token) || loc.hash === `#${token}`) return
  write(token)
}

export function randomToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

function writeSeatToken(token: string) {
  const next = `${location.pathname}${location.search}#${token}`
  history.replaceState(null, '', next)
}
