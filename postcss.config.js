export default {
  plugins: {
    '@tailwindcss/postcss': {},  // Plugin mới cho Tailwind v4
    // Không cần 'postcss-import' hoặc 'autoprefixer' nữa (v4 tự handle)
  },
};