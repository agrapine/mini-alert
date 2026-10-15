import { afterEach, describe, expect, it, vi } from 'vitest'
import { BATTLE, Music } from './music.ts'

class FakeAudio {
  static made: FakeAudio[] = []
  volume = 1

  constructor() {
    FakeAudio.made.push(this)
  }

  addEventListener() {}
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeAudio.made = []
})

describe('music', () => {
  it('rotates every track but the lobby ones through a match', () => {
    expect(BATTLE.map((url) => url.split('/').pop()).sort()).toEqual(['cymbal1.mp3', 'final-countdown.mp3', 'vroom-vroom-tancul.mp3'])
  })

  it('plays at the Music volume', () => {
    vi.stubGlobal('Audio', FakeAudio)
    new Music().setVolume(0.25)
    expect(FakeAudio.made[0].volume).toBe(0.25)
  })
})
