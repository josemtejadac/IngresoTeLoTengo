import { lazy, Suspense, useState } from 'react'
import { useAuth } from './lib/useAuth'
import { supabaseConfigError } from './lib/supabase'
import { Home } from './routes/Home'
import { Login } from './routes/Login'
import { MarcaAgua } from './components/MarcaAgua'
import './App.css'

// Cada ruta se baja aparte: asi un trabajador que solo marca entrada no descarga el panel de
// admin (con jsPDF, xlsx, html2canvas) ni la tienda, y el cliente de la tienda no descarga los
// paneles. Esto es lo que mas pesaba el arranque de la app en celulares con señal mala.
const Tienda = lazy(() => import('./routes/Tienda').then((m) => ({ default: m.Tienda })))
const AdminDashboard = lazy(() => import('./routes/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard })))
const WorkerDashboard = lazy(() => import('./routes/worker/WorkerDashboard').then((m) => ({ default: m.WorkerDashboard })))

function App() {
  const isTienda = window.location.pathname.startsWith('/tienda')
  const [showLogin, setShowLogin] = useState(false)

  const { session, profile, loading } = useAuth()

  const contenido = (() => {
    if (supabaseConfigError) {
      return (
        <div className="page-center">
          <p className="error-text">{supabaseConfigError}</p>
        </div>
      )
    }

    // La tienda es publica: no requiere iniciar sesion.
    if (isTienda) {
      return <Tienda />
    }

    if (loading) {
      return (
        <div className="page-center">
          <p>Cargando...</p>
        </div>
      )
    }

    if (!session) {
      return showLogin ? (
        <Login onBack={() => setShowLogin(false)} />
      ) : (
        <Home onIngreso={() => setShowLogin(true)} />
      )
    }

    if (!profile) {
      return (
        <div className="page-center">
          <p>Tu cuenta no tiene un perfil asignado. Contacta al administrador.</p>
        </div>
      )
    }

    if (profile.role === 'admin') {
      return <AdminDashboard profile={profile} />
    }

    return <WorkerDashboard profile={profile} />
  })()

  return (
    <>
      <Suspense fallback={<div className="page-center"><p>Cargando...</p></div>}>{contenido}</Suspense>
      <MarcaAgua />
    </>
  )
}

export default App
