import './globals.css';

export const metadata = {
  title: 'BetOS | AI-Powered Sports Betting OS',
  description: 'The operating system for sports betting. AI-powered pick analysis, live scores, injury intel, odds comparison, and full P/L tracking. Built for serious bettors.',
  keywords: 'sports betting, AI picks, live scores, odds, BetOS, pick tracker, injury intel',
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
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎯</text></svg>" />
      </head>
      <body>{children}</body>
    </html>
  );
}
