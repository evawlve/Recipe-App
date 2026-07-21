/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'var(--font-nunito)',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      colors: {
        background: 'hsl(var(--bg))',
        foreground: 'hsl(var(--text))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--text))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--text))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          depth: 'hsl(var(--primary-depth))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--text))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        'border-dark': 'hsl(var(--border-dark))',
        surface: 'hsl(var(--surface))',
        track: 'hsl(var(--track))',
        ring: 'hsl(var(--ring))',
        // Mobile-app macro colors (P/C/F + calories)
        macro: {
          protein: 'hsl(var(--macro-protein))',
          carbs: 'hsl(var(--macro-carbs))',
          fat: 'hsl(var(--macro-fat))',
          calories: 'hsl(var(--macro-calories))',
        },
        // Soft section tints (foodLogLight / profileLight / recipesLight)
        tint: {
          green: 'hsl(var(--tint-green))',
          blue: 'hsl(var(--tint-blue))',
          orange: 'hsl(var(--tint-orange))',
        },
        // FitFood dark mode specific colors
        'search-bg': 'hsl(var(--search-bg))',
        'search-text': 'hsl(var(--search-text))',
        'search-placeholder': 'hsl(var(--search-placeholder))',
        'light-gray': 'hsl(var(--light-gray))',
      },
      borderRadius: {
        xl: 'var(--radius-xl)',
        lg: 'var(--radius-lg)',
        md: 'var(--radius-md)',
        sm: 'var(--radius-sm)',
      },
      boxShadow: {
        'custom': '0 0 0 1px hsl(var(--shadow))',
      },
    },
  },
  plugins: [],
}
