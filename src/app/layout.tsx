import type { Metadata, Viewport } from 'next'
import { Playfair_Display, Lato } from 'next/font/google'
import './globals.css'
import ReactQueryProvider from '@/components/layout/ReactQueryProvider'

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
}

export const viewport: Viewport = {
  themeColor: '#0f2d1c',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${lato.variable}`}>
      <body className="bg-cream font-body text-ink antialiased min-h-screen">
        <ReactQueryProvider>{children}</ReactQueryProvider>
      </body>
    </html>
  )
}
