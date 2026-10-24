/**
 * Tailwind CSS v3 準拠の PostCSS 構成設定
 *
 * フールプルーフ設計:
 * - Next.js 15 において Tailwind v4 用プラグイン (@tailwindcss/postcss) 参照による解決失敗を防止。
 * - tailwindcss および autoprefixer の標準プラグイン構成に固定。
 */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
