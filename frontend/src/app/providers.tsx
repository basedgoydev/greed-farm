'use client';

import { FC, ReactNode } from 'react';
import { WalletProvider } from '@/providers/WalletProvider';

interface ProvidersProps {
  children: ReactNode;
}

export const Providers: FC<ProvidersProps> = ({ children }) => {
  return <WalletProvider>{children}</WalletProvider>;
};
