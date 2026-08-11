import { useEffect, useState } from 'react'
import SetupScreen from './components/SetupScreen'
import Home from './pages/Home'

function App(): React.JSX.Element {
  const [ready, setReady] = useState<boolean | null>(() => (window.api ? null : true))

  useEffect(() => {
    if (ready !== null || !window.api) return
    window.api.getSetupStatus().then((status) => {
      setReady(status.complete)
    })
  }, [ready])

  if (ready === null) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
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
