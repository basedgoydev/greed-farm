'use client';

import { FC, ReactNode } from 'react';

interface StatCardProps {
  title: string;
  value: string | ReactNode;
  subtitle?: string;
  variant?: 'default' | 'blue' | 'gold' | 'green' | 'red';
  highlight?: boolean;
  icon?: ReactNode;
}

export const StatCard: FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  variant = 'default',
  highlight = false,
  icon,
}) => {
  const variantStyles = {
    default: {
      border: 'border-greed-border',
      bg: 'bg-greed-card',
      text: 'text-white',
      accent: 'bg-white/5',
    },
    blue: {
      border: highlight ? 'border-israel-blue' : 'border-israel-blue/30',
      bg: 'bg-israel-blue/5',
      text: 'text-israel-blue-light',
      accent: 'bg-israel-blue/10',
    },
    gold: {
      border: 'border-greed-gold/30',
      bg: 'bg-greed-gold/5',
      text: 'text-greed-gold',
      accent: 'bg-greed-gold/10',
    },
    green: {
      border: 'border-greed-green/30',
      bg: 'bg-greed-green/5',
      text: 'text-greed-green',
      accent: 'bg-greed-green/10',
    },
    red: {
      border: 'border-greed-red/30',
      bg: 'bg-greed-red/5',
      text: 'text-greed-red',
      accent: 'bg-greed-red/10',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div
      className={`
        relative overflow-hidden rounded-xl p-5
        ${styles.bg} border ${styles.border}
        ${highlight ? 'animate-pulse-blue' : ''}
        transition-all duration-300 hover:scale-[1.02]
      `}
    >
      {/* Background accent */}
      {variant !== 'default' && (
        <div
          className={`absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl ${styles.accent}`}
        />
      )}

      <div className="relative z-10">
        <div className="flex items-start justify-between mb-2">
          <p className="text-xs uppercase tracking-wider text-[#8899bb] font-medium">{title}</p>
          {icon && <div className="text-[#556688]">{icon}</div>}
        </div>

        <p className={`text-2xl font-bold ${styles.text} tracking-tight font-mono`}>
          {value}
        </p>

        {subtitle && (
          <p className="text-xs text-[#556688] mt-1">{subtitle}</p>
        )}
      </div>
    </div>
  );
};
