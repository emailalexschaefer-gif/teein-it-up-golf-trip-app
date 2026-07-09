import type { Config } from 'tailwindcss'

// ─── EXACT DEMO TOKENS (from TeeinItUp_v62.jsx constant C and T) ──────────────
// C.greenDeep="#0f2d1c" C.green="#1a4731" C.greenMid="#236040" C.greenBright="#2d7a52"
// C.gold="#c9a84c" C.goldLight="#e8c96a" C.goldPale="#f5e6b8"
// C.parchment="#f2e8d0" C.cream="#faf6ed" C.ivory="#f8f4eb"
// C.ink="#1a1a16" C.inkMid="#3d3929" C.inkLight="#7a7260" C.inkFaint="#a89e88"
// T.display = Playfair Display / T.body = Lato

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Green palette — exact from demo
        green: {
          deep:   '#0f2d1c',  // C.greenDeep — hero backgrounds
          DEFAULT:'#1a4731',  // C.green — primary (nav, buttons)
          mid:    '#236040',  // C.greenMid
          bright: '#2d7a52',  // C.greenBright — active state, success
          light:  '#4a9e72',  // C.greenLight
        },
        // Gold accent — exact from demo
        gold: {
          dark:   '#8b6914',  // C.goldDark — tee time labels
          DEFAULT:'#c9a84c',  // C.gold — borders, accents
          mid:    '#d4b060',  // C.goldMid
          light:  '#e8c96a',  // C.goldLight — headers, invite codes
          pale:   '#f5e6b8',  // C.goldPale — subtle gold text
          sheen:  '#fdf0c8',  // C.goldSheen
        },
        // Parchment backgrounds — exact from demo
        parchment: '#f2e8d0', // C.parchment — card borders
        cream:     '#faf6ed', // C.cream — page background
        ivory:     '#f8f4eb', // C.ivory — card fill
        // Text — exact from demo
        ink: {
          DEFAULT:'#1a1a16',  // C.ink — primary text
          mid:    '#3d3929',  // C.inkMid
          light:  '#7a7260',  // C.inkLight — secondary labels
          faint:  '#a89e88',  // C.inkFaint — placeholders
        },
        // Score colours from demo
        eagle:  '#fef9c3',
        birdie: '#dcfce7',
        par:    '#f1f5f9',
        bogey:  '#fee2e2',
        // Keep brand aliases for backward compat
        brand: {
          50:  '#f0faf4',
          100: '#dcfce7',
          200: '#a0cbaa',
          300: '#4a9e72',
          400: '#2d7a52',
          500: '#236040',
          600: '#1a4731',  // = green.DEFAULT
          700: '#163a28',
          800: '#0f2d1c',  // = green.deep
          900: '#0a1f14',
          950: '#0f2d1c',
        },
        surface: {
          DEFAULT: '#f8f4eb',  // = ivory
          muted:   '#faf6ed',  // = cream
          subtle:  '#e8dcc8',  // slightly darker parchment for borders
          card:    '#f8f4eb',  // = ivory
        },
        text: {
          DEFAULT: '#1a1a16',  // = ink
          muted:   '#7a7260',  // = inkLight
          subtle:  '#a89e88',  // = inkFaint
        },
        'parchment-dark': '#d9c9a3',  // C.parchmentDark — card borders
        'parchment-mid':  '#ede0c4',  // C.parchmentMid — dividers
      },
      fontFamily: {
        // Demo: T.display = Playfair Display, T.body = Lato
        display: ["var(--font-display)", "Georgia", "serif"],
        body:    ["var(--font-body)", "'Helvetica Neue'", "sans-serif"],
        sans:    ["var(--font-body)", "'Helvetica Neue'", "sans-serif"],
      },
      boxShadow: {
        // Demo: Card shadow: "0 2px 16px rgba(15,45,28,0.09),inset 0 1px 0 rgba(255,255,255,0.75)"
        card:      '0 2px 16px rgba(15,45,28,0.09), inset 0 1px 0 rgba(255,255,255,0.75)',
        'card-hover': '0 6px 28px rgba(15,45,28,0.14), inset 0 1px 0 rgba(255,255,255,0.75)',
        'card-lg': '0 4px 24px rgba(15,45,28,0.15)',
        gold:      '0 4px 18px rgba(201,168,76,0.4)',
        green:     '0 4px 18px rgba(26,71,49,0.4)',
      },
      borderRadius: {
        // Demo uses 14px for cards, 8-10 for inputs, 12-15 for buttons
        'card': '14px',
        '2xl':  '14px',
        '3xl':  '18px',
      },
    },
  },
  plugins: [],
}

export default config
