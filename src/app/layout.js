import './globals.css';

const SITE_URL = 'https://betos.win';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'BetOS | AI-Powered Sports Betting OS',
    template: '%s | BetOS',
  },
  description:
    'The operating system for sports betting. AI-powered pick analysis, live scores, injury intel, odds comparison, and full P/L tracking. Built for serious bettors.',
  keywords: [
    'sports betting',
    'AI picks',
    'live scores',
    'odds comparison',
    'BetOS',
    'pick tracker',
    'injury intel',
    'sports analytics',
    'betting tools',
    'line shopping',
  ],
  authors: [{ name: 'BetOS' }],
  creator: 'BetOS',

  // Open Graph — powers iMessage, Facebook, Discord, Slack previews
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: 'BetOS',
    title: 'BetOS | AI-Powered Sports Betting OS',
    description:
      'AI-powered pick analysis, live scores, injury intel, odds comparison, and full P/L tracking. Built for serious bettors.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'BetOS - AI-Powered Sports Intelligence',
        type: 'image/png',
      },
    ],
  },

  // Twitter / X card
  twitter: {
    card: 'summary_large_image',
    title: 'BetOS | AI-Powered Sports Betting OS',
    description:
      'AI-powered pick analysis, live scores, injury intel, and odds comparison. Built for serious bettors.',
    images: ['/og-image.png'],
  },

  // Favicons
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },

  // SEO
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#09090F',
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>{children}</body>
    </html>
  );
}