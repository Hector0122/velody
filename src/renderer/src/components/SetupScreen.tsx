import { useEffect, useState } from 'react'

const STEP_LABELS: Record<string, string> = {
  python: 'Python',
  venv: 'Virtual environment',
  demucs: 'Demucs + AI model',
  ffmpeg: 'FFmpeg',
  done: 'Complete'
}

const STEP_ORDER = ['python', 'venv', 'demucs', 'ffmpeg', 'done']

function SetupScreen(): React.JSX.Element {
  const [steps, setSteps] = useState<Record<string, SetupProgress>>({})
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!window.api) return
    window.api.onSetupProgress((progress) => {
      setSteps((prev) => ({ ...prev, [progress.step]: progress }))
    })
  }, [])

  const handleStart = async (): Promise<void> => {
    if (!window.api) return
    setRunning(true)
    setError(null)

    const result = await window.api.startSetup()
    if (!result.success) {
      setError(result.error || 'Setup failed')
    }
    setRunning(false)
  }

  const dataSteps = STEP_ORDER.slice(0, -1)
  const doneCount = dataSteps.filter((s) => steps[s]?.status === 'done').length
  const workingIdx = dataSteps.findIndex((s) => steps[s]?.status === 'working')
  const overallProgress =
    workingIdx >= 0
      ? Math.round(((doneCount + 0.5) / dataSteps.length) * 100)
      : doneCount === dataSteps.length
        ? 100
        : 0

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-8">
      <div className="w-full max-w-lg space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-display font-normal bg-gradient-to-r from-brand-primary to-brand-accent bg-clip-text text-transparent">
            Velody
          </h1>
          <p className="mt-2 text-neutral-400">Setting up your environment</p>
        </div>

        {!running && Object.keys(steps).length === 0 ? (
          <div className="space-y-6">
            <div className="bg-neutral-900 rounded-xl p-6 border border-neutral-800">
              <p className="text-neutral-300 text-sm leading-relaxed">
                Velody needs to install the following dependencies to run:
              </p>
              <ul className="mt-4 space-y-2">
                {STEP_ORDER.slice(0, -1).map((s) => (
                  <li key={s} className="flex items-center gap-2 text-sm text-neutral-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-neutral-600" />
                    {STEP_LABELS[s]}
                  </li>
                ))}
              </ul>
            </div>

            <button
              onClick={handleStart}
              className="w-full py-3 rounded-xl font-medium bg-gradient-to-r from-brand-primary to-brand-accent text-white hover:opacity-90 transition-opacity"
            >
              Start setup
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-neutral-900 rounded-xl p-6 border border-neutral-800">
              <div className="flex justify-between text-sm text-neutral-400 mb-4">
                <span>Installing dependencies...</span>
                <span>{overallProgress}%</span>
              </div>
              <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-primary to-brand-accent rounded-full transition-all duration-500"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
            </div>

            <div className="space-y-2">
              {STEP_ORDER.map((s) => {
                const step = steps[s]
                if (!step) return null

                return (
                  <div
                    key={s}
                    className={`flex items-center gap-3 p-3 rounded-lg text-sm ${
                      step.status === 'error' ? 'bg-red-900/20' : 'bg-neutral-900/50'
                    }`}
                  >
                    <span>
                      {step.status === 'working' ? (
                        <span className="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full inline-block animate-spin" />
                      ) : step.status === 'done' ? (
                        <span className="text-green-400">✓</span>
                      ) : step.status === 'error' ? (
                        <span className="text-red-400">✕</span>
                      ) : (
                        <span className="text-neutral-600">○</span>
                      )}
                    </span>
                    <div className="flex-1">
                      <p className="text-neutral-300">{STEP_LABELS[s]}</p>
                      {step.message && (
                        <p className="text-xs text-neutral-500 truncate">{step.message}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {error && (
              <div className="p-4 bg-red-900/30 border border-red-600 rounded-xl text-red-400 text-sm">
                {error}
              </div>
            )}

            {steps.done?.status === 'done' && !running && (
              <button
                onClick={() => window.location.reload()}
                className="w-full py-3 rounded-xl font-medium bg-gradient-to-r from-brand-primary to-brand-accent text-white hover:opacity-90 transition-opacity"
              >
                Launch Velody
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default SetupScreen
