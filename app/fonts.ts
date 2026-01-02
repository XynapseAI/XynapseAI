// app/fonts.ts 

import { Inter, Roboto, JetBrains_Mono, IBM_Plex_Mono, Saira } from 'next/font/google'
import localFont from 'next/font/local'

// Inter (Google Fonts)
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

// Roboto (Google Fonts)
const roboto = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-roboto',
  display: 'swap',
})

// JetBrains Mono (Google Fonts)
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-jetbrains',
  display: 'swap',
})

// IBM Plex Mono (Google Fonts)
const plexmono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plexmono',
  display: 'swap',
})

// Saira (Google Fonts)
const saira = Saira({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-saira',
  display: 'swap',
})

// const satoshi = localFont({
//   src: [
//     {
//       path: '../public/fonts/Satoshi-Light.woff2',
//       weight: '300',
//       style: 'normal',
//     },
//     {
//       path: '../public/fonts/Satoshi-Regular.woff2',
//       weight: '400',
//       style: 'normal',
//     },
//     {
//       path: '../public/fonts/Satoshi-Medium.woff2',
//       weight: '500',
//       style: 'normal',
//     },
//     {
//       path: '../public/fonts/Satoshi-Bold.woff2',
//       weight: '700',
//       style: 'normal',
//     },
//     {
//       path: '../public/fonts/Satoshi-Black.woff2',
//       weight: '900',
//       style: 'normal',
//     },
//   ],
//   variable: '--font-satoshi',
//   display: 'swap',
// });

export { inter, roboto, jetbrains, plexmono, saira }
