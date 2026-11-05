// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import DeleteSongDialog from '../components/DeleteSongDialog'
import { formatBytes, songCloudActions } from '../utils'

describe('songCloudActions', () => {
  it('offers only the plain delete while cloud sync is off', () => {
    expect(songCloudActions({})).toEqual(['delete'])
  })

  it('offers upload for local-only, download for cloud-only, delete for all', () => {
    expect(songCloudActions({ sync: 'local' })).toEqual(['upload', 'delete'])
    expect(songCloudActions({ sync: 'cloud' })).toEqual(['download', 'delete'])
    expect(songCloudActions({ sync: 'synced' })).toEqual(['delete'])
  })
})

describe('formatBytes', () => {
  it('formats sizes for humans', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(3.8 * 1024 * 1024)).toBe('3.8 MB')
    expect(formatBytes(2.2 * 1024 ** 3)).toBe('2.2 GB')
  })
})

describe('DeleteSongDialog', () => {
  afterEach(cleanup)

  const renderDialog = (
    sync?: 'local' | 'cloud' | 'synced'
  ): { onConfirm: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn> } => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(createElement(DeleteSongDialog, { songName: 'Song', sync, onConfirm, onCancel }))
    return { onConfirm, onCancel }
  }

  it('cancel triggers no delete', () => {
    const { onConfirm, onCancel } = renderDialog('synced')
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('synced: "Remove from this laptop" is a single click', () => {
    const { onConfirm } = renderDialog('synced')
    fireEvent.click(screen.getByText('Remove from this laptop'))
    expect(onConfirm).toHaveBeenCalledWith('removeLocal')
  })

  it('"Delete everywhere" needs a second explicit confirmation', () => {
    const { onConfirm, onCancel } = renderDialog('synced')
    fireEvent.click(screen.getByText('Delete everywhere'))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText(/cannot be undone/)).toBeTruthy()

    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirming "Delete everywhere" reports it', () => {
    const { onConfirm } = renderDialog('cloud')
    expect(screen.queryByText('Remove from this laptop')).toBeNull()
    fireEvent.click(screen.getByText('Delete everywhere'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete everywhere' }))
    expect(onConfirm).toHaveBeenCalledWith('everywhere')
  })

  it('local-only songs get a plain confirm', () => {
    const { onConfirm } = renderDialog('local')
    fireEvent.click(screen.getByText('Delete'))
    expect(onConfirm).toHaveBeenCalledWith('local')
  })
})
