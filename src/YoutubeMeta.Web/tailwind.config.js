/** Color de un token de tema definido como canales RGB en styles.css (admite opacidad: bg-surface/90). */
const token = name => `rgb(var(--ym-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#ff8a00', dark: '#ff6a00', soft: '#fff1e0' },
        navy: { DEFAULT: '#0f1f36', light: '#0b3a6e' },
        youtube: '#e62117',
        facebook: '#1877f2',
        instagram: '#d62976',
        telegram: '#229ed9',
        tiktok: '#111111',
        linkedin: '#0a66c2',
        teams: '#5b5fc7',
        whatsapp: '#25d366',
        // Tokens de tema: cambian solos entre claro y oscuro (no hace falta repetir dark:).
        canvas: token('canvas'),
        surface: { DEFAULT: token('surface'), hover: token('surface-hover'), muted: token('surface-muted') },
        field: token('field'),
        line: { DEFAULT: token('line'), soft: token('line-soft'), strong: token('line-strong') }
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'sans-serif']
      },
      keyframes: {
        'fade-in-up': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        stripes: { to: { backgroundPosition: '-32px 0' } }
      },
      animation: {
        'fade-in-up': 'fade-in-up .2s ease-out',
        stripes: 'stripes 1s linear infinite'
      }
    }
  },
  plugins: []
};
