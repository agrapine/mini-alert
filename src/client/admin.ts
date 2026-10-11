const ADMIN_KEY = 'rts.admin'

export function adminEnabled(search: string, store: Storage = sessionStorage): boolean {
  if (new URLSearchParams(search).get('admin') === '1') {
    try {
      store.setItem(ADMIN_KEY, '1')
    } catch {
      // This visit still counts as admin when storage is blocked.
    }
    return true
  }
  try {
    return store.getItem(ADMIN_KEY) === '1'
  } catch {
    return false
  }
}
