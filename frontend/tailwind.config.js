/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--color-bg-0)',
        'bg-1': 'var(--color-bg-1)',
        surface: 'var(--color-surface-1)',
        'surface-2': 'var(--color-surface-2)',
        'surface-3': 'var(--color-surface-3)',
        border: 'var(--color-border)',
        'border-soft': 'var(--color-border-soft)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-muted': 'var(--color-text-muted)',
        brand: 'var(--color-brand)',
        'brand-light': 'var(--color-brand-light)',
        'brand-soft': 'var(--color-brand-soft)',
        crypto: 'var(--color-crypto)',
        pqc: 'var(--color-pqc)',
        specialized: 'var(--color-specialized)',
        critical: 'var(--color-critical)',
        high: 'var(--color-high)',
        medium: 'var(--color-medium)',
        success: 'var(--color-success)',
        info: 'var(--color-info)',
        unknown: 'var(--color-unknown)',
      },
      fontFamily: {
        sans: ['var(--font-ui)'],
        mono: ['var(--font-mono)']
      }
    },
  },
  plugins: [],
}
