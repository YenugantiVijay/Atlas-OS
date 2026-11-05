/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F5F3FF',
          100: '#EDE9FE',
          200: '#DDD6FE',
          300: '#C4B5FD',
          400: '#A78BFA',
          500: '#8B5CF6', // Primary Violet
          600: '#7C3AED',
          700: '#6D28D9', // Deep Violet
          800: '#5B21B6',
          900: '#4C1D95',
          950: '#2E1065',
        },
        surface: {
          primary: '#FFFFFF',
          secondary: '#F8FAFC',
          tertiary: '#F1F5F9',
          card: '#FFFFFF',
          dark: '#0B0F19',
          'dark-card': '#111827',
          'dark-hover': '#1F2937',
        },
        content: {
          primary: '#111827',
          secondary: '#64748B',
          muted: '#94A3B8',
          inverted: '#F8FAFC',
        },
        border: {
          DEFAULT: '#E2E8F0',
          subtle: '#F1F5F9',
          dark: '#1F2937',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        display: [
          'Manrope',
          'Inter',
          '-apple-system',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      boxShadow: {
        glow: '0 0 50px -12px rgba(139, 92, 246, 0.25)',
        'glow-lg': '0 0 70px -15px rgba(109, 40, 217, 0.35)',
        card: '0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)',
        'card-hover': '0 10px 25px -5px rgba(109, 40, 217, 0.08), 0 8px 10px -6px rgba(109, 40, 217, 0.04)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out forwards',
        'fade-up': 'fadeUp 0.6s ease-out forwards',
        'pulse-subtle': 'pulseSubtle 4s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.85' },
        },
      },
    },
  },
  plugins: [],
};
