/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{js,jsx,ts,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        surface: {
          900: '#0a0a0f',
          800: '#13131a',
          700: '#1c1c28',
          600: '#252535',
          500: '#2e2e42',
        },
        accent: {
          blue:   '#3b82f6',
          red:    '#ef4444',
          green:  '#10b981',
          yellow: '#f59e0b',
          purple: '#8b5cf6',
        }
      }
    }
  },
  plugins: []
}
