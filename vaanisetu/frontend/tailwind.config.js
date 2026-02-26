/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#FFF8F0',
          100: '#FFECD5',
          200: '#FFD4A3',
          300: '#FFB36B',
          400: '#FF8C35',
          500: '#E65100',
          600: '#CC4700',
          700: '#A83800',
          800: '#8A2C00',
          900: '#6B1F00',
        },
        secondary: {
          50: '#EEF0FF',
          100: '#E0E3FF',
          200: '#C2C8FF',
          300: '#9BA5FF',
          400: '#7480FF',
          500: '#1A237E',
          600: '#151C6B',
          700: '#101558',
          800: '#0B0E45',
          900: '#060832',
        },
        accent: {
          500: '#2E7D32',
          600: '#1B5E20',
        },
        surface: {
          bg: '#FAFAF8',
          card: '#FFFFFF',
          elevated: '#F5F3EE',
          border: '#E8E4DC',
        },
        text: {
          primary: '#1A1208',
          secondary: '#6B5C3E',
          muted: '#9E8E75',
        },
        indigo: {
          100: '#C5CAE9',
          700: '#303F9F',
        },
        amber: {
          100: '#FFECB3',
          800: '#FF8F00',
        },
        green: {
          100: '#C8E6C9',
          700: '#388E3C',
        },
        red: {
          100: '#FFCDD2',
          700: '#D32F2F',
        },
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'primary': '0 2px 8px rgba(230, 81, 0, 0.3)',
        'primary-hover': '0 4px 12px rgba(230, 81, 0, 0.4)',
        'card': '0 1px 3px rgba(26,18,8,0.06), 0 4px 16px rgba(26,18,8,0.04)',
        'card-hover': '0 4px 12px rgba(26,18,8,0.08), 0 8px 24px rgba(26,18,8,0.06)',
      },
      borderRadius: {
        'card': '12px',
      },
    },
  },
  plugins: [],
};
