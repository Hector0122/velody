import { useState, useCallback } from 'react'
import { stemNameFromPath, extForFormat, formatFilter } from '../utils'
import type { ExportResult } from '../../../shared/types'

interface UseExportStateParams {
  allStems: string[]
  songName: string
  /** The live metronome's clicks over the song (metronomeClicks), read at export time. */
  getClicks: () => { time: number; accent: boolean }[]
  stemMeta: Record<string, { color: string; label: string }>
  // Song's current trim range (see openspec/changes/add-song-trim-points) —
  // applied by default to both single-stem and mix exports, so an exported
  // file matches the trimmed range the user hears live.
  trimStart: number
  trimEnd: number | null
  onToast?: (message: string, type?: 'error' | 'success') => void
}

interface UseExportStateReturn {
  showExportModal: boolean
  setShowExportModal: (v: boolean) => void
  exportSelection: Record<string, boolean>
  exportFormat: 'wav' | 'mp3'
  setExportFormat: (v: 'wav' | 'mp3') => void
  exportWithMetronome: boolean
  setExportWithMetronome: (v: boolean) => void
  exporting: boolean
  handleExportSingle: (key: string) => Promise<void>
  handleExportMix: () => Promise<void>
  toggleExportSelection: (key: string) => void
}

export function useExportState({
  allStems,
  songName,
  getClicks,
  stemMeta,
  trimStart,
  trimEnd,
  onToast
}: UseExportStateParams): UseExportStateReturn {
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportSelection, setExportSelection] = useState<Record<string, boolean>>({})
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav')
  const [exportWithMetronome, setExportWithMetronome] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Runs one export, always clears the "Exporting..." state and reports failures.
  const runExport = useCallback(
    async (run: () => Promise<ExportResult>): Promise<void> => {
      setExporting(true)
      try {
        const result = await run()
        if (!result.success) onToast?.(`Export failed: ${result.error ?? 'unknown error'}`, 'error')
      } catch (err) {
        onToast?.(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
      } finally {
        setExporting(false)
      }
    },
    [onToast]
  )

  const handleExportSingle = useCallback(
    async (key: string): Promise<void> => {
      if (!window.api) return
      const stemPath = allStems.find((p) => stemNameFromPath(p) === key)
      if (!stemPath) return
      const stemLabel = stemMeta[key]?.label ?? key
      const outPath = await window.api.saveFileDialog(
        `${songName} - ${stemLabel}${extForFormat(exportFormat)}`,
        [formatFilter(exportFormat)]
      )
      if (!outPath) return
      const trimOptions: { trimStart?: number; trimEnd?: number } = {}
      if (trimStart > 0) trimOptions.trimStart = trimStart
      if (trimEnd !== null) trimOptions.trimEnd = trimEnd
      await runExport(() =>
        window.api.exportSingle(
          stemPath,
          outPath,
          Object.keys(trimOptions).length > 0 ? trimOptions : undefined
        )
      )
    },
    [allStems, songName, exportFormat, stemMeta, trimStart, trimEnd, runExport]
  )

  const handleExportMix = useCallback(async (): Promise<void> => {
    if (!window.api) return
    const selected = Object.entries(exportSelection)
      .filter(([, v]) => v)
      .map(([k]) => k)
    if (selected.length === 0) return
    const paths = selected
      .map((k) => allStems.find((p) => stemNameFromPath(p) === k))
      .filter((p): p is string => !!p)
    const outPath = await window.api.saveFileDialog(
      `${songName} - Mix${extForFormat(exportFormat)}`,
      [formatFilter(exportFormat)]
    )
    if (!outPath) return
    const options: Parameters<typeof window.api.exportMix>[2] = {}
    if (exportWithMetronome) options.clicks = getClicks()
    if (trimStart > 0) options.trimStart = trimStart
    if (trimEnd !== null) options.trimEnd = trimEnd
    await runExport(() =>
      window.api.exportMix(paths, outPath, Object.keys(options).length > 0 ? options : undefined)
    )
  }, [
    exportSelection,
    allStems,
    songName,
    exportFormat,
    exportWithMetronome,
    getClicks,
    trimStart,
    trimEnd,
    runExport
  ])

  const toggleExportSelection = useCallback((key: string): void => {
    setExportSelection((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  return {
    showExportModal,
    setShowExportModal,
    exportSelection,
    exportFormat,
    setExportFormat,
    exportWithMetronome,
    setExportWithMetronome,
    exporting,
    handleExportSingle,
    handleExportMix,
    toggleExportSelection
  }
}
