'use client';

import { FC } from 'react';

interface EpochTimerProps {
  remainingMs: number;
  epochNumber: number;
  quorumReached?: boolean;
}

export const EpochTimer: FC<EpochTimerProps> = ({
  epochNumber,
  quorumReached = false,
}) => {
  return (
    <div className="relative overflow-hidden card-greed p-4">
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${quorumReached ? 'bg-greed-green' : 'bg-israel-blue'} animate-pulse`} />
            <span className="text-xs uppercase tracking-wider text-[#8899bb] font-medium">
              Epoch #{epochNumber}
            </span>
          </div>
          <span className="text-xs text-[#556688]">Status</span>
        </div>

        <div className="flex items-center justify-center py-4">
          {quorumReached ? (
            <div className="text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-greed-green/10 border border-greed-green/30">
                <div className="w-2 h-2 rounded-full bg-greed-green animate-ping" />
                <span className="text-sm text-greed-green font-medium">Distributing...</span>
              </div>
              <p className="text-[10px] text-[#556688] mt-2">Rewards being distributed</p>
            </div>
          ) : (
            <div className="text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-greed-gold/10 border border-greed-gold/30">
                <svg className="w-4 h-4 text-greed-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm text-greed-gold font-medium">Waiting for quorum</span>
              </div>
              <p className="text-[10px] text-[#556688] mt-2">Stake more to reach quorum</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
