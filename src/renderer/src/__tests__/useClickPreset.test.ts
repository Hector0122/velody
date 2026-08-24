// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useClickPreset from '../hooks/useClickPreset'

describe('useClickPreset', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('defaults to pingpong when nothing is stored', () => {
    const { result } = renderHook(() => useClickPreset())
    expect(result.current[0]).toBe('pingpong')
  })

  it('falls back to the default for an invalid stored value', () => {
    window.localStorage.setItem('velody:clickPreset', JSON.stringify('not-a-preset'))
    const { result } = renderHook(() => useClickPreset())
    expect(result.current[0]).toBe('pingpong')
  })

  it('round-trips a selected preset through localStorage', () => {
    const { result, rerender } = renderHook(() => useClickPreset())

    act(() => {
      result.current[1]('rimclick')
    })
    expect(result.current[0]).toBe('rimclick')

    rerender()
    expect(window.localStorage.getItem('velody:clickPreset')).toBe(JSON.stringify('rimclick'))
  })
})
