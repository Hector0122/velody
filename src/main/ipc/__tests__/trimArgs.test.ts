import { describe, it, expect } from 'vitest'
// Importing handlers.ts outside Electron's runtime is safe here — see the
// comment in scanSongsLibrary.test.ts; these two functions are pure and
// never touch the electron/fs bindings.
import { trimInputArgs, trimOutputArgs } from '../handlers'

describe('trimInputArgs', () => {
  it('returns no args when trimStart is undefined, 0, or negative', () => {
    expect(trimInputArgs(undefined)).toEqual([])
    expect(trimInputArgs(0)).toEqual([])
    expect(trimInputArgs(-5)).toEqual([])
  })

  it('returns -ss <trimStart> when trimStart is positive', () => {
    expect(trimInputArgs(12.5)).toEqual(['-ss', '12.5'])
  })
})

describe('trimOutputArgs', () => {
  it('returns no args when trimEnd is undefined or null', () => {
    expect(trimOutputArgs(10, undefined)).toEqual([])
    expect(trimOutputArgs(10, null as unknown as number)).toEqual([])
  })

  it('returns -t <duration> (trimEnd - trimStart) when trimEnd is set', () => {
    expect(trimOutputArgs(10, 40)).toEqual(['-t', '30'])
  })

  it('treats a missing trimStart as 0 when computing duration', () => {
    expect(trimOutputArgs(undefined, 25)).toEqual(['-t', '25'])
  })

  it('clamps to 0 rather than emitting a negative duration for an inverted range', () => {
    expect(trimOutputArgs(40, 10)).toEqual(['-t', '0'])
  })
})
