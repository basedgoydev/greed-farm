import type { Metadata } from 'next';
import { Press_Start_2P, VT323 } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

// Pixel fonts for gaming aesthetic
const pressStart = Press_Start_2P({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-pixel',
});

const vt323 = VT323({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-pixel-body',
});

export const metadata: Metadata = {
  title: 'GreedFi - Be greedy. Get rewarded.',
  description:
    'Finally, a protocol that rewards you for your worst personality trait. Like Israeli real estate - the more you hold, the more you gain.',
  icons: {
    icon: [
      { url: '/voxeljew.png', sizes: '32x32', type: 'image/png' },
      { url: '/voxeljew.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/voxeljew.png',
  },
  openGraph: {
    title: 'GreedFi - Be greedy. Get rewarded.',
    description: 'Finally, a protocol that rewards you for your worst personality trait. Like Israeli real estate - the more you hold, the more you gain.',
    images: ['/voxeljew.png'],
  },
  twitter: {
    card: 'summary',
    title: 'GreedFi - Be greedy. Get rewarded.',
    description: 'Finally, a protocol that rewards you for your worst personality trait. Like Israeli real estate - the more you hold, the more you gain.',
    images: ['/voxeljew.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${pressStart.variable} ${vt323.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
