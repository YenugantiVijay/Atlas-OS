/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Core Atlas OS Application Brand Palette
        brand: {
          50: '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          300: '#5EEAD4',
          400: '#2DD4BF',
          500: '#14B8A6',
          600: '#0D9488', // Primary Brand Teal (matches ERP application)
          700: '#0F766E', // Deep Teal / Hover primary
          800: '#115E59', // Dark Teal text
          900: '#134E4A', // Deepest Teal text
          950: '#142B4D', // Deep Navy
        },
        navy: {
          50: '#F0F4F8',
          100: '#D9E2EC',
          200: '#BCCCDC',
          300: '#9FB3C8',
          400: '#627D98',
          500: '#334E68',
          600: '#243B53',
          700: '#142B4D', // Primary Deep Navy
          800: '#0F1E36', // Dark Navy surface
          900: '#0A1526', // Midnight Navy
          950: '#060D18',
        },
        // Unique & Colorful Supporting Section Palette
        sky: {
          50: '#F0F9FF',
          100: '#E0F2FE', // Reference Sky Blue
          200: '#BAE6FD',
          300: '#7DD3FC',
          600: '#0284C7',
          700: '#0369A1',
        },
        mint: {
          50: '#F0FDF4',
          100: '#D1FAE5', // Reference Soft Mint
          200: '#A7F3D0',
          300: '#6EE7B7',
          600: '#059669',
          700: '#047857',
        },
        cream: {
          50: '#FFFDF7',
          100: '#FFF7ED', // Reference Warm Cream
          200: '#FFEDD5',
          300: '#FED7AA',
          600: '#D97706',
          700: '#B45309',
        },
        lavender: {
          50: '#FAF5FF',
          100: '#F3E8FF', // Reference Light Lavender
          200: '#E9D5FF',
          300: '#D8B4FE',
          600: '#9333EA',
          700: '#7E22CE',
        },
        peach: {
          50: '#FFF8F1',
          100: '#FFEDD5', // Reference Soft Peach
          200: '#FED7AA',
          300: '#FDBA74',
          600: '#EA580C',
          700: '#C2410C',
        },
        coral: {
          50: '#FEF2F2',
          100: '#FEE2E2', // Reference Gentle Coral
          200: '#FECACA',
          300: '#FCA5A5',
          600: '#DC2626',
          700: '#B91C1C',
        },
        surface: {
          primary: '#FFFFFF',
          secondary: '#F8FAFC',
          tertiary: '#F1F5F9',
          canvas: '#F5F7FA',
          card: '#FFFFFF',
          dark: '#142B4D',
          'dark-card': '#0F1E36',
          'dark-hover': '#243B53',
        },
        content: {
          primary: '#172B4D',
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
        heading: [
          'Poppins',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
        display: [
          'Poppins',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
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
        glow: '0 0 50px -12px rgba(13, 148, 136, 0.18)',
        'glow-lg': '0 0 70px -15px rgba(20, 43, 77, 0.24)',
        card: '0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)',
        'card-hover': '0 10px 25px -5px rgba(13, 148, 136, 0.08), 0 8px 10px -6px rgba(13, 148, 136, 0.04)',
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
