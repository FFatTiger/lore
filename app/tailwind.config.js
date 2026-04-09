const typography = require('@tailwindcss/typography');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}', './lib/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          system: 'var(--bg-system)',
          elevated: 'var(--bg-elevated)',
          raised: 'var(--bg-raised)',
          surface: 'var(--bg-surface)',
          inset: 'var(--bg-inset)',
        },
        fill: {
          primary: 'var(--fill-primary)',
          secondary: 'var(--fill-secondary)',
          tertiary: 'var(--fill-tertiary)',
          quaternary: 'var(--fill-quaternary)',
        },
        separator: {
          DEFAULT: 'var(--separator)',
          thin: 'var(--separator-thin)',
          hairline: 'var(--separator-hairline)',
        },
        txt: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
          quaternary: 'var(--text-quaternary)',
        },
        sys: {
          blue: 'var(--sys-blue)',
          purple: 'var(--sys-purple)',
          green: 'var(--sys-green)',
          red: 'var(--sys-red)',
          orange: 'var(--sys-orange)',
          yellow: 'var(--sys-yellow)',
          teal: 'var(--sys-teal)',
          indigo: 'var(--sys-indigo)',
          pink: 'var(--sys-pink)',
        },
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        display: 'var(--font-display)',
        mono: 'var(--font-mono)',
      },
      transitionTimingFunction: {
        spring: 'var(--ease-spring)',
        out: 'var(--ease-out)',
        inout: 'var(--ease-inout)',
      },
      boxShadow: {
        card: 'var(--card-shadow)',
        dock: 'var(--dock-shadow)',
      },
    },
  },
  plugins: [typography],
};
