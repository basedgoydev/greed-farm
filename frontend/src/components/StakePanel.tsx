'use client';

import { FC, useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  getAccount,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { api, UserInfo } from '@/lib/api';
import { useCountdown } from '@/hooks/useCountdown';
import bs58 from 'bs58';

const TREASURY_WALLET = process.env.NEXT_PUBLIC_TREASURY_WALLET || 'HP2QViWXzNvhe36ju7bsFFpwUhMqm9vFEEMtDggJe66G';
const TOKEN_MINT = process.env.NEXT_PUBLIC_TOKEN_MINT || 'Few5c3UE7gjeWkqsFMtzPGh2TCmaiN7Kg6ohoN6pc4ae';

interface StakePanelProps {
  userInfo: UserInfo | null;
  warmupDuration: number;
  onAction: () => void;
}

export const StakePanel: FC<StakePanelProps> = ({
  userInfo,
  warmupDuration,
  onAction,
}) => {
  const { publicKey, sendTransaction, signMessage } = useWallet();
  const { connection } = useConnection();
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [showAddMore, setShowAddMore] = useState(false);

  const stakedAmount = userInfo?.stake.amount || '0';
  const isStaked = BigInt(stakedAmount) > 0n;
  const warmupRemaining = userInfo?.stake.warmupRemaining || 0;

  const warmupCountdown = useCountdown(warmupRemaining);

  // Fetch wallet balance on mount and when wallet changes
  useEffect(() => {
    const fetchBalanceOnly = async () => {
      if (!publicKey) return;
      try {
        const tokenMint = new PublicKey(TOKEN_MINT);
        const tokenAccount = getAssociatedTokenAddressSync(
          tokenMint,
          publicKey,
          false,
          TOKEN_2022_PROGRAM_ID
        );
        const account = await getAccount(connection, tokenAccount, 'confirmed', TOKEN_2022_PROGRAM_ID);
        const decimals = parseInt(process.env.NEXT_PUBLIC_TOKEN_DECIMALS || '6');
        const balance = Number(account.amount) / 10 ** decimals;
        setWalletBalance(balance.toLocaleString());
      } catch (err) {
        console.error('Error fetching balance:', err);
        setWalletBalance('0');
      }
    };

    if (publicKey) {
      fetchBalanceOnly();
    }
  }, [publicKey, connection]);

  const fetchBalance = async () => {
    if (!publicKey) return;
    try {
      const tokenMint = new PublicKey(TOKEN_MINT);
      const tokenAccount = getAssociatedTokenAddressSync(
        tokenMint,
        publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      const account = await getAccount(connection, tokenAccount, 'confirmed', TOKEN_2022_PROGRAM_ID);
      const decimals = parseInt(process.env.NEXT_PUBLIC_TOKEN_DECIMALS || '6');
      const balance = Number(account.amount) / 10 ** decimals;
      setWalletBalance(balance.toLocaleString());
      setAmount(balance.toString());
    } catch {
      setWalletBalance('0');
    }
  };

  const handleStake = async () => {
    if (!publicKey || !amount) return;
    setLoading(true);
    setError(null);
    try {
      const decimals = parseInt(process.env.NEXT_PUBLIC_TOKEN_DECIMALS || '6');
      const amountTokens = BigInt(Math.floor(parseFloat(amount) * 10 ** decimals));

      let tokenMint: PublicKey;
      let treasury: PublicKey;

      try {
        tokenMint = new PublicKey(TOKEN_MINT.trim());
      } catch (e) {
        throw new Error(`Invalid TOKEN_MINT: "${TOKEN_MINT}" - ${(e as Error).message}`);
      }

      try {
        treasury = new PublicKey(TREASURY_WALLET.trim());
      } catch (e) {
        throw new Error(`Invalid TREASURY_WALLET: "${TREASURY_WALLET}" - ${(e as Error).message}`);
      }

      const userTokenAccount = getAssociatedTokenAddressSync(tokenMint, publicKey, false, TOKEN_2022_PROGRAM_ID);
      const treasuryTokenAccount = getAssociatedTokenAddressSync(tokenMint, treasury, false, TOKEN_2022_PROGRAM_ID);

      const transaction = new Transaction();

      try {
        await getAccount(connection, treasuryTokenAccount, 'confirmed', TOKEN_2022_PROGRAM_ID);
      } catch {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            treasuryTokenAccount,
            treasury,
            tokenMint,
            TOKEN_2022_PROGRAM_ID
          )
        );
      }

      transaction.add(
        createTransferInstruction(
          userTokenAccount,
          treasuryTokenAccount,
          publicKey,
          amountTokens,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );

      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');

      const result = await api.stake(publicKey.toBase58(), amountTokens.toString(), signature);
      if (result.success) {
        setAmount('');
        onAction();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleUnstake = async () => {
    if (!publicKey || !signMessage) return;
    setLoading(true);
    setError(null);
    try {
      const message = `greed-farm:unstake:${publicKey.toBase58()}:${Date.now()}`;
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(messageBytes);
      const signature = bs58.encode(signatureBytes);

      const result = await api.unstake({
        wallet: publicKey.toBase58(),
        message,
        signature,
      });
      if (result.success) {
        onAction();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const formatStaked = () => {
    const decimals = parseInt(process.env.NEXT_PUBLIC_TOKEN_DECIMALS || '6');
    const value = Number(stakedAmount) / 10 ** decimals;
    return value.toLocaleString();
  };

  if (!publicKey) {
    return (
      <div className="card-greed p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-16 h-16 rounded-xl bg-israel-blue/10 border border-israel-blue/30 flex items-center justify-center overflow-hidden">
            <img src="/voxeljew.png" alt="" className="w-14 h-14 pixelated" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Stake</h3>
            <p className="text-xs text-[#556688]">Lock tokens for rewards</p>
          </div>
        </div>
        <div className="text-center py-8 rounded-xl bg-greed-bg border border-greed-border">
          <p className="text-[#556688]">Connect wallet to stake</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card-greed p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-16 h-16 rounded-xl bg-israel-blue/10 border border-israel-blue/30 flex items-center justify-center overflow-hidden">
          <img src="/voxeljew.png" alt="" className="w-14 h-14 pixelated" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">{isStaked ? 'Your Stake' : 'Stake'}</h3>
          <p className="text-xs text-[#556688]">{isStaked ? 'Currently locked' : 'Lock tokens for rewards'}</p>
        </div>
      </div>

      {isStaked ? (
        <div className="space-y-4">
          <div className="rounded-xl bg-greed-bg border border-greed-border p-4">
            <p className="text-xs uppercase tracking-wider text-[#556688] mb-1">Staked Amount</p>
            <p className="text-3xl font-bold text-israel-blue-light font-mono">{formatStaked()}</p>
            <p className="text-xs text-[#445566]">tokens</p>
          </div>

          <div className="rounded-xl bg-greed-bg border border-greed-border p-4">
            <p className="text-xs uppercase tracking-wider text-[#556688] mb-1">Wallet Balance</p>
            <p className="text-2xl font-bold text-white font-mono">{walletBalance || '0'}</p>
            <p className="text-xs text-[#445566]">tokens available</p>
          </div>

          {warmupRemaining > 0 ? (
            <div className="rounded-xl bg-greed-gold/5 border border-greed-gold/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-greed-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-greed-gold font-semibold">Warmup Active</p>
              </div>
              <p className="text-2xl font-mono text-greed-gold text-glow-gold">
                {warmupCountdown.formatted}
              </p>
              <p className="text-xs text-[#556688] mt-2">
                {Math.floor(warmupDuration / 60)}min warmup required
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-greed-green/5 border border-greed-green/20 p-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-greed-green" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <p className="text-sm text-greed-green font-semibold">Eligible for rewards</p>
              </div>
            </div>
          )}

          {showAddMore ? (
            <div className="space-y-3 pt-4 border-t border-greed-border">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs uppercase tracking-wider text-[#556688]">Add Amount</label>
                  <button
                    onClick={fetchBalance}
                    className="text-xs text-israel-blue-light hover:text-israel-blue font-semibold"
                  >
                    MAX
                  </button>
                </div>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-3 input-greed text-lg font-mono"
                />
                {walletBalance && (
                  <p className="text-xs text-[#556688] mt-2">Balance: {walletBalance}</p>
                )}
              </div>
              <p className="text-xs text-greed-gold">Note: Adding tokens resets warmup</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowAddMore(false)}
                  className="flex-1 py-3 px-4 rounded-xl btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStake}
                  disabled={loading || !amount || parseFloat(amount) <= 0}
                  className="flex-1 py-3 px-4 rounded-xl btn-primary disabled:opacity-50"
                >
                  {loading ? 'Processing...' : 'Add'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setShowAddMore(true); fetchBalance(); }}
              className="w-full py-3 px-4 rounded-xl btn-secondary"
            >
              Add More Tokens
            </button>
          )}

          <button
            onClick={handleUnstake}
            disabled={loading}
            className="w-full py-3 px-4 rounded-xl btn-danger disabled:opacity-50"
          >
            {loading ? 'Processing...' : 'Unstake All'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-greed-bg border border-greed-border p-4">
            <p className="text-xs uppercase tracking-wider text-[#556688] mb-1">Wallet Balance</p>
            <p className="text-2xl font-bold text-white font-mono">{walletBalance || '0'}</p>
            <p className="text-xs text-[#445566]">tokens available</p>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs uppercase tracking-wider text-[#556688]">Amount to Stake</label>
              <button
                onClick={fetchBalance}
                className="text-xs text-israel-blue-light hover:text-israel-blue font-semibold"
              >
                MAX
              </button>
            </div>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-4 py-3 input-greed text-lg font-mono"
            />
          </div>

          <div className="rounded-xl bg-greed-bg border border-greed-border p-4 space-y-2">
            <p className="text-xs text-[#8899bb] flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-israel-blue" />
              {Math.floor(warmupDuration / 60)} minute warmup period
            </p>
            <p className="text-xs text-[#8899bb] flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-israel-blue" />
              26% quorum required for distribution
            </p>
          </div>

          <button
            onClick={handleStake}
            disabled={loading || !amount || parseFloat(amount) <= 0}
            className="w-full py-3 px-4 rounded-xl btn-primary disabled:opacity-50"
          >
            {loading ? 'Processing...' : 'Stake Tokens'}
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 rounded-xl bg-greed-red/10 border border-greed-red/20">
          <p className="text-sm text-greed-red">{error}</p>
        </div>
      )}
    </div>
  );
};
