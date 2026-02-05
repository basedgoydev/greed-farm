'use client';

import { FC, useEffect, useState } from 'react';
import { api, LeaderboardEntry } from '@/lib/api';

interface GreedLeaderboardProps {
  limit?: number;
}

const SOLSCAN_URL = process.env.NEXT_PUBLIC_SOLSCAN_URL || 'https://solscan.io';

function truncateWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

export const GreedLeaderboard: FC<GreedLeaderboardProps> = ({ limit = 5 }) => {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const result = await api.getGreedLeaderboard(limit);
        setLeaderboard(result.leaderboard);
      } catch (error) {
        console.error('Error fetching leaderboard:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 30000);
    return () => clearInterval(interval);
  }, [limit]);

  return (
    <div className="relative overflow-hidden card-greed p-4">
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-greed-gold animate-pulse" />
            <span className="text-xs uppercase tracking-wider text-[#8899bb] font-medium">
              Top Greeders
            </span>
          </div>
          <span className="text-xs text-[#556688]">Net winnings</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-24">
            <div className="w-6 h-6 border-2 border-greed-gold border-t-transparent rounded-full animate-spin" />
          </div>
        ) : leaderboard.length === 0 ? (
          <div className="flex items-center justify-center h-24">
            <p className="text-sm text-[#556688]">No greeders yet</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {leaderboard.map((entry) => (
              <a
                key={entry.wallet}
                href={`${SOLSCAN_URL}/account/${entry.wallet}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-2 rounded-lg bg-greed-bg/50 border border-greed-border/50 hover:border-greed-gold/50 hover:bg-greed-gold/5 transition-all group"
              >
                <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    entry.rank === 1 ? 'bg-greed-gold/20 text-greed-gold' :
                    entry.rank === 2 ? 'bg-[#C0C0C0]/20 text-[#C0C0C0]' :
                    entry.rank === 3 ? 'bg-[#CD7F32]/20 text-[#CD7F32]' :
                    'bg-greed-border text-[#556688]'
                  }`}>
                    {entry.rank}
                  </span>
                  <span className="text-xs font-mono text-[#8899bb] group-hover:text-white transition-colors">
                    {truncateWallet(entry.wallet)}
                  </span>
                </div>
                <span className={`text-xs font-mono font-semibold ${
                  BigInt(entry.netWinnings) >= 0n ? 'text-greed-green' : 'text-greed-red'
                }`}>
                  {BigInt(entry.netWinnings) >= 0n ? '+' : ''}{entry.netWinningsSol} SOL
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
