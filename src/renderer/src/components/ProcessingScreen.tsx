interface ProcessingScreenProps {
  songName: string
}

function ProcessingScreen({ songName }: ProcessingScreenProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-24 space-y-8">
      {/* Animated gradient ring */}
      <div className="relative">
        <div className="w-24 h-24 rounded-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 animate-spin p-1">
          <div className="w-full h-full rounded-full bg-neutral-950" />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-neutral-900 flex items-center justify-center">
            <span className="text-2xl">🎵</span>
          </div>
        </div>
      </div>

      {/* Text */}
      <div className="text-center space-y-3">
        <h2 className="text-xl font-semibold text-white">Separating stems</h2>
        <p className="text-neutral-400 max-w-md">
          Analyzing <span className="text-white font-medium">{songName}</span> and extracting
          vocals, drums, bass, and other instruments
        </p>
      </div>

      {/* Pulsing dots */}
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-blue-500"
            style={{ animation: `pulse 1.2s ease-in-out ${i * 0.3}s infinite` }}
          />
        ))}
      </div>
    </div>
  )
}

export default ProcessingScreen
