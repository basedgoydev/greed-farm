'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { api, GameStatus, UserInfo } from '@/lib/api';

export function useGameState() {
  const { publicKey } = useWallet();
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.getStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const fetchUserInfo = useCallback(async () => {
    if (!publicKey) {
      setUserInfo(null);
      return;
    }

    try {
      const data = await api.getUserInfo(publicKey.toBase58());
      setUserInfo(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [publicKey]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStatus(), fetchUserInfo()]);
    setLoading(false);
  }, [fetchStatus, fetchUserInfo]);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Refresh when wallet changes
  useEffect(() => {
    fetchUserInfo();
  }, [publicKey, fetchUserInfo]);

  return {
    status,
    userInfo,
    loading,
    error,
    refresh,
  };
}
