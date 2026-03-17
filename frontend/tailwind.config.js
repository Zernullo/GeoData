/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Cyber theme colors
        'dark-bg': '#07080f',
        'dark-surface': '#0d0f1a',
        'dark-surface2': '#12152b',
        'dark-green': '#00ffa3',
        'dark-red': '#ff4d6d',
        'dark-amber': '#f5a623',
        'neon-green': '#00ffa3',
        'neon-green-dim': 'rgba(0, 255, 163, 0.12)',
        'neon-green-glow': 'rgba(0, 255, 163, 0.06)',
        'neon-red': '#ff4d6d',
        'neon-amber': '#f5a623',
        'dark-text': '#e8eaf2',
        'dark-muted': 'rgba(232, 234, 242, 0.4)',
        'dark-border': 'rgba(255, 255, 255, 0.06)',
        'dark-border-accent': 'rgba(0, 255, 163, 0.25)',
      },
      fontFamily: {
        mono: ["'Space Mono'", 'monospace'],
        display: ["'Syne'", 'sans-serif'],
      },
      borderColor: ({ theme }) => ({
        DEFAULT: theme('colors.dark-border'),
      }),
      backgroundColor: ({ theme }) => ({
        DEFAULT: theme('colors.dark-bg'),
      }),
      textColor: ({ theme }) => ({
        DEFAULT: theme('colors.dark-text'),
      }),
      animation: {
        'fade-up': 'fadeUp 0.5s ease forwards',
        'fade-up-delay-1': 'fadeUp 0.5s 0.1s ease both',
        'fade-up-delay-2': 'fadeUp 0.5s 0.2s ease both',
        'blink': 'blink 1s step-end infinite',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}
