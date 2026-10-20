import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { registrarServiceWorker } from './registrarServiceWorker'

registrarServiceWorker()

// Si al abrir una pantalla falla la descarga de su archivo (por ejemplo justo mientras se publica una version
// nueva), se recarga la app una sola vez para tomar los archivos nuevos, en vez de quedar en blanco.
window.addEventListener('vite:preloadError', () => {
  // OJO: no se llama preventDefault: si se hiciera, la pantalla recibiria un resultado vacio y fallaria.
  try {
    if (sessionStorage.getItem('tlt-recarga-chunk')) return
    sessionStorage.setItem('tlt-recarga-chunk', '1')
  } catch {
    // sin sessionStorage igual se intenta recargar
  }
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
