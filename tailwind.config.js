/** @type {import('tailwindcss').Config} */
import defaultTheme from 'tailwindcss/defaultTheme'

export default {
  darkMode: ['class'],
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './scenes/**/*.{js,ts,jsx,tsx}',
  ],
  safelist: ['dark'],
  theme: {
    screens: defaultTheme.screens,
    extend: {
      colors: {
        white: '#FFFFFF',
        black: '#000000',
        gray: {
          200: '#E5E7EB',
          300: '#1F2937',
          400: '#4B5563',
          500: '#6B7280',
          600: '#525252',
          700: '#404040',
          800: '#2D2D2D',
          900: '#1A1A1A',
        },
        green: '#22C55E',
        'green-500': '#22C55E',
        red: '#EF4444',
        'red-500': '#EF4444',
        neon: {
          blue: '#00BFFF',
          green: '#00ff99',
          purple: '#C71585',
        },
        'white-light': '#E5E7EB',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
        },
      },
      fontFamily: {
        inter: ['var(--font-inter)', 'sans-serif'],
        roboto: ['var(--font-roboto)', 'sans-serif'],
        satoshi: ['var(--font-satoshi)', 'sans-serif'],
        mono: ['Courier New', 'monospace'],
        plexmono: ['var(--font-plexmono)', 'monospace'],
        jetbrains: ['var(--font-jetbrains)', 'monospace'],
        saira: ['var(--font-saira)', 'sans-serif'],
      },
      fontSize: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
      },
      boxShadow: {
        glow: '0 0 8px rgba(0, 191, 255, 0.3), 0 0 16px rgba(0, 191, 255, 0.2)',
        card: '0 4px 12px rgba(0, 0, 0, 0.3)',
        'glow-neon': '0 0 8px rgba(0, 191, 255, 0.3)',
      },
      transitionProperty: {
        'transform-shadow': 'transform, box-shadow',
        'transform-opacity': 'transform, opacity',
      },
      backgroundImage: {
        gradient: 'linear-gradient(to right, #1A1A1A, #2D2D2D)',
        tech: 'linear-gradient(to bottom right, rgba(0, 0, 0, 0.85) 0%, rgba(26, 26, 26, 0.7) 50%, rgba(0, 191, 255, 0.5) 80%, rgba(34, 197, 94, 0.4) 100%)',
        galaxy:
          'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(17, 24, 39, 0.9))',
        light:
          'linear-gradient(135deg, rgba(204, 210, 223, 0.9), rgba(58, 47, 47, 1), rgba(17, 24, 39, 0.9))',
      },
      backgroundOpacity: {
        10: '0.1',
        15: '0.15',
        95: '0.95',
      },
      borderOpacity: {
        10: '0.1',
        20: '0.2',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    function ({ addUtilities }) {
      const utilities = {
        '.perspective-1000': { perspective: '1000px' },
        '.transform-style-3d': { 'transform-style': 'preserve-3d' },
      }
      const delayUtilities = {}
      for (let i = 1; i <= 13; i++) {
        delayUtilities[`.animation-delay-${i}`] = { 'animation-delay': `${i * 0.01}s` }
      }
      addUtilities({ ...utilities, ...delayUtilities })
    },
    require('tailwindcss-animate'),
  ],
  // variants: {
  //   extend: {
  //     display: ['group-hover'],
  //   },
  // },
}
