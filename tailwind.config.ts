import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#E8F5EE',
          100: '#C5E8D3',
          200: '#9DD6B4',
          300: '#70C492',
          400: '#4AB575',
          500: '#2A9D5C',
          600: '#1A5C38',
          700: '#164D30',
          800: '#113D26',
          900: '#0A2416',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          muted:   '#F5F7F5',
          subtle:  '#ECEEEC',
        },
        text: {
          DEFAULT: '#1A1A1A',
          muted:   '#555555',
          subtle:  '#888888',
        },
        status: {
          draft:     '#94A3B8',
          open:      '#3B82F6',
          ready:     '#8B5CF6',
          live:      '#22C55E',
          completed: '#1A5C38',
          archived:  '#9CA3AF',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card:       '0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'card-hover':'0 4px 12px 0 rgb(0 0 0 / 0.10), 0 2px 4px -1px rgb(0 0 0 / 0.06)',
      },
    },
  },
  plugins: [],
}

export default config
