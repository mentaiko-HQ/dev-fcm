import type { Config } from 'tailwindcss';

/**
 * Tailwind CSS 設定ファイル
 *
 * フールプルーフ設計（操作ミス・型エラーの入口遮断）:
 * - darkMode プロパティに正規の文字列リテラル "class" を指定し、TS2322（タプル要素数不一致エラー）を防止。
 * - globals.css で定義された CSS 変数（HSL形式）を Tailwind の各セマンティックカラーへ安全にマッピング。
 * - タッチデバイス（タブレット・スマホ）における誤タップ・押しづらさを防止するため、
 *   minHeight.touch / minWidth.touch に 44px の安全領域を確保。
 *
 * フェイルセーフ設計（外部依存障害の排除）:
 * - 未インストール状態の外部プラグイン（tailwindcss-animate）への依存を完全に排除。
 * - shadcn/ui で要求されるアコーディオン開閉アニメーションおよび弓道的中演出アニメーションを
 *   自前の keyframes / animation 定義として内包し、追加パッケージなしで完全動作を保証。
 */
const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // 弓道大会システム専用ドメインカラー
        kyudo: {
          hit: '#16a34a', // 〇 (的中: グリーン)
          miss: '#dc2626', // ✕ (外れ: レッド)
          gold: '#d97706', // 優勝決定・射詰用アクセント
          navy: '#0f172a', // 本部・管理画面基調色
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        // shadcn/ui アコーディオン・ドロップダウン用キーフレーム
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height, 500px)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height, 500px)' },
          to: { height: '0' },
        },
        // 的中入力時・通知ポップアップ用フィードバック
        'hit-pop': {
          '0%': { transform: 'scale(0.8)', opacity: '0' },
          '50%': { transform: 'scale(1.15)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'hit-pop':
          'hit-pop 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
      },
      minHeight: {
        touch: '44px',
      },
      minWidth: {
        touch: '44px',
      },
    },
  },
  plugins: [],
};

export default config;
