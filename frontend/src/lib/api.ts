const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://greed-farm.onrender.com';

export interface GameStatus {
  currentEpoch: number;
  treasury: {
    balance: string;
    sol: string;
  };
  sharedPool: {
    lamports: string;
    sol: string;
    pending: string;
    pendingLamports: string;
  };
  greedPot: {
    lamports: string;
    sol: string;
    pending: string;
    pendingLamports: string;
  };
  totalStaked: {
    tokens: string;
    formatted: string;
  };
  harvest: {
    currentEligible: string;
    requiredForQuorum: string;
    percentage: number;
    quorumReached?: boolean;
    quorumReachedAt?: string | null;
  };
  countdown: {
    active: boolean;
    complete: boolean;
    remainingMs: number | null;
    remainingSeconds: number | null;
    startedAt: string | null;
  };
  nextEpoch: {
    inMs: number | null;
    inSeconds: number | null;
    waitingForQuorum?: boolean;
  };
  config: {
    epochDuration: number;
    warmupDuration: number;
    quorumPercentage: number;
    totalSupply: string;
  };
}

export interface UserInfo {
  wallet: string;
  stake: {
    amount: string;
    stakedAt: string | null;
    isEligible: boolean;
    warmupRemaining: number;
    eligibleAt: string | null;
  };
  claimable: {
    lamports: string;
    sol: string;
  };
  stats: {
    totalClaimed: string;
    totalWon: string;
    totalLost: string;
  };
}

export interface StakeResult {
  success: boolean;
  message: string;
  txId?: string;
  stake?: {
    amount: string;
    stakedAt: string;
    warmupEndsAt: string;
  };
}

export interface UnstakeResult {
  success: boolean;
  message: string;
  txId?: string;
  amount?: string;
}

export interface ClaimResult {
  success: boolean;
  message: string;
  amount?: string;
  signature?: string;
  error?: string;
  partialClaim?: boolean;
  remainingClaimable?: string;
}

export interface GreedResult {
  success: boolean;
  message: string;
  won?: boolean;
  riskAmount?: string;
  payoutAmount?: string;
  newClaimable?: string;
  newGreedPot?: string;
  greedId?: number;
  serverSeed?: string;
}

export interface CommitmentResult {
  success: boolean;
  message: string;
  commitmentId?: string;
  serverSeedHash?: string;
  expiresAt?: number;
}

export interface VerifyResult {
  success: boolean;
  message: string;
  serverSeed?: string;
  serverSeedHash?: string;
  clientSeed?: string;
  combinedHash?: string;
  won?: boolean;
  instructions?: string;
}

// Helper type for signed requests
export interface SignedRequest {
  wallet: string;
  message: string;
  signature: string;
}

export interface LeaderboardEntry {
  rank: number;
  wallet: string;
  netWinnings: string;
  netWinningsSol: string;
  totalWon: string;
  totalWonSol: string;
  totalLost: string;
  totalLostSol: string;
}

export interface LeaderboardResult {
  leaderboard: LeaderboardEntry[];
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async fetch<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'API request failed');
    }

    return data as T;
  }

  async getStatus(): Promise<GameStatus> {
    return this.fetch<GameStatus>('/api/status');
  }

  async getUserInfo(wallet: string): Promise<UserInfo> {
    return this.fetch<UserInfo>(`/api/user/${wallet}`);
  }

  async stake(
    wallet: string,
    amount: string,
    signature: string
  ): Promise<StakeResult> {
    return this.fetch<StakeResult>('/api/stake', {
      method: 'POST',
      body: JSON.stringify({ wallet, amount, signature }),
    });
  }

  // Protected endpoints require wallet signature
  async unstake(signedRequest: SignedRequest): Promise<UnstakeResult> {
    return this.fetch<UnstakeResult>('/api/unstake', {
      method: 'POST',
      body: JSON.stringify(signedRequest),
    });
  }

  async claim(signedRequest: SignedRequest): Promise<ClaimResult> {
    return this.fetch<ClaimResult>('/api/claim', {
      method: 'POST',
      body: JSON.stringify(signedRequest),
    });
  }

  async greedCommit(signedRequest: SignedRequest): Promise<CommitmentResult> {
    return this.fetch<CommitmentResult>('/api/greed/commit', {
      method: 'POST',
      body: JSON.stringify(signedRequest),
    });
  }

  async greed(signedRequest: SignedRequest & {
    riskPercentage: number;
    commitmentId: string;
    clientSeed: string;
  }): Promise<GreedResult> {
    return this.fetch<GreedResult>('/api/greed', {
      method: 'POST',
      body: JSON.stringify(signedRequest),
    });
  }

  async greedVerify(greedId: number): Promise<VerifyResult> {
    return this.fetch<VerifyResult>(`/api/greed/verify/${greedId}`);
  }

  async getGreedLeaderboard(limit: number = 10): Promise<LeaderboardResult> {
    return this.fetch<LeaderboardResult>(`/api/leaderboard/greed?limit=${limit}`);
  }

  // Helper to create a signed message
  static createSignMessage(action: string, wallet: string): string {
    return `greed-farm:${action}:${wallet}:${Date.now()}`;
  }
}

export const api = new ApiClient(API_URL);
