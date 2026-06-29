import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import ReactQueryProvider from '@/components/layout/ReactQueryProvider'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

export const metadata: Metadata = {
  title: { default: "Teein' It Up", template: "%s | Teein' It Up" },
  description: 'Run Your Golf Trip Like A Pro. Live Scoring, Side Comps, Leaderboards.',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: "Teein' It Up" },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  themeColor: '#1A5C38',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-surface font-sans text-text antialiased">
        <ReactQueryProvider>{children}</ReactQueryProvider>
      </body>
    </html>
  )
}
