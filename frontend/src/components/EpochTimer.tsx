'use client';

import { FC, useEffect, useState } from 'react';

interface EpochTimerProps {
  remainingMs: number | null;
  epochNumber: number;
  quorumReached?: boolean;
  countdownActive?: boolean;
}

export const EpochTimer: FC<EpochTimerProps> = ({
  remainingMs,
  epochNumber,
  quorumReached = false,
  countdownActive = false,
}) => {
  const [timeLeft, setTimeLeft] = useState(remainingMs || 0);

  // Update countdown every second
  useEffect(() => {
    if (remainingMs !== null && remainingMs > 0) {
      setTimeLeft(remainingMs);
    }
  }, [remainingMs]);

  useEffect(() => {
    if (!countdownActive || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [countdownActive, timeLeft > 0]);

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const isCountdownComplete = quorumReached && timeLeft <= 0;

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
          {isCountdownComplete ? (
            // Countdown complete - distributing
            <div className="text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-greed-green/10 border border-greed-green/30">
                <div className="w-2 h-2 rounded-full bg-greed-green animate-ping" />
                <span className="text-sm text-greed-green font-medium">Distributing...</span>
              </div>
              <p className="text-[10px] text-[#556688] mt-2">Rewards being distributed</p>
            </div>
          ) : quorumReached && countdownActive ? (
            // Quorum reached - show countdown
            <div className="text-center">
              <div className="text-4xl font-bold font-mono text-greed-green mb-2">
                {formatTime(timeLeft)}
              </div>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-greed-green/10 border border-greed-green/30">
                <svg className="w-4 h-4 text-greed-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm text-greed-green font-medium">Distribution in progress</span>
              </div>
              <p className="text-[10px] text-[#556688] mt-2">Rewards will be distributed when timer ends</p>
            </div>
          ) : (
            // Waiting for quorum
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
