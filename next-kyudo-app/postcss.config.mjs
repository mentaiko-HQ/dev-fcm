/**
 * 【PostCSS 設定ファイル (Tailwind v3系)】
 * 役割:
 * - Tailwind CSS (v3) と Autoprefixer を Next.js のビルドに統合する。
 *
 * フールプルーフ設計:
 * - 既存の tailwind.config.ts を完全に認識させるため、v3系の標準プラグイン指定を採用。
 */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
