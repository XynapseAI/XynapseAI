/** @type {import('tailwindcss').Config} */
import defaultTheme from 'tailwindcss/defaultTheme';

export default {
	darkMode: ['class'],
	content: [
		'./app/**/*.{js,ts,jsx,tsx}',
		'./pages/**/*.{js,ts,jsx,tsx}',
		'./components/**/*.{js,ts,jsx,tsx}',
		'./scenes/**/*.{js,ts,jsx,tsx}',
	],
	theme: {
		extend: {
			colors: {
				white: '#FFFFFF',
				black: '#000000',
				gray: {
					'200': '#E5E7EB',
					'300': '#1F2937',
					'400': '#4B5563',
					'500': '#6B7280',
					'600': '#525252',
					'700': '#404040',
					'800': '#2D2D2D',
					'900': '#1A1A1A'
				},
				green: '#22C55E',
				'green-500': '#22C55E',
				red: '#EF4444',
				'red-500': '#EF4444',
				neon: {
					blue: '#00BFFF',
					green: '#00ff99',
					purple: '#C71585'
				},
				'white-light': '#E5E7EB',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				chart: {
					'1': 'hsl(var(--chart-1))',
					'2': 'hsl(var(--chart-2))',
					'3': 'hsl(var(--chart-3))',
					'4': 'hsl(var(--chart-4))',
					'5': 'hsl(var(--chart-5))'
				}
			},
			fontFamily: {
				inter: ['Inter', 'sans-serif'],
				roboto: ['Roboto', 'sans-serif'],
				satoshi: ['Satoshi', 'Inter', 'Roboto', 'sans-serif'],
				mono: ['Courier New', 'monospace'],
				plexmono: ['IBM Plex Mono', 'monospace'],
				jetbrains: ['JetBrains Mono', 'monospace'],
				saira: ['Saira', 'sans-serif'],
			},
			fontSize: {
				xs: '0.75rem',
				sm: '0.875rem',
				base: '1rem',
				lg: '1.125rem',
				xl: '1.25rem',
				'2xl': '1.5rem'
			},
			boxShadow: {
				glow: '0 0 8px rgba(0, 191, 255, 0.3), 0 0 16px rgba(0, 191, 255, 0.2)',
				card: '0 4px 12px rgba(0, 0, 0, 0.3)',
				'glow-neon': '0 0 8px rgba(0, 191, 255, 0.3)'
			},
			transitionProperty: {
				'transform-shadow': 'transform, box-shadow',
				'transform-opacity': 'transform, opacity'
			},
			backgroundImage: {
				gradient: 'linear-gradient(to right, #1A1A1A, #2D2D2D)',
				tech: 'linear-gradient(to bottom right, rgba(0, 0, 0, 0.85) 0%, rgba(26, 26, 26, 0.7) 50%, rgba(0, 191, 255, 0.5) 80%, rgba(34, 197, 94, 0.4) 100%)',
				galaxy: 'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(17, 24, 39, 0.9))',
				light: 'linear-gradient(135deg, rgba(204, 210, 223, 0.9), rgba(58, 47, 47, 1), rgba(17, 24, 39, 0.9))'
			},
			backgroundOpacity: {
				'10': '0.1',
				'15': '0.15',
				'95': '0.95'
			},
			borderOpacity: {
				'10': '0.1',
				'20': '0.2'
			},
			keyframes: {
				matrixFlip: {
					'0%': { transform: 'rotateX(0)' },
					'10%': { transform: 'rotateX(180deg)' },
					'20%': { transform: 'rotateX(360deg)' },
					'30%': { transform: 'rotateX(540deg)' },
					'40%': { transform: 'rotateX(720deg)' },
					'50%': { transform: 'rotateX(900deg)' },
					'60%': { transform: 'rotateX(1080deg)' },
					'70%': { transform: 'rotateX(1260deg)' },
					'80%': { transform: 'rotateX(1440deg)' },
					'100%': { transform: 'rotateX(0)' }
				},
				flicker: {
					'0%, 100%': { opacity: '1', color: '#C71585' },
					'10%': { opacity: '0.2', color: '#00BFFF' },
					'20%': { opacity: '0.8', color: '#C71585' },
					'30%': { opacity: '0.1', color: '#00BFFF' },
					'40%': { opacity: '1', color: '#C71585' },
					'50%': { opacity: '0.5', color: '#00BFFF' },
					'60%': { opacity: '1', color: '#C71585' },
					'70%': { opacity: '0.3', color: '#00BFFF' },
					'80%': { opacity: '0.9', color: '#C71585' },
					'90%': { opacity: '0.2', color: '#00BFFF' }
				},
				shufflePosition: {
					'0%': { transform: 'translateX(0)' },
					'20%': { transform: 'translateX(var(--shuffle-offset-1))' },
					'40%': { transform: 'translateX(var(--shuffle-offset-2))' },
					'60%': { transform: 'translateX(var(--shuffle-offset-3))' },
					'80%': { transform: 'translateX(var(--shuffle-offset-1))' },
					'100%': { transform: 'translateX(0)' }
				}
			},
			animation: {
				'matrix-flip': 'matrixFlip 0.4s ease-in-out',
				flicker: 'ficker 0.3s linear 3',
				'shuffle-position': 'shufflePosition 0.4s ease-in-out'
			},
			animationDelay: {
				'0': '0s',
				'1': '0.1s',
				'12': '0.12s',
				'15': '0.15s',
				'05': '0.05s',
				'03': '0.03s',
				'08': '0.08s',
				'04': '0.04s',
				'07': '0.07s',
				'01': '0.01s',
				'06': '0.06s',
				'02': '0.02s',
				'09': '0.09s'
			},
			borderRadius: {
				...defaultTheme.borderRadius,
				// lg: 'var(--radius)',
				// md: 'calc(var(--radius) - 2px)',
				// sm: 'calc(var(--radius) - 4px)',
			}
		}
	},
	plugins: [
		require('@tailwindcss/typography'),
		function ({ addUtilities }) {
			const newUtilities = {
				'.perspective-1000': { perspective: '1000px' },
				'.transform-style-3d': { 'transform-style': 'preserve-3d' },
			};
			addUtilities(newUtilities);
		},
		require("tailwindcss-animate")
	],
	variants: {
		extend: {
			display: ['group-hover'],
		},
	},
};
