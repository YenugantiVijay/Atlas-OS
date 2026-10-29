/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        atlas: {
          50: '#F7F5FF',  // Canvas / ultra-light tint
          100: '#EDE9FE', // Light lavender
          200: '#DDD6FE', // Lavender soft border/tag
          300: '#C4B5FD', // Interactive hover border
          400: '#A78BFA', // Muted violet icon/accent
          500: '#8B5CF6', // Primary violet
          600: '#7C3AED', // Interactive primary hover
          700: '#6D28D9', // Deep violet / primary button default / heading accent
          800: '#5B21B6', // Dark violet pressed / high contrast
          900: '#4C1D95', // Deepest violet text
          950: '#2E1065', // Midnight violet
        },
        surface: {
          canvas: '#F7F5FF',
          card: '#FFFFFF',
          panel: '#F3EFFC',
          muted: '#E8E3F0',
        },
        content: {
          primary: '#211B35',   // Accessible main text
          secondary: '#746D85', // Secondary text
          muted: '#938BA3',     // Muted captions
          inverse: '#FFFFFF',
        },
        border: {
          DEFAULT: '#E8E3F0',
          strong: '#D1C9DE',
          subtle: '#F3EFFC',
        },
        status: {
          success: '#10B981',
          'success-bg': '#ECFDF5',
          'success-text': '#065F46',
          warning: '#F59E0B',
          'warning-bg': '#FFFBEB',
          'warning-text': '#92400E',
          danger: '#EF4444',
          'danger-bg': '#FEF2F2',
          'danger-text': '#991B1B',
          info: '#3B82F6',
          'info-bg': '#EFF6FF',
          'info-text': '#1E40AF',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        heading: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgb(33 27 53 / 0.05), 0 1px 2px -1px rgb(33 27 53 / 0.05)',
        'card-hover': '0 4px 6px -1px rgb(33 27 53 / 0.07), 0 2px 4px -2px rgb(33 27 53 / 0.05)',
        'modal': '0 20px 25px -5px rgb(33 27 53 / 0.12), 0 8px 10px -6px rgb(33 27 53 / 0.1)',
        'dropdown': '0 10px 15px -3px rgb(33 27 53 / 0.08), 0 4px 6px -4px rgb(33 27 53 / 0.04)',
        'focus-ring': '0 0 0 3px rgba(139, 92, 246, 0.25)',
      },
    },
  },
  plugins: [],
}
