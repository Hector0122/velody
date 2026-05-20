import AudioUploader from '../components/AudioUploader'

function Home(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <header className="mb-12 text-center">
        <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Velody
        </h1>
        <p className="mt-2 text-neutral-400 text-lg">AI-powered audio stem separation</p>
      </header>

      <main className="w-full max-w-2xl">
        <AudioUploader />
      </main>
    </div>
  )
}

export default Home
