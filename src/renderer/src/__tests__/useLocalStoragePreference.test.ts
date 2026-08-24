// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useLocalStoragePreference from '../hooks/useLocalStoragePreference'

const isNumber = (v: unknown): v is number => typeof v === 'number'

describe('useLocalStoragePreference', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('returns the default when nothing is stored', () => {
    const { result } = renderHook(() => useLocalStoragePreference('test:pref', 5, isNumber))
    expect(result.current[0]).toBe(5)
  })

  it('loads a previously stored value', () => {
    window.localStorage.setItem('test:pref', JSON.stringify(42))
    const { result } = renderHook(() => useLocalStoragePreference('test:pref', 5, isNumber))
    expect(result.current[0]).toBe(42)
  })

  it('falls back to the default when the stored value fails validation', () => {
    window.localStorage.setItem('test:pref', JSON.stringify('not-a-number'))
    const { result } = renderHook(() => useLocalStoragePreference('test:pref', 5, isNumber))
    expect(result.current[0]).toBe(5)
  })

  it('falls back to the default when the stored value is corrupted JSON', () => {
    window.localStorage.setItem('test:pref', '{not valid json')
    const { result } = renderHook(() => useLocalStoragePreference('test:pref', 5, isNumber))
    expect(result.current[0]).toBe(5)
  })

  it('setting a value updates state and persists it', () => {
    const { result } = renderHook(() => useLocalStoragePreference('test:pref', 5, isNumber))

    act(() => {
      result.current[1](99)
    })

    expect(result.current[0]).toBe(99)
    expect(window.localStorage.getItem('test:pref')).toBe('99')
  })
})
