export interface Stem {
  name: 'vocals' | 'drums' | 'bass' | 'other'
  path: string
  muted: boolean
  solo: boolean
  volume: number
}

export interface Track {
  id: string
  name: string
  path: string
  duration: number
  stems: Stem[]
}

export interface SeparationResult {
  success: boolean
  stems: string[]
  error?: string
}
