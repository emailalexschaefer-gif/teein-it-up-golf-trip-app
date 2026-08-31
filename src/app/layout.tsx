import type { Metadata, Viewport } from 'next'
import { Playfair_Display, Lato } from 'next/font/google'
import './globals.css'
import ReactQueryProvider from '@/components/layout/ReactQueryProvider'
import InstallPromptCaptureInit from '@/components/pwa/InstallPromptCaptureInit'
import ServiceWorkerInit from '@/components/pwa/ServiceWorkerInit'
import GoogleAnalytics from '@/components/analytics/GoogleAnalytics'
import RouteChangeTracker from '@/components/analytics/RouteChangeTracker'

// Demo fonts: Playfair Display for display/headings, Lato for body
const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '600', '700', '800'],
  display: 'swap',
})

const lato = Lato({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['300', '400', '700'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: "Teein' It Up", template: "%s | Teein' It Up" },
  description: 'Run Your Golf Event Like A Pro. Live Scoring, Side Comps, Leaderboards.',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: "Teein' It Up" },
  formatDetection: { telephone: false },
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/brand/icon-192.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#0f2d1c',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${lato.variable}`}>
      <body className="bg-cream font-body text-ink antialiased min-h-screen">
        {/* P0 field-test fix — must be mounted here, at the true root,
            not inside any specific page — see installPromptCapture.ts
            for why. Renders nothing. */}
        <InstallPromptCaptureInit />
        {/* 30 Aug field-test bundle — PWA installability. See
            ServiceWorkerInit.tsx / public/sw.js for the full trace.
            Renders nothing. */}
        <ServiceWorkerInit />
        {/* GA4 / Product Analytics brief — mounted at the true root so
            every route (including auth pages, before a trip/tripId
            exists) is tracked. GoogleAnalytics renders nothing if
            NEXT_PUBLIC_GA_MEASUREMENT_ID isn't set; RouteChangeTracker
            is the sole source of pageviews (see both files). */}
        <GoogleAnalytics />
        <RouteChangeTracker />
        <ReactQueryProvider>{children}</ReactQueryProvider>
      </body>
    </html>
  )
}
