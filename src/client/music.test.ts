import { describe, expect, it } from 'vitest'
import { BATTLE } from './music.ts'

describe('music', () => {
  it('rotates every track but the lobby ones through a match', () => {
    expect(BATTLE.map((url) => url.split('/').pop()).sort()).toEqual(['cymbal1.mp3', 'final-countdown.mp3', 'vroom-vroom-tancul.mp3'])
  })
})
