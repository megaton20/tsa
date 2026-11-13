/** @type {import('tailwindcss').Config} */
// TSA brand: deep forest green + gold.
//   ink    deep green (dark surfaces, headings)
//   brand  green (buttons, links)
//   sun    gold (accents, highlights on dark green)
//   chalk  warm off-white page background
module.exports = {
  content: ['./views/**/*.ejs', './public/js/**/*.js', './utils/**/*.js', './routes/**/*.js', './services/**/*.js'],
  theme: {
    extend: {
      colors: {
        ink: '#0A3B2A',
        brand: { DEFAULT: '#0F7A4F', dark: '#0A5C3A', soft: '#E4F3EA' },
        sun: { DEFAULT: '#F2C14E', dark: '#D9A62B', soft: '#FFF6DC' },
        chalk: '#F5F8F4',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Figtree', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
