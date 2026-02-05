'use client';

import { FC } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Logo } from './Logo';

export const Header: FC = () => {
  const { connected, publicKey } = useWallet();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-greed-border bg-greed-bg/90 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex justify-between items-center h-16">
          {/* Logo and X link */}
          <div className="flex items-center gap-4">
            <a
              href="https://x.com/GreedFiSOL/"
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 rounded-lg bg-greed-card border border-greed-border flex items-center justify-center hover:border-israel-blue hover:bg-greed-card-hover transition-all"
              title="Follow us on X"
            >
              <svg className="w-5 h-5 text-[#8899bb] hover:text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <Logo size="md" />
          </div>

          {/* Right side */}
          <div className="flex items-center gap-4">
            {/* Network indicator */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-greed-card border border-greed-border">
              <div className="w-2 h-2 rounded-full bg-greed-green animate-pulse" />
              <span className="text-xs text-[#8899bb] font-medium uppercase tracking-wider">Mainnet</span>
            </div>

            {/* Connected wallet */}
            {connected && publicKey && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-greed-card border border-greed-border">
                <div className="w-2 h-2 rounded-full bg-greed-green" />
                <span className="text-sm text-[#8899bb] font-mono">
                  {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
                </span>
              </div>
            )}

            {/* Wallet button */}
            <WalletMultiButton />
          </div>
        </div>
      </div>
    </header>
  );
};
