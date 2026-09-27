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
        background:   '#050C19',
        surface:      '#0A142A',
        surfaceHover: '#0E1D3A',
        surfaceMid:   '#071120',

        primary:    '#22D3EE',
        primaryMuted:'rgba(34,211,238,0.1)',
        secondary:  '#818CF8',
        accent:     '#10B981',
        danger:     '#F43F5E',
        warning:    '#F59E0B',
        quantum:    '#FB923C',

        border:     'rgba(255,255,255,0.07)',
        borderMid:  'rgba(255,255,255,0.1)',
        borderHigh: 'rgba(34,211,238,0.25)',

        glow:       'rgba(34,211,238,0.35)',
      },
      fontFamily: {
        sans:    ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        'glass':      '0 4px 24px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.06) inset',
        'glass-lg':   '0 8px 40px rgba(0,0,0,0.5),  0 1px 0 rgba(255,255,255,0.07) inset',
        'glow-sm':    '0 0 12px rgba(34,211,238,0.25)',
        'glow-md':    '0 0 24px rgba(34,211,238,0.35)',
        'glow-lg':    '0 0 40px rgba(34,211,238,0.25)',
        'nav-active': '0 0 12px rgba(34,211,238,0.06), 0 1px 0 rgba(34,211,238,0.1) inset',
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'pulse-slow':     'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float':          'float 6s ease-in-out infinite',
        'float-delayed':  'float 6s ease-in-out 2s infinite',
        'shimmer':        'shimmer 2.5s linear infinite',
        'fade-in':        'fadeIn 0.35s cubic-bezier(0,0,0.2,1)',
        'slide-up':       'slideUp 0.5s cubic-bezier(0.16,1,0.3,1)',
        'page-in':        'pageIn 0.4s cubic-bezier(0.16,1,0.3,1)',
        'glow-pulse':     'glowPulse 3s ease-in-out infinite',
        'scan-line':      'scanLine 3s linear infinite',
        'border-glow':    'borderGlow 2s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        pageIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        glowPulse: {
          '0%, 100%': { opacity: '0.5' },
          '50%':      { opacity: '1' },
        },
        scanLine: {
          '0%':   { transform: 'translateY(-10%)', opacity: '0' },
          '10%':  { opacity: '0.6' },
          '90%':  { opacity: '0.6' },
          '100%': { transform: 'translateY(110%)', opacity: '0' },
        },
        borderGlow: {
          '0%, 100%': { boxShadow: '0 0 8px rgba(34,211,238,0.1)' },
          '50%':      { boxShadow: '0 0 20px rgba(34,211,238,0.35)' },
        },
      },
    },
  },
  plugins: [],
}
