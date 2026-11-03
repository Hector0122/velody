import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../shared/types'

// Shows auto-update progress from the main process (src/main/updater.ts).
// Renders nothing unless an update is downloading or ready.
function UpdateBanner(): React.JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    if (!window.api?.getUpdateStatus) return
    window.api.getUpdateStatus().then(setStatus)
    return window.api.onUpdateStatus(setStatus)
  }, [])

  if (status.state === 'idle') return null

  return (
    <div className="mx-3 mt-2 mb-2 p-2.5 rounded-lg border border-brand-primary/30 bg-brand-primary/10 text-xs shrink-0">
      {status.state === 'downloading' ? (
        <p className="text-neutral-300">
          Downloading v{status.version}… {status.percent}%
        </p>
      ) : (
        <>
          <p className="text-neutral-200 mb-2">Velody v{status.version} is ready</p>
          <button
            onClick={() => window.api.installUpdate()}
            className="w-full py-1 rounded bg-brand-primary hover:bg-brand-primary/80 text-white font-semibold transition-colors"
          >
            Restart to update
          </button>
        </>
      )}
    </div>
  )
}

export default UpdateBanner
