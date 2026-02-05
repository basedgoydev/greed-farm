'use client';

import { FC } from 'react';
import Image from 'next/image';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
}

export const Logo: FC<LogoProps> = ({ size = 'md', showTagline = false }) => {
  const sizes = {
    sm: { icon: 40, text: 'text-xl' },
    md: { icon: 52, text: 'text-2xl' },
    lg: { icon: 72, text: 'text-4xl' },
  };

  const { icon, text } = sizes[size];

  return (
    <div className="flex items-center gap-3">
      {/* Logo Icon */}
      <div className="relative voxel-icon" style={{ width: icon, height: icon }}>
        <Image
          src="/logo.jpg"
          alt="GreedFi"
          width={icon}
          height={icon}
          className="pixelated drop-shadow-voxel rounded-lg"
        />
      </div>

      {/* Text */}
      <div className="flex flex-col">
        <span className={`logo-text ${text} leading-none`}>
          GreedFi
        </span>
        {showTagline && (
          <span className="text-xs text-[#556688] tracking-wider uppercase mt-1">
            Stake. Earn. Risk.
          </span>
        )}
      </div>
    </div>
  );
};

// Icon-only version for favicons, etc.
export const LogoIcon: FC<{ size?: number }> = ({ size = 40 }) => (
  <Image
    src="/logo.jpg"
    alt="GreedFi"
    width={size}
    height={size}
    className="pixelated drop-shadow-voxel rounded-lg"
  />
);
