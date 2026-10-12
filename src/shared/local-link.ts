import type { ClientMessage, ClientPort, ServerFrame, ServerPort } from './protocol.ts'

export function createLocalLink(playerId: number): { client: ClientPort; server: ServerPort } {
  let onServer: ((message: ServerFrame) => void) | null = null
  let onClient: ((message: ClientMessage) => void) | null = null

  return {
    client: {
      send(message) {
        onClient?.(message)
      },
      onServer(handler) {
        onServer = handler
      },
    },
    server: {
      playerId,
      send(message) {
        onServer?.(message)
      },
      onClient(handler) {
        onClient = handler
      },
    },
  }
}
