import { useState } from 'react'
import { useAuth } from './lib/useAuth'
import { supabaseConfigError } from './lib/supabase'
import { Home } from './routes/Home'
import { Login } from './routes/Login'
import { Tienda } from './routes/Tienda'
import { AdminDashboard } from './routes/admin/AdminDashboard'
import { WorkerDashboard } from './routes/worker/WorkerDashboard'
import './App.css'

function App() {
  const isTienda = window.location.pathname.startsWith('/tienda')
  const [showLogin, setShowLogin] = useState(false)

  const { session, profile, loading } = useAuth()

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
}

export default App
