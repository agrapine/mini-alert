import { createReadStream, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export function serveClient(root: string, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('method not allowed')
    return
  }
  const file = clientFile(root, req.url ?? '/')
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  let size = 0
  try {
    size = statSync(file).size
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': size,
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(file)
  stream.on('error', () => {
    res.destroy()
  })
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

export function clientFile(root: string, url: string): string | null {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname)
  } catch {
    return null
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return null
  const base = resolve(root)
  const file = resolve(base, pathname.slice(1))
  if (!inside(base, file)) return null
  return readable(base, file, true)
}

function readable(root: string, file: string, allowIndex: boolean): string | null {
  let stat
  try {
    stat = statSync(file)
  } catch {
    return null
  }
  if (stat.isFile()) return file
  if (!stat.isDirectory() || !allowIndex) return null
  const index = join(file, 'index.html')
  if (!inside(root, index)) return null
  return readable(root, index, false)
}

function inside(root: string, file: string): boolean {
  const base = resolve(root)
  const prefix = base.endsWith(sep) ? base : base + sep
  const target = resolve(file)
  return target === base || target.startsWith(prefix)
}
