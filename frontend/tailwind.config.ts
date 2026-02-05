import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'israel': {
          blue: '#0038b8',
          'blue-dark': '#002776',
          'blue-light': '#4d7cc7',
          white: '#ffffff',
        },
        'greed': {
          bg: '#070b14',
          card: '#0d1525',
          'card-hover': '#111c30',
          border: '#1a2a4a',
          gold: '#d4af37',
          green: '#28a745',
          red: '#dc3545',
        },
      },
      fontFamily: {
        'pixel': ['var(--font-pixel)', 'Press Start 2P', 'cursive'],
        'pixel-body': ['var(--font-pixel-body)', 'VT323', 'monospace'],
        'display': ['var(--font-pixel)', 'Press Start 2P', 'cursive'],
        'mono': ['var(--font-pixel-body)', 'VT323', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow-blue': 'glow-blue 2s ease-in-out infinite alternate',
        'float': 'float 3s ease-in-out infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        'glow-blue': {
          '0%': { boxShadow: '0 0 5px rgba(0, 56, 184, 0.5)' },
          '100%': { boxShadow: '0 0 30px rgba(0, 56, 184, 0.8)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hero-pattern': 'linear-gradient(135deg, rgba(0, 56, 184, 0.1) 0%, transparent 50%)',
      },
    },
  },
  plugins: [],
};

export default config;
