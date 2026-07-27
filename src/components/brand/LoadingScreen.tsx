import BrandLogo from '@/components/brand/BrandLogo'

// Shown automatically by Next.js while a route segment's server data is
// loading (via the special loading.tsx file convention) — no manual
// wiring needed per-page. Deliberately quiet: one gentle pulse on the
// logo, no spinner, no progress bar, nothing that competes with the mark
// itself for attention.

export default function LoadingScreen() {
  return (
    <div style={{
      minHeight: '60vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '40px 16px',
    }}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{`
        @keyframes brandPulse {
          0%, 100% { opacity: 0.55; transform: scale(0.98); }
          50%      { opacity: 1;    transform: scale(1); }
        }
        .brand-loading-pulse { animation: brandPulse 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .brand-loading-pulse { animation: none; }
        }
      `}</style>
      <div className="brand-loading-pulse">
        <BrandLogo variant="icon" size={64} priority />
      </div>
    </div>
  )
}
