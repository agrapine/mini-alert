const TOKEN = /^[a-f0-9]{32}$/
const SEAT_KEY = 'rts.seat'

type Store = Pick<Storage, 'getItem' | 'setItem'>

/**
 * The seat this browser plays. A `#token` link selects that seat and is cleared from the address bar,
 * so a copied page address does not hand the seat to someone else.
 * `?new=1` plays a fresh seat in that window and leaves the saved browser seat alone.
 */
export function seatToken(
  loc: { hash: string; search?: string } = location,
  store?: Store,
  clearLink: () => void = clearSeatLink,
  session?: Store,
): string {
  const linked = loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash
  if (TOKEN.test(linked)) {
    clearLink()
    saveSeat(linked, store)
    return linked
  }
  if (new URLSearchParams(loc.search ?? '').get('new') === '1') {
    const held = readSeat(session ?? sessionStorage)
    if (held) return held
    const fresh = randomToken()
    saveSeat(fresh, session ?? sessionStorage)
    return fresh
  }
  const saved = readSeat(store)
  if (saved) return saved
  const next = randomToken()
  saveSeat(next, store)
  return next
}

/** The address that opens the game as `seat`. The query stays behind, so visit flags such as `?admin=1` do not travel with it. */
export function seatLink(seat: string, loc: { origin: string; pathname: string } = location): string {
  return `${loc.origin}${loc.pathname}#${seat}`
}

function randomToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

function readSeat(store?: Store): string | null {
  try {
    const saved = (store ?? localStorage).getItem(SEAT_KEY)
    return saved && TOKEN.test(saved) ? saved : null
  } catch {
    return null
  }
}

function saveSeat(token: string, store?: Store) {
  try {
    ;(store ?? localStorage).setItem(SEAT_KEY, token)
  } catch {
    // Storage can throw in private mode or when it is full.
  }
}

function clearSeatLink() {
  history.replaceState(null, '', `${location.pathname}${location.search}`)
}
