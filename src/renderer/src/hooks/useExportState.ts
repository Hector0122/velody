import { useState, useCallback } from 'react'
import { stemNameFromPath, extForFormat, formatFilter } from '../utils'

interface UseExportStateParams {
  allStems: string[]
  songName: string
  bpm: number
  stemMeta: Record<string, { color: string; label: string }>
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
  bpm,
  stemMeta
}: UseExportStateParams): UseExportStateReturn {
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportSelection, setExportSelection] = useState<Record<string, boolean>>({})
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav')
  const [exportWithMetronome, setExportWithMetronome] = useState(false)
  const [exporting, setExporting] = useState(false)

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
      setExporting(true)
      await window.api.exportSingle(stemPath, outPath)
      setExporting(false)
    },
    [allStems, songName, exportFormat, stemMeta]
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
    setExporting(true)
    await window.api.exportMix(paths, outPath, exportWithMetronome ? { bpm } : undefined)
    setExporting(false)
  }, [exportSelection, allStems, songName, exportFormat, exportWithMetronome, bpm])

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
