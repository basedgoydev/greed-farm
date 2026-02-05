'use client';

import { useState, useEffect } from 'react';

export function useCountdown(targetMs: number) {
  const [remaining, setRemaining] = useState(targetMs);

  useEffect(() => {
    setRemaining(targetMs);

    const interval = setInterval(() => {
      setRemaining((prev) => Math.max(0, prev - 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [targetMs]);

  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  return {
    remaining,
    hours,
    minutes,
    seconds,
    formatted: `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
    isComplete: remaining <= 0,
  };
}
