'use client';

import { FC } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useGameState } from '@/hooks/useGameState';
import { Header } from './Header';
import { StatCard } from './StatCard';
import { EpochTimer } from './EpochTimer';
import { HarvestProgress } from './HarvestProgress';
import { GreedLeaderboard } from './GreedLeaderboard';
import { StakePanel } from './StakePanel';
import { ClaimPanel } from './ClaimPanel';
import { GreedPanel } from './GreedPanel';
import { Logo } from './Logo';

export const Dashboard: FC = () => {
  const { connected } = useWallet();
  const { status, userInfo, loading, error, refresh } = useGameState();

  if (loading && !status) {
    return (
      <div className="min-h-screen bg-star-animated">
        <Header />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-israel-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-[#556688]">Loading protocol data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="min-h-screen bg-star-pattern">
        <Header />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="text-center card-greed p-8">
            <p className="text-greed-red text-xl mb-4">Failed to connect to protocol</p>
            <p className="text-[#556688] mb-6">{error}</p>
            <button
              onClick={refresh}
              className="px-8 py-3 btn-primary rounded-xl"
            >
              Retry Connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-star-animated">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pt-24">
        {/* Hero Section */}
        <div className="relative overflow-hidden card-greed-highlight p-8 md:p-12 mb-8">
          {/* Background decoration */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-israel-blue/5 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-greed-gold/5 rounded-full blur-3xl" />

          <div className="relative z-10 max-w-2xl">
            <div className="tag tag-blue mb-4">Israeli Protocol</div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 leading-tight">
              Be greedy.<br />
              <span className="text-glow-blue text-israel-blue-light">Get rewarded.</span>
            </h1>
            <p className="text-[#8899bb] text-lg mb-8 leading-relaxed">
              Finally, a protocol that rewards you for your worst personality trait.
              Like Israeli real estate - the more you hold, the more you gain.
            </p>

            <div className="flex flex-wrap gap-4">
              {connected ? (
                <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-greed-green/10 border border-greed-green/30">
                  <div className="w-2 h-2 rounded-full bg-greed-green animate-pulse" />
                  <span className="text-sm text-greed-green font-medium">Wallet Connected</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-greed-card border border-greed-border">
                  <div className="w-2 h-2 rounded-full bg-israel-blue animate-pulse" />
                  <span className="text-sm text-white font-medium">Connect wallet to start</span>
                </div>
              )}
            </div>
          </div>

          {/* Voxel Jew Hero Image */}
          <div className="absolute right-8 top-1/2 -translate-y-1/2 hidden lg:block">
            <div className="relative animate-float">
              <img
                src="/voxeljew.png"
                alt="GreedFi Mascot"
                className="w-48 h-48 pixelated drop-shadow-voxel-lg"
              />
              <div className="absolute -inset-4 bg-israel-blue/20 rounded-full blur-2xl -z-10" />
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard
            title="Treasury"
            value={`${status?.sharedPool?.pending || '0'} SOL`}
            subtitle="Next distribution"
            variant="blue"
          />
          <StatCard
            title="Greed Pot"
            value={`${status?.greedPot.sol || '0'} SOL`}
            subtitle="High-risk pool"
            variant="gold"
          />
          <StatCard
            title="Total Staked"
            value={(() => {
              if (!status?.totalStaked.tokens || !status?.config.totalSupply) return '0%';
              const decimals = parseInt(process.env.NEXT_PUBLIC_TOKEN_DECIMALS || '6');
              const staked = BigInt(status.totalStaked.tokens);
              const supply = BigInt(status.config.totalSupply) * BigInt(10 ** decimals);
              const pct = Number((staked * 10000n) / supply) / 100;
              return `${pct.toFixed(2)}%`;
            })()}
            subtitle="Of total supply"
            variant="default"
          />
          <StatCard
            title="Your Rewards"
            value={`${userInfo?.claimable.sol || '0'} SOL`}
            subtitle={connected ? 'Ready to claim' : 'Connect wallet'}
            variant="blue"
            highlight={connected && BigInt(userInfo?.claimable.lamports || '0') > 0n}
          />
        </div>

        {/* Timer, Progress, and Leaderboard Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          <EpochTimer
            remainingMs={status?.nextEpoch.inMs || 0}
            epochNumber={status?.currentEpoch || 1}
            quorumReached={(status?.harvest?.percentage || 0) >= 100}
          />
          <HarvestProgress
            harvest={status?.harvest || null}
            quorumPercentage={status?.config.quorumPercentage || 26}
          />
          <GreedLeaderboard limit={5} />
        </div>

        {/* Main Action Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <StakePanel
            userInfo={userInfo}
            warmupDuration={status?.config.warmupDuration || 300}
            onAction={refresh}
          />
          <ClaimPanel userInfo={userInfo} onAction={refresh} />
          <GreedPanel
            userInfo={userInfo}
            greedPot={status?.greedPot || null}
            onAction={refresh}
          />
        </div>

        {/* How It Works Section */}
        <div className="card-greed p-6 md:p-8 mb-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-israel-blue/10 border border-israel-blue/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-israel-blue-light" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">How GreedFi Works</h2>
              <p className="text-sm text-[#556688]">Be greedy. Get rewarded.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                step: '01',
                title: 'Stake',
                description: 'Lock your tokens like your grandma locks her jewelry. After warmup, you\'re officially in.',
                color: 'blue',
              },
              {
                step: '02',
                title: 'Accumulate',
                description: 'Fees pile up like guilt at a family dinner. 90% for stakers, 10% for the degens.',
                color: 'blue',
              },
              {
                step: '03',
                title: 'Harvest',
                description: 'When enough people show up, we split the loot. Democracy, but for money.',
                color: 'blue',
              },
              {
                step: '04',
                title: 'Greed',
                description: 'Feeling lucky? Gamble your earnings like it\'s your Bar Mitzvah money. Mom doesn\'t need to know.',
                color: 'gold',
              },
            ].map((item) => (
              <div
                key={item.step}
                className={`rounded-xl p-5 ${
                  item.color === 'gold'
                    ? 'bg-greed-gold/5 border border-greed-gold/20'
                    : 'bg-israel-blue/5 border border-israel-blue/20'
                }`}
              >
                <div className="flex items-center gap-3 mb-3">
                  <span className={`text-2xl font-bold ${
                    item.color === 'gold' ? 'text-greed-gold' : 'text-israel-blue'
                  }`}>
                    {item.step}
                  </span>
                  <span className={`text-lg font-semibold ${
                    item.color === 'gold' ? 'text-greed-gold' : 'text-israel-blue-light'
                  }`}>
                    {item.title}
                  </span>
                </div>
                <p className="text-sm text-[#8899bb] leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Token Info */}
        <div className="card-greed p-6 mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Token icon */}
              <img
                src="/logo.jpg"
                alt="GFI Token"
                className="w-14 h-14 rounded-xl pixelated drop-shadow-voxel"
              />
              <div>
                <p className="text-xs text-[#556688] uppercase tracking-wider mb-1">Token</p>
                <p className="text-white font-semibold">GreedFi - $GFI</p>
              </div>
            </div>

            <div className="text-right">
              <p className="text-xs text-[#556688] uppercase tracking-wider mb-1">Contract</p>
              <p className="text-sm text-israel-blue-light font-mono">
                {process.env.NEXT_PUBLIC_TOKEN_MINT && process.env.NEXT_PUBLIC_TOKEN_MINT.length > 10
                  ? `${process.env.NEXT_PUBLIC_TOKEN_MINT.slice(0, 4)}...${process.env.NEXT_PUBLIC_TOKEN_MINT.slice(-4)}`
                  : 'Coming Soon'}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center pb-8">
          <div className="divider-blue w-48 mx-auto mb-6" />
          <div className="flex items-center justify-center gap-2 mb-4">
            <Logo size="sm" />
          </div>
          <p className="text-sm text-[#556688] mb-4 max-w-lg mx-auto">
            Finally, a protocol that rewards you for your worst personality trait. Like Israeli real estate - the more you hold, the more you gain.
          </p>
          <div className="flex items-center justify-center gap-4">
            <a
              href="https://x.com/GreedFiSOL/"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg bg-greed-card border border-greed-border text-sm text-[#8899bb] hover:border-israel-blue hover:text-white transition-all flex items-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Follow us
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
};
