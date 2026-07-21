'use client'

// Tiny client component — only needed to attach the onError fallback.
// The auth layout remains a Server Component.

export default function BrandLogo() {
  return (
    <div style={{
      width: 128, height: 128,
      margin: '0 auto 12px',
      filter: 'drop-shadow(0 4px 20px rgba(0,0,0,0.55)) drop-shadow(0 0 30px rgba(201,168,76,0.2))',
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-full.png"
        alt="Teein' It Up"
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
          e.currentTarget.style.display = 'none'
        }}
      />
    </div>
  )
}
