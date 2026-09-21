import { useAuth } from './lib/useAuth'
import { supabaseConfigError } from './lib/supabase'
import { Login } from './routes/Login'
import { AdminDashboard } from './routes/admin/AdminDashboard'
import { WorkerDashboard } from './routes/worker/WorkerDashboard'
import './App.css'

function App() {
  const { session, profile, loading } = useAuth()

  if (supabaseConfigError) {
    return (
      <div className="page-center">
        <p className="error-text">{supabaseConfigError}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page-center">
        <p>Cargando...</p>
      </div>
    )
  }

  if (!session) {
    return <Login />
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
