import './globals.css';

export const metadata = {
  title: 'GOAT BOT | AI Sports Betting Intelligence',
  description: 'The sharpest AI in sports betting. Live scores, GOAT BOT pick analysis, injury intel, odds comparison, and full P/L tracking. Built for serious bettors.',
  keywords: 'sports betting, AI picks, live scores, odds, GOAT BOT, pick tracker, injury intel',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#09090F',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🐐</text></svg>" />
      </head>
      <body>{children}</body>
    </html>
  );
}
