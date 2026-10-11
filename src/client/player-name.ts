const NAME_KEY = 'rts-player-name'
const NAME_LIMIT = 16

export function rememberedName(session: Storage = sessionStorage, local: Storage = localStorage): string | null {
  return read(session) ?? read(local)
}

export function rememberName(name: string, session: Storage = sessionStorage, local: Storage = localStorage) {
  const clean = cleanName(name)
  if (!clean) return
  write(session, clean)
  write(local, clean)
}

function read(store: Storage): string | null {
  try {
    const value = store.getItem(NAME_KEY)
    return typeof value === 'string' ? cleanName(value) : null
  } catch {
    return null
  }
}

function write(store: Storage, name: string) {
  try {
    store.setItem(NAME_KEY, name)
  } catch {
    // Storage can throw in private mode or when it is full.
  }
}

function cleanName(value: string): string | null {
  const name = value.trim().slice(0, NAME_LIMIT)
  return name.length > 0 ? name : null
}
