import { Logo } from '../components/Logo'

interface HomeProps {
  onIngreso: () => void
}

export function Home({ onIngreso }: HomeProps) {
  return (
    <div className="page-center">
      <div className="card login-form">
        <div className="login-brand">
          <Logo size={80} />
          <h1>Te Lo Tengo Market</h1>
        </div>
        <p className="subtitle" style={{ textAlign: 'center' }}>
          ¿Qué quieres hacer?
        </p>
        <button className="btn btn-primary" onClick={onIngreso}>
          Ingreso trabajadores
        </button>
        <a className="btn btn-secondary" href="/tienda">
          Tienda
        </a>
      </div>
    </div>
  )
}
