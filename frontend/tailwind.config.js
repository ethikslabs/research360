/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas:   'var(--bg)',
        deep:     'var(--bg-deep)',
        surface:  'var(--surface)',
        elevated: 'var(--elevated)',
        line:     'var(--border)',
        ink:      'var(--text)',
        fade:     'var(--muted)',
        // Override indigo → sage green throughout without touching component files
        indigo: {
          300: '#a3c4b0',
          400: '#7faa94',
          500: '#5c8a72',
          600: '#4a7560',
        },
      },
      fontFamily: {
        sans: ['JetBrains Mono', 'monospace'],
        display: ['Syne', 'sans-serif'],
        serif: ['Lora', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
