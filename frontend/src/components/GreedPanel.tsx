'use client';

import { FC, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { api, UserInfo, GameStatus, VerifyResult } from '@/lib/api';
import bs58 from 'bs58';

interface GreedPanelProps {
  userInfo: UserInfo | null;
  greedPot: GameStatus['greedPot'] | null;
  onAction: () => void;
}

type RiskLevel = 25 | 50 | 100;

// Generate a random client seed
function generateClientSeed(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export const GreedPanel: FC<GreedPanelProps> = ({
  userInfo,
  greedPot,
  onAction,
}) => {
  const { publicKey, signMessage } = useWallet();
  const [selectedRisk, setSelectedRisk] = useState<RiskLevel>(25);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    won: boolean;
    riskAmount: string;
    payoutAmount: string;
    greedId: number;
    serverSeed: string;
    serverSeedHash: string;
    clientSeed: string;
  } | null>(null);
  const [verifyData, setVerifyData] = useState<VerifyResult | null>(null);
  const [showVerify, setShowVerify] = useState(false);

  const claimableLamports = userInfo?.claimable.lamports || '0';
  const hasClaimable = BigInt(claimableLamports) > 0n;

  const riskLevels: { value: RiskLevel; label: string; desc: string }[] = [
    { value: 25, label: '25%', desc: 'Low' },
    { value: 50, label: '50%', desc: 'Medium' },
    { value: 100, label: '100%', desc: 'Degen' },
  ];

  const calculateRiskAmount = (): string => {
    const claimable = BigInt(claimableLamports);
    const riskAmount = (claimable * BigInt(selectedRisk)) / 100n;
    const sol = Number(riskAmount) / 1_000_000_000;
    return sol.toFixed(6);
  };

  const handleGreed = async () => {
    if (!publicKey || !signMessage) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setVerifyData(null);
    setShowVerify(false);

    try {
      // Step 1: Get commitment from server
      setLoadingStage('Getting commitment...');
      const commitMessage = `greed-farm:greed:${publicKey.toBase58()}:${Date.now()}`;
      const commitMessageBytes = new TextEncoder().encode(commitMessage);
      const commitSignatureBytes = await signMessage(commitMessageBytes);
      const commitSignature = bs58.encode(commitSignatureBytes);

      const commitResult = await api.greedCommit({
        wallet: publicKey.toBase58(),
        message: commitMessage,
        signature: commitSignature,
      });

      if (!commitResult.success || !commitResult.commitmentId) {
        setError(commitResult.message || 'Failed to get commitment');
        return;
      }

      // Step 2: Generate client seed
      const clientSeed = generateClientSeed();
      const serverSeedHash = commitResult.serverSeedHash!;

      // Step 3: Execute the bet
      setLoadingStage('Rolling...');
      const greedMessage = `greed-farm:greed:${publicKey.toBase58()}:${Date.now()}`;
      const greedMessageBytes = new TextEncoder().encode(greedMessage);
      const greedSignatureBytes = await signMessage(greedMessageBytes);
      const greedSignature = bs58.encode(greedSignatureBytes);

      const apiResult = await api.greed({
        wallet: publicKey.toBase58(),
        message: greedMessage,
        signature: greedSignature,
        riskPercentage: selectedRisk,
        commitmentId: commitResult.commitmentId,
        clientSeed,
      });

      if (apiResult.success) {
        setResult({
          won: apiResult.won!,
          riskAmount: apiResult.riskAmount!,
          payoutAmount: apiResult.payoutAmount!,
          greedId: apiResult.greedId!,
          serverSeed: apiResult.serverSeed!,
          serverSeedHash,
          clientSeed,
        });
        onAction();
      } else {
        setError(apiResult.message);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setLoadingStage('');
    }
  };

  const handleVerify = async () => {
    if (!result?.greedId) return;
    try {
      const data = await api.greedVerify(result.greedId);
      setVerifyData(data);
      setShowVerify(true);
    } catch (err) {
      setError((err as Error).message);
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
      <div className="card-greed p-6 border-greed-gold/20">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-16 h-16 rounded-xl bg-greed-gold/10 border border-greed-gold/30 flex items-center justify-center overflow-hidden">
            <img src="/voxelgreed.png" alt="" className="w-14 h-14 pixelated" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Greed</h3>
            <p className="text-xs text-[#556688]">Risk for higher rewards</p>
          </div>
        </div>
        <div className="text-center py-8 rounded-xl bg-greed-bg border border-greed-border">
          <p className="text-[#556688]">Connect wallet to play</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden card-greed p-6 border-greed-gold/20">
      {/* Background glow */}
      <div className="absolute top-0 right-0 w-48 h-48 bg-greed-gold/5 rounded-full blur-3xl" />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-xl bg-greed-gold/10 border border-greed-gold/30 flex items-center justify-center overflow-hidden">
              <img src="/voxelgreed.png" alt="" className="w-14 h-14 pixelated" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Greed</h3>
              <p className="text-xs text-[#556688]">50/50 to win big</p>
            </div>
          </div>
          <span className="tag tag-gold">High Risk</span>
        </div>

        {/* Pot display */}
        <div className="rounded-xl bg-gradient-to-br from-greed-gold/10 to-transparent border border-greed-gold/20 p-4 mb-5">
          <p className="text-xs uppercase tracking-wider text-[#8899bb] mb-1">Greed Pot</p>
          <p className="text-3xl font-bold text-greed-gold text-glow-gold font-mono">{greedPot?.sol || '0'}</p>
          <p className="text-xs text-[#556688]">SOL available to win</p>
        </div>

        {result ? (
          <div className={`rounded-xl p-6 mb-4 ${
            result.won
              ? 'bg-greed-green/10 border border-greed-green/30'
              : 'bg-greed-red/10 border border-greed-red/30'
          }`}>
            <div className="text-center">
              <div className={`w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center ${
                result.won ? 'bg-greed-green/20' : 'bg-greed-red/20'
              }`}>
                {result.won ? (
                  <svg className="w-8 h-8 text-greed-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-8 h-8 text-greed-red" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
              </div>
              <p className={`text-xl font-bold ${result.won ? 'text-greed-green' : 'text-greed-red'}`}>
                {result.won ? 'You Won' : 'You Lost'}
              </p>
              <p className="text-sm text-[#8899bb] mt-2 font-mono">
                {result.won
                  ? `+${formatSol(result.payoutAmount)} SOL`
                  : `-${formatSol(result.riskAmount)} SOL`}
              </p>
            </div>

            {/* Provably Fair Info */}
            <div className="mt-4 pt-4 border-t border-greed-border/30">
              <button
                onClick={handleVerify}
                className="flex items-center gap-2 text-xs text-greed-gold hover:text-greed-gold/80 transition-colors mx-auto"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Verify Fairness
              </button>

              {showVerify && verifyData && (
                <div className="mt-3 p-3 rounded-lg bg-greed-bg/50 text-left">
                  <p className="text-[10px] uppercase tracking-wider text-[#556688] mb-2">Verification Data</p>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-[#556688]">Commitment: </span>
                      <span className="text-[#8899bb] font-mono break-all">{result.serverSeedHash.substring(0, 16)}...</span>
                    </div>
                    <div>
                      <span className="text-[#556688]">Server Seed: </span>
                      <span className="text-[#8899bb] font-mono break-all">{result.serverSeed.substring(0, 16)}...</span>
                    </div>
                    <div>
                      <span className="text-[#556688]">Client Seed: </span>
                      <span className="text-[#8899bb] font-mono break-all">{result.clientSeed}</span>
                    </div>
                    {verifyData.combinedHash && (
                      <div>
                        <span className="text-[#556688]">Result Hash: </span>
                        <span className="text-[#8899bb] font-mono break-all">{verifyData.combinedHash.substring(0, 16)}...</span>
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-[10px] text-[#556688]">
                    Verify: SHA256(server_seed) = commitment, then HMAC-SHA256(server_seed, client_seed) first 8 hex chars {"<"} 0x80000000 = win
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={() => { setResult(null); setVerifyData(null); setShowVerify(false); }}
              className="mt-4 text-sm text-[#8899bb] hover:text-white transition-colors block mx-auto"
            >
              Play again
            </button>
          </div>
        ) : (
          <>
            {/* Risk selector */}
            <div className="mb-4">
              <p className="text-xs uppercase tracking-wider text-[#556688] mb-3">Risk Level</p>
              <div className="grid grid-cols-3 gap-2">
                {riskLevels.map(({ value, label, desc }) => (
                  <button
                    key={value}
                    onClick={() => setSelectedRisk(value)}
                    disabled={!hasClaimable}
                    className={`py-3 px-4 rounded-xl font-medium transition-all ${
                      selectedRisk === value
                        ? 'bg-greed-gold text-greed-bg'
                        : 'bg-greed-card text-white hover:bg-greed-card-hover border border-greed-border'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <span className="block text-lg font-bold">{label}</span>
                    <span className="text-[10px] uppercase tracking-wider opacity-70">{desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Risk info */}
            <div className="rounded-xl bg-greed-bg border border-greed-border p-4 mb-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[#556688]">Risking</span>
                <span className="text-greed-gold font-mono">{calculateRiskAmount()} SOL</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#556688]">Potential Win</span>
                <span className="text-greed-green font-mono">+{calculateRiskAmount()} SOL</span>
              </div>
            </div>

            <button
              onClick={handleGreed}
              disabled={loading || !hasClaimable}
              className={`w-full py-3 px-4 rounded-xl font-bold transition-all flex items-center justify-center gap-3 btn-voxel ${
                hasClaimable
                  ? 'btn-gold hover:scale-105'
                  : 'bg-greed-card text-[#556688] cursor-not-allowed border border-greed-border'
              }`}
            >
              {hasClaimable && (
                <img src="/voxelgreed.png" alt="" className="w-8 h-8 pixelated" />
              )}
              <span>{loading ? loadingStage || 'Processing...' : hasClaimable ? 'Test Your Greed' : 'Need Claimable SOL'}</span>
            </button>

            {/* Rules */}
            <div className="mt-4 space-y-1">
              <p className="text-[10px] text-[#556688] flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-greed-gold" />
                50% chance to win
              </p>
              <p className="text-[10px] text-[#556688] flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-greed-gold" />
                Win: risk + bonus from pot
              </p>
              <p className="text-[10px] text-[#556688] flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-greed-gold" />
                Lose: risk goes to pot
              </p>
              <p className="text-[10px] text-greed-green flex items-center gap-2">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Provably fair - verify every bet
              </p>
            </div>
          </>
        )}

        {error && (
          <div className="mt-4 p-4 rounded-xl bg-greed-red/10 border border-greed-red/20">
            <p className="text-sm text-greed-red">{error}</p>
          </div>
        )}

        {userInfo && (
          <div className="mt-4 pt-4 border-t border-greed-border grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-[#556688] uppercase">Won</p>
              <p className="text-sm text-greed-green font-mono">{formatSol(userInfo.stats.totalWon)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#556688] uppercase">Lost</p>
              <p className="text-sm text-greed-red font-mono">{formatSol(userInfo.stats.totalLost)}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
