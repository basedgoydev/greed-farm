'use client';

import { FC } from 'react';

interface ProgressBarProps {
  percentage: number;
  label?: string;
  showPercentage?: boolean;
  color?: 'green' | 'gold' | 'red';
  height?: 'sm' | 'md' | 'lg';
  animated?: boolean;
}

export const ProgressBar: FC<ProgressBarProps> = ({
  percentage,
  label,
  showPercentage = true,
  color = 'green',
  height = 'md',
  animated = true,
}) => {
  const colorClasses = {
    green: 'bg-greed-500',
    gold: 'bg-gold-500',
    red: 'bg-red-500',
  };

  const heightClasses = {
    sm: 'h-2',
    md: 'h-4',
    lg: 'h-6',
  };

  const clampedPercentage = Math.min(100, Math.max(0, percentage));

  return (
    <div className="w-full">
      {(label || showPercentage) && (
        <div className="flex justify-between items-center mb-2">
          {label && <span className="text-sm text-farm-muted">{label}</span>}
          {showPercentage && (
            <span className="text-sm font-medium text-farm-text">
              {clampedPercentage.toFixed(1)}%
            </span>
          )}
        </div>
      )}
      <div
        className={`
          w-full ${heightClasses[height]} bg-farm-border rounded-full overflow-hidden
        `}
      >
        <div
          className={`
            ${heightClasses[height]} ${colorClasses[color]} rounded-full
            ${animated ? 'transition-all duration-500 ease-out' : ''}
          `}
          style={{ width: `${clampedPercentage}%` }}
        />
      </div>
    </div>
  );
};
