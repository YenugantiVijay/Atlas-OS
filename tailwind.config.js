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
          50: '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#818CF8',
          500: '#6366F1',
          600: '#4F46E5', // Primary deep indigo accent
          700: '#4338CA',
          800: '#3730A3',
          900: '#312E81',
          950: '#1E1B4B',
        },
        surface: {
          canvas: '#F8FAFC',
          card: '#FFFFFF',
          panel: '#F1F5F9',
          muted: '#E2E8F0',
        },
        content: {
          primary: '#0F172A',
          secondary: '#475569',
          muted: '#64748B',
          inverse: '#FFFFFF',
        },
        border: {
          DEFAULT: '#E2E8F0',
          strong: '#CBD5E1',
          subtle: '#F8FAFC',
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
        'card': '0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05)',
        'card-hover': '0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
        'modal': '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
        'dropdown': '0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04)',
        'focus-ring': '0 0 0 3px rgba(79, 70, 229, 0.2)',
      },
    },
  },
  plugins: [],
}
