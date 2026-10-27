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
          50: '#F7F5FF',
          100: '#EDE9FE',
          200: '#DDD6FE',
          300: '#C4B5FD',
          400: '#A78BFA',
          500: '#8B5CF6', // Primary violet
          600: '#7C3AED',
          700: '#6D28D9', // Deep violet
          800: '#5B21B6',
          900: '#4C1D95',
          950: '#2E1065',
        },
        surface: {
          canvas: '#F7F5FF',
          card: '#FFFFFF',
          panel: '#FAF9FE',
          muted: '#F1EEF8',
        },
        content: {
          primary: '#211B35',
          secondary: '#746D85',
          muted: '#9E97AE',
          inverse: '#FFFFFF',
        },
        border: {
          DEFAULT: '#E8E3F0',
          strong: '#D5CDE2',
          subtle: '#F2EFF7',
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
      },
      boxShadow: {
        'card': '0 1px 3px rgba(33, 27, 53, 0.04), 0 4px 12px rgba(109, 40, 217, 0.03)',
        'card-hover': '0 4px 12px rgba(33, 27, 53, 0.08), 0 12px 24px rgba(109, 40, 217, 0.06)',
        'modal': '0 20px 40px -15px rgba(33, 27, 53, 0.15)',
        'dropdown': '0 10px 25px -5px rgba(33, 27, 53, 0.1), 0 8px 10px -6px rgba(33, 27, 53, 0.06)',
        'focus-ring': '0 0 0 3px rgba(139, 92, 246, 0.25)',
      },
    },
  },
  plugins: [],
}
