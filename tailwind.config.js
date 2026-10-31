/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Core Brand Navy & Teal Palette (Backward-compatible atlas-* mappings anchored to Enterprise Teal)
        atlas: {
          50: '#F0FDFA',  // Light teal canvas / active nav pill
          100: '#CCFBF1', // Soft teal border / light badge background
          200: '#99F6E4', // Interactive hover border
          300: '#5EEAD4', // Accent borders
          400: '#2DD4BF', // Vibrant teal icon / focus
          500: '#14B8A6', // Interactive teal accent
          600: '#0D9488', // Primary Brand Teal
          700: '#0F766E', // Deep Teal / Hover primary
          800: '#115E59', // Dark Teal text
          900: '#134E4A', // Deepest Teal text
          950: '#142B4D', // Deep Navy
        },
        // Deep Enterprise Navy Palette
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
        // Primary Blue Palette
        blue: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB', // Primary Blue
          700: '#1D4ED8',
          800: '#1E40AF',
          900: '#1E3A8A',
        },
        // Dedicated Teal Palette
        teal: {
          50: '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          300: '#5EEAD4',
          400: '#2DD4BF',
          500: '#14B8A6',
          600: '#0D9488',
          700: '#0F766E',
          800: '#115E59',
          900: '#134E4A',
          950: '#042F2E',
        },
        surface: {
          canvas: '#F5F7FA', // Main application background
          card: '#FFFFFF',   // Pure white card surfaces
          panel: '#F8FAFC',  // Subtle table header / secondary panel
          muted: '#F1F5F9',  // Disabled / inactive surfaces
        },
        content: {
          primary: '#172B4D',   // Accessible main text (High-contrast Navy-Slate)
          secondary: '#64748B', // Secondary metadata text
          muted: '#94A3B8',     // Muted placeholders and icons
          inverse: '#FFFFFF',   // Contrast text on dark navy
        },
        border: {
          DEFAULT: '#E2E8F0', // Enterprise light border
          strong: '#CBD5E1',  // Emphasized divider
          subtle: '#F1F5F9',  // Inner subtle separator
        },
        status: {
          success: '#16A34A',
          'success-bg': '#DCFCE7',
          'success-text': '#14532D',
          warning: '#D97706',
          'warning-bg': '#FEF3C7',
          'warning-text': '#78350F',
          danger: '#DC2626',
          'danger-bg': '#FEE2E2',
          'danger-text': '#7F1D1D',
          info: '#2563EB',
          'info-bg': '#EFF6FF',
          'info-text': '#1E40AF',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        heading: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
      },
      boxShadow: {
        '2xs': '0 1px 2px 0 rgb(15 23 42 / 0.04)',
        'xs': '0 1px 2px 0 rgb(15 23 42 / 0.05)',
        'card': '0 1px 3px 0 rgb(15 23 42 / 0.05), 0 1px 2px -1px rgb(15 23 42 / 0.05)',
        'card-hover': '0 4px 6px -1px rgb(15 23 42 / 0.07), 0 2px 4px -2px rgb(15 23 42 / 0.05)',
        'modal': '0 20px 25px -5px rgb(15 23 42 / 0.12), 0 8px 10px -6px rgb(15 23 42 / 0.1)',
        'dropdown': '0 10px 15px -3px rgb(15 23 42 / 0.08), 0 4px 6px -4px rgb(15 23 42 / 0.04)',
        'focus-ring': '0 0 0 3px rgba(13, 148, 136, 0.25)',
      },
    },
  },
  plugins: [],
}
