import { useState } from 'react'

export type DeleteChoice = 'local' | 'removeLocal' | 'everywhere'

interface Props {
  songName: string
  /** Sync state of the song; undefined while cloud sync is off. */
  sync?: 'local' | 'cloud' | 'synced'
  onConfirm: (choice: DeleteChoice) => void
  onCancel: () => void
}

/**
 * Delete confirmation. For songs in the cloud it offers "Remove from this
 * laptop" (frees space, keeps the cloud copy) vs "Delete everywhere", which
 * needs a second, explicit confirmation since it can't be undone.
 */
export default function DeleteSongDialog({
  songName,
  sync,
  onConfirm,
  onCancel
}: Props): React.JSX.Element {
  const inCloud = sync === 'synced' || sync === 'cloud'
  const [confirmEverywhere, setConfirmEverywhere] = useState(false)

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${songName}`}
        className="w-full max-w-sm bg-neutral-900 border border-neutral-700 rounded-xl p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-white mb-1 truncate">{songName}</h2>

        {!inCloud && (
          <>
            <p className="text-xs text-neutral-400 mb-4">
              Delete this song and its stems from this laptop?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={onCancel}
                className="px-3 py-1.5 rounded-lg text-xs text-neutral-300 hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                onClick={() => onConfirm('local')}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-700 hover:bg-red-600 text-white"
              >
                Delete
              </button>
            </div>
          </>
        )}

        {inCloud && !confirmEverywhere && (
          <>
            <p className="text-xs text-neutral-400 mb-4">
              {sync === 'synced'
                ? 'This song is on this laptop and in the cloud.'
                : 'This song is only in the cloud.'}
            </p>
            <div className="flex flex-col gap-2">
              {sync === 'synced' && (
                <button
                  onClick={() => onConfirm('removeLocal')}
                  className="w-full px-3 py-2 rounded-lg text-xs text-left bg-neutral-800 hover:bg-neutral-700 text-white"
                >
                  <span className="font-semibold block">Remove from this laptop</span>
                  <span className="text-neutral-400">
                    Frees disk space. It stays in the cloud and downloads again when you open it.
                  </span>
                </button>
              )}
              <button
                onClick={() => setConfirmEverywhere(true)}
                className="w-full px-3 py-2 rounded-lg text-xs text-left bg-red-950/60 hover:bg-red-900/60 border border-red-800/50 text-red-300"
              >
                <span className="font-semibold block">Delete everywhere</span>
                <span className="text-red-400/80">From this laptop and from the cloud.</span>
              </button>
              <button
                onClick={onCancel}
                className="self-end mt-1 px-3 py-1.5 rounded-lg text-xs text-neutral-300 hover:bg-neutral-800"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {inCloud && confirmEverywhere && (
          <>
            <p className="text-xs text-red-300 mb-4">
              This permanently deletes the song from the cloud and from this laptop. It cannot be
              undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={onCancel}
                className="px-3 py-1.5 rounded-lg text-xs text-neutral-300 hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                onClick={() => onConfirm('everywhere')}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-700 hover:bg-red-600 text-white"
              >
                Delete everywhere
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
