import type { ClientMessage, ClientPort, ServerMessage, ServerPort } from './protocol.ts'

export function createLocalLink(playerId: number): { client: ClientPort; server: ServerPort } {
  let onServer: ((message: ServerMessage) => void) | null = null
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
