import { useEffect, useState } from 'react'
import type { CloudSettingsView } from '../../../shared/cloud'

interface Props {
  onClose: () => void
  /** Called after settings change or an upload-all finishes, to refresh the library. */
  onChanged: () => void
  onToast: (message: string, type?: 'error' | 'success') => void
  /** Number of songs that are only on this laptop. */
  localOnlyCount: number
}

export default function CloudSettingsModal({
  onClose,
  onChanged,
  onToast,
  localOnlyCount
}: Props): React.JSX.Element {
  const [settings, setSettings] = useState<CloudSettingsView | null>(null)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | 'uploadAll' | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    window.api.getCloudSettings().then((s) => {
      setSettings(s)
      setUrl(s.url)
      setEnabled(s.enabled)
    })
  }, [])

  const dirty =
    !!settings && (url !== settings.url || enabled !== settings.enabled || token.length > 0)

  const save = async (): Promise<void> => {
    setBusy('save')
    const r = await window.api.saveCloudSettings({ url, enabled, token: token || undefined })
    setBusy(null)
    if (!r.success || !r.settings) {
      onToast(r.error ?? 'Could not save cloud settings', 'error')
      return
    }
    setSettings(r.settings)
    setToken('')
    onToast(r.settings.enabled ? 'Cloud sync enabled' : 'Cloud settings saved', 'success')
    onChanged()
  }

  const test = async (): Promise<void> => {
    setBusy('test')
    setTestResult(null)
    const r = await window.api.testCloud({ url, token: token || undefined })
    setBusy(null)
    setTestResult(r.ok ? '✓ Connected' : `✕ ${r.error}`)
  }

  const uploadAll = async (): Promise<void> => {
    setBusy('uploadAll')
    const r = await window.api.cloudUploadAll()
    setBusy(null)
    onToast(
      r.success
        ? `Uploaded ${r.uploaded} song(s)`
        : `Uploaded ${r.uploaded}, failed: ${r.failed.join(', ')}`,
      r.success ? 'success' : 'error'
    )
    onChanged()
  }

  const active = settings?.enabled && settings.hasToken && !!settings.url

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cloud sync settings"
        className="w-full max-w-md bg-neutral-900 border border-neutral-700 rounded-xl p-5 shadow-xl text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-white">Cloud sync</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-white" title="Close">
            ✕
          </button>
        </div>
        <p className="text-xs text-neutral-500 mb-4">
          Keeps a copy of your songs in your own Cloudflare R2, so you can free space here and
          download them again any time. Everything keeps working offline.
        </p>

        {settings && !settings.encryptionAvailable && (
          <p className="text-xs text-amber-400 mb-3">
            Secure storage isn&apos;t available on this system, so the token can&apos;t be saved.
          </p>
        )}

        <label className="block text-xs text-neutral-400 mb-1">Worker URL</label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://velody-cloud.<you>.workers.dev"
          className="w-full mb-3 px-2.5 py-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs focus:outline-none focus:border-brand-primary"
        />

        <label className="block text-xs text-neutral-400 mb-1">Token</label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={settings?.hasToken ? '•••••••• saved — type to replace' : 'Paste your token'}
          autoComplete="off"
          className="w-full mb-3 px-2.5 py-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs focus:outline-none focus:border-brand-primary"
        />

        <label className="flex items-center justify-between text-xs text-neutral-300 mb-4 cursor-pointer select-none">
          Enable cloud sync
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="accent-brand-primary"
          />
        </label>

        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={test}
            disabled={busy !== null}
            className="px-3 py-1.5 rounded-lg text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 disabled:opacity-50"
          >
            {busy === 'test' ? 'Testing…' : 'Test connection'}
          </button>
          {testResult && (
            <span
              className={`text-xs truncate ${testResult.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}
              title={testResult}
            >
              {testResult}
            </span>
          )}
          <button
            onClick={save}
            disabled={!dirty || busy !== null}
            className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-primary hover:bg-brand-primary/80 text-white disabled:opacity-50"
          >
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        </div>

        {active && (
          <div className="pt-4 border-t border-neutral-800">
            <button
              onClick={uploadAll}
              disabled={busy !== null || localOnlyCount === 0}
              className="px-3 py-1.5 rounded-lg text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 disabled:opacity-50"
            >
              {busy === 'uploadAll' ? 'Uploading…' : `Upload all local songs (${localOnlyCount})`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
