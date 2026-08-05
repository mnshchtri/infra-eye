import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Bundled locally rather than pulled from a CDN: the desktop app has no
// guaranteed network at startup, and a missing webfont renders every OS/distro
// icon as an empty tofu box.
import 'devicon/devicon.min.css'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
