import { useEffect, useState } from 'react'
import SetupScreen from './components/SetupScreen'
import Home from './pages/Home'

function App(): React.JSX.Element {
  const [ready, setReady] = useState<boolean | null>(null)

  useEffect(() => {
    if (!window.api) {
      setReady(true)
      return
    }
    window.api.getSetupStatus().then((status) => {
      setReady(status.complete)
    })
  }, [])

  if (ready === null) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!ready) {
    return <SetupScreen />
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <Home />
    </div>
  )
}

export default App
