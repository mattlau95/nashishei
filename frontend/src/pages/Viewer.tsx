import { useParams } from 'react-router-dom'

export default function Viewer() {
  const { token } = useParams<{ token: string }>()

  return (
    <main>
      <p>Shared photo viewer — token: {token}</p>
      {/* Phase 1: photo + tap-to-reveal labels go here */}
    </main>
  )
}
