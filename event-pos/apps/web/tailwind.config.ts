import type { Config } from "tailwindcss"

const config = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        "success": "#1B873F",
        "error": "#D32F2F",
        
        "primary": "#FF6B00",
        "primary-container": "#FFDBC9",
        "on-primary": "#FFFFFF",
        "on-primary-container": "#4A1C00",
        
        "secondary": "#131313",
        "secondary-container": "#D1D1D1",
        "on-secondary": "#FFFFFF",
        "on-secondary-container": "#000000",
        
        "tertiary": "#049EFF",
        "tertiary-container": "#CDE6FF",
        "on-tertiary": "#FFFFFF",
        "on-tertiary-container": "#002F54",
        
        "neutral": "#88736A",
        
        "background": "#FFF5F0",
        "on-background": "#261812",
        
        "surface": "#FFF5F0",
        "surface-container-lowest": "#FFFFFF",
        "surface-container-low": "#FFF1EB",
        "surface-container": "#FFEAE1",
        "surface-container-high": "#FEE3D8",
        "surface-container-highest": "#F8DDD2",
        "surface-variant": "#F8DDD2",
        "on-surface": "#261812",
        "on-surface-variant": "#5A4136",
        "outline": "#88736A",
        "outline-variant": "#E2BFB0",
      },
      spacing: {
        "gutter": "16px",
        "touch-target": "48px",
        "touch-target-min": "56px",
        "section-padding": "32px",
        "margin-page": "24px",
        "card-gap": "12px",
        "baseline": "4px"
      },
      fontFamily: {
        "headline-lg": ["Inter", "sans-serif"],
        "headline-md": ["Inter", "sans-serif"],
        "display-lg": ["Inter", "sans-serif"],
        "price-display": ["Inter", "sans-serif"],
        "body-lg": ["Inter", "sans-serif"],
        "body-md": ["Inter", "sans-serif"],
        "label-lg": ["Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config

export default config
