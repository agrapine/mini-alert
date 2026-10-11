import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clientFile, serveClient } from './static.ts'

describe('client files', () => {
  let root = ''

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'rts-client-'))
    writeFileSync(join(root, 'index.html'), '<!doctype html>')
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'assets', 'app.js'), 'export {}')
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('resolves files inside the client build', () => {
    expect(clientFile(root, '/')).toBe(join(root, 'index.html'))
    expect(clientFile(root, '/index.html')).toBe(join(root, 'index.html'))
    expect(clientFile(root, '/assets/app.js')).toBe(join(root, 'assets', 'app.js'))
    expect(clientFile(root, '/assets/app.js?v=1')).toBe(join(root, 'assets', 'app.js'))
  })

  it('rejects paths outside the client build', () => {
    expect(clientFile(root, '/../package.json')).toBeNull()
    expect(clientFile(root, '/assets/../../package.json')).toBeNull()
    expect(clientFile(root, '/%2e%2e/package.json')).toBeNull()
    expect(clientFile(root, '/%2e%2e%2fpackage.json')).toBeNull()
    expect(clientFile(root, '/..%5c..%5cpackage.json')).toBeNull()
    expect(clientFile(root, '/assets/app.js%00.html')).toBeNull()
    expect(clientFile(root, '/missing.js')).toBeNull()
    expect(clientFile(root, '/assets')).toBeNull()
  })

  it('serves the client over http', async () => {
    const server = createServer((req, res) => serveClient(root, req, res))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      const page = await fetch(`http://127.0.0.1:${port}/`)
      expect(page.status).toBe(200)
      expect(page.headers.get('content-type')).toContain('text/html')
      expect(await page.text()).toBe('<!doctype html>')
      const script = await fetch(`http://127.0.0.1:${port}/assets/app.js`)
      expect(script.status).toBe(200)
      expect(script.headers.get('content-type')).toContain('javascript')
      expect(await script.text()).toBe('export {}')
      const missing = await fetch(`http://127.0.0.1:${port}/missing.js`)
      expect(missing.status).toBe(404)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })
})
