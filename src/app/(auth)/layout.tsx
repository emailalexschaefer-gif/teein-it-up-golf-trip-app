// Demo auth: dark greenDeep background, centred card on ivory
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(170deg, #0a1f10 0%, #0f2d1a 36%, #0e2516 68%, #050e08 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '24px 16px 40px',
    }}>
      {/* Logo area — matches demo welcome screen */}
      <div style={{ marginBottom: 28, textAlign: 'center' }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: '#fff',
          border: '3px solid rgba(201,168,76,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 14px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.45), 0 0 0 3px rgba(201,168,76,0.2)',
        }}>
          <span style={{ fontSize: 36 }}>⛳</span>
        </div>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          color: '#ffffff',
          fontSize: 22, fontWeight: 800,
          letterSpacing: 0.2,
        }}>Teein&apos; It Up</h1>
        <p style={{
          fontFamily: 'var(--font-body)',
          color: 'rgba(245,230,184,0.5)',
          fontSize: 11, marginTop: 4,
          letterSpacing: 2, textTransform: 'uppercase',
        }}>Golf Event App</p>
      </div>

      {/* Card — ivory background matching demo card style */}
      <div style={{
        width: '100%', maxWidth: 360,
        background: '#f8f4eb',
        borderRadius: 18,
        border: '1.5px solid #d9c9a3',
        boxShadow: '0 4px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.8)',
        padding: '28px 24px',
      }}>
        {children}
      </div>
    </div>
  )
}
