import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { initML, type EP } from '../lib/mlBrowser'
import { toUserMessage } from '../lib/errorMessages'

type MLState = 'loading' | 'ready' | 'error'

interface MLContextValue {
  mlState: MLState
  loadProgress: number
  ep: EP | null
  mlError: string | null
}

const MLContext = createContext<MLContextValue>({
  mlState: 'loading',
  loadProgress: 0,
  ep: null,
  mlError: null,
})

export function MLProvider({ children }: { children: ReactNode }) {
  const [mlState, setMlState] = useState<MLState>('loading')
  const [loadProgress, setLoadProgress] = useState(0)
  const [ep, setEp] = useState<EP | null>(null)
  const [mlError, setMlError] = useState<string | null>(null)

  useEffect(() => {
    initML((pct) => setLoadProgress(pct))
      .then((chosenEp) => { setEp(chosenEp); setMlState('ready') })
      .catch((e) => { setMlError(toUserMessage(e, "Couldn't load face detection — try again.")); setMlState('error') })
  }, [])

  return (
    <MLContext.Provider value={{ mlState, loadProgress, ep, mlError }}>
      {children}
    </MLContext.Provider>
  )
}

export function useML() {
  return useContext(MLContext)
}
