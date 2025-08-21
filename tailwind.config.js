/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#0B5FFF',
          secondary: '#101828',
          accent: '#22C55E',
        }
      }
    },
  },
  plugins: [],
}
