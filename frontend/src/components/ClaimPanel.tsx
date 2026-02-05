'use client';

import { FC, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { api, UserInfo } from '@/lib/api';
import bs58 from 'bs58';

interface ClaimPanelProps {
  userInfo: UserInfo | null;
  onAction: () => void;
}

export const ClaimPanel: FC<ClaimPanelProps> = ({ userInfo, onAction }) => {
  const { publicKey, signMessage } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const claimableLamports = userInfo?.claimable.lamports || '0';
  const claimableSol = userInfo?.claimable.sol || '0';
  const hasClaimable = BigInt(claimableLamports) > 0n;

  const handleClaim = async () => {
    if (!publicKey || !signMessage) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const message = `greed-farm:claim:${publicKey.toBase58()}:${Date.now()}`;
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(messageBytes);
      const signature = bs58.encode(signatureBytes);

      const result = await api.claim({
        wallet: publicKey.toBase58(),
        message,
        signature,
      });
      if (result.success) {
        const claimedAmount = formatSol(result.amount || '0');
        if (result.partialClaim) {
          const remaining = formatSol(result.remainingClaimable || '0');
          setSuccess(`Claimed ${claimedAmount} SOL (partial). ${remaining} SOL still available when treasury is funded.`);
        } else {
          setSuccess(`Claimed ${claimedAmount} SOL`);
        }
        onAction();
      } else if (result.remainingClaimable) {
        // Treasury empty but rewards are safe
        setError(`Treasury is currently low on funds. Your ${formatSol(result.remainingClaimable)} SOL is safe and will be claimable soon.`);
      } else {
        setError(result.message || result.error || 'Claim failed');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const formatSol = (lamports: string): string => {
    const sol = Number(lamports) / 1_000_000_000;
    if (sol < 0.001) return sol.toFixed(9);
    if (sol < 1) return sol.toFixed(6);
    return sol.toFixed(4);
  };

  if (!publicKey) {
    return (
      <div className="card-greed p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-16 h-16 rounded-xl bg-greed-green/10 border border-greed-green/30 flex items-center justify-center overflow-hidden">
            <img src="/voxelclaim.png" alt="" className="w-14 h-14 pixelated" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Claim</h3>
            <p className="text-xs text-[#556688]">Withdraw SOL rewards</p>
          </div>
        </div>
        <div className="text-center py-8 rounded-xl bg-greed-bg border border-greed-border">
          <p className="text-[#556688]">Connect wallet to claim</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden card-greed p-6 ${hasClaimable ? 'border-greed-green/50' : ''}`}>
      {/* Glow effect when claimable */}
      {hasClaimable && (
        <div className="absolute top-0 right-0 w-48 h-48 bg-greed-green/10 rounded-full blur-3xl" />
      )}

      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-6">
          <div className={`w-16 h-16 rounded-xl flex items-center justify-center overflow-hidden ${
            hasClaimable
              ? 'bg-greed-green/20 border border-greed-green/50'
              : 'bg-greed-green/10 border border-greed-green/30'
          }`}>
            <img src="/voxelclaim.png" alt="" className="w-14 h-14 pixelated" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Claim</h3>
            <p className="text-xs text-[#556688]">Withdraw SOL rewards</p>
          </div>
        </div>

        <div className="rounded-xl bg-greed-bg border border-greed-border p-5 mb-4">
          <p className="text-xs uppercase tracking-wider text-[#556688] mb-2">Available to Claim</p>
          <p className={`text-4xl font-bold font-mono ${hasClaimable ? 'text-greed-green' : 'text-[#445566]'}`}>
            {claimableSol}
          </p>
          <p className="text-xs text-[#445566] mt-1">SOL</p>
        </div>

        <button
          onClick={handleClaim}
          disabled={loading || !hasClaimable}
          className={`w-full py-3 px-4 rounded-xl font-bold transition-all flex items-center justify-center gap-3 btn-voxel ${
            hasClaimable
              ? 'bg-gradient-to-r from-greed-green to-emerald-600 text-white hover:shadow-lg hover:shadow-greed-green/20 hover:scale-105'
              : 'bg-greed-card text-[#556688] cursor-not-allowed border border-greed-border'
          }`}
        >
          {hasClaimable && (
            <img src="/voxelclaim.png" alt="" className="w-8 h-8 pixelated" />
          )}
          <span>{loading ? 'Claiming...' : hasClaimable ? 'Claim Rewards' : 'Nothing to Claim'}</span>
        </button>

        <p className="text-xs text-[#556688] text-center mt-3">
          No unstaking required to claim
        </p>

        {error && (
          <div className="mt-4 p-4 rounded-xl bg-greed-red/10 border border-greed-red/20">
            <p className="text-sm text-greed-red">{error}</p>
          </div>
        )}

        {success && (
          <div className="mt-4 p-4 rounded-xl bg-greed-green/10 border border-greed-green/20">
            <p className="text-sm text-greed-green">{success}</p>
          </div>
        )}

        {userInfo && (
          <div className="mt-4 pt-4 border-t border-greed-border">
            <p className="text-xs text-[#556688]">
              Total claimed: <span className="text-[#8899bb] font-mono">{formatSol(userInfo.stats.totalClaimed)} SOL</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
