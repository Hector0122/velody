import { useState } from 'react'

interface RecentSong {
  name: string
  stems: string[]
}

interface Setlist {
  id: string
  name: string
  songNames: string[]
  updatedAt: number
}

interface SetlistPanelProps {
  setlists: Setlist[]
  activeSetlistId: string | null
  songs: RecentSong[]
  currentSongName: string | null
  onSelectSetlist: (id: string | null) => void
  onCreateSetlist: (name: string) => void
  onDeleteSetlist: (id: string) => void
  onSelectSong: (song: RecentSong, setlistId: string, index: number) => void
  onRemoveSongFromSetlist: (setlistId: string, songName: string) => void
  onMoveSong: (setlistId: string, index: number, direction: -1 | 1) => void
}

// Sidebar "Setlists" tab: a list of named setlists, and — once one is
// selected (activeSetlistId) — that setlist's songs in order. Selecting a
// setlist here also makes it the target for "add to setlist" actions in
// the Library tab (see Home.tsx). See openspec/changes/add-song-setlists.
export default function SetlistPanel({
  setlists,
  activeSetlistId,
  songs,
  currentSongName,
  onSelectSetlist,
  onCreateSetlist,
  onDeleteSetlist,
  onSelectSong,
  onRemoveSongFromSetlist,
  onMoveSong
}: SetlistPanelProps): React.JSX.Element {
  const [newName, setNewName] = useState('')
  const activeSetlist = setlists.find((sl) => sl.id === activeSetlistId) ?? null

  const handleCreate = (): void => {
    const name = newName.trim()
    if (!name) return
    onCreateSetlist(name)
    setNewName('')
  }

  if (!activeSetlist) {
    return (
      <div className="mt-3 mx-3 flex flex-col gap-2 min-h-0 flex-1">
        <h3 className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide">
          Setlists
        </h3>
        <div className="flex gap-1">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
            }}
            placeholder="New setlist name..."
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs placeholder-neutral-500 focus:outline-none focus:border-brand-primary transition-colors"
          />
          <button
            onClick={handleCreate}
            className="px-2.5 rounded-md text-xs font-semibold bg-brand-primary hover:bg-brand-primary/80 text-white transition-colors shrink-0"
          >
            +
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-1">
          {setlists.length === 0 ? (
            <p className="text-xs text-neutral-600 px-1 py-2">No setlists yet</p>
          ) : (
            setlists.map((sl) => (
              <div key={sl.id} className="relative group">
                <button
                  onClick={() => onSelectSetlist(sl.id)}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                >
                  <span className="truncate block">{sl.name}</span>
                  <span className="text-[10px] text-neutral-600">
                    {sl.songNames.length} song{sl.songNames.length !== 1 ? 's' : ''}
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteSetlist(sl.id)
                  }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded flex items-center justify-center text-neutral-600 hover:text-red-400 hover:bg-red-900/30 transition-colors opacity-0 group-hover:opacity-100 text-xs"
                  title="Delete setlist"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3 mx-3 flex flex-col gap-2 min-h-0 flex-1">
      <button
        onClick={() => onSelectSetlist(null)}
        className="text-[10px] text-neutral-500 hover:text-white transition-colors self-start"
      >
        ← All Setlists
      </button>
      <h3 className="text-xs font-semibold text-white truncate">{activeSetlist.name}</h3>
      <div className="flex-1 overflow-y-auto space-y-1">
        {activeSetlist.songNames.length === 0 ? (
          <p className="text-xs text-neutral-600 px-1 py-2">
            No songs yet — add some from the Library tab
          </p>
        ) : (
          activeSetlist.songNames.map((name, i) => {
            const song = songs.find((s) => s.name === name)
            return (
              <div key={`${name}-${i}`} className="relative group">
                <button
                  onClick={() => song && onSelectSong(song, activeSetlist.id, i)}
                  disabled={!song}
                  className={`w-full text-left pl-2 pr-14 py-2 rounded-lg text-sm transition-colors flex items-center gap-1.5 ${
                    currentSongName === name
                      ? 'bg-brand-primary/20 text-brand-primary border border-brand-primary/30'
                      : song
                        ? 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                        : 'text-neutral-700 cursor-not-allowed'
                  }`}
                >
                  <span className="text-[10px] text-neutral-600 w-4 shrink-0 text-right">
                    {i + 1}
                  </span>
                  <span className="truncate">{name}</span>
                </button>
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onMoveSong(activeSetlist.id, i, -1)}
                    disabled={i === 0}
                    className="w-5 h-6 flex items-center justify-center text-neutral-500 hover:text-white disabled:opacity-20 disabled:hover:text-neutral-500 text-[10px]"
                    title="Move up"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => onMoveSong(activeSetlist.id, i, 1)}
                    disabled={i === activeSetlist.songNames.length - 1}
                    className="w-5 h-6 flex items-center justify-center text-neutral-500 hover:text-white disabled:opacity-20 disabled:hover:text-neutral-500 text-[10px]"
                    title="Move down"
                  >
                    ▼
                  </button>
                  <button
                    onClick={() => onRemoveSongFromSetlist(activeSetlist.id, name)}
                    className="w-5 h-6 flex items-center justify-center text-neutral-600 hover:text-red-400 text-xs"
                    title="Remove from setlist"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
