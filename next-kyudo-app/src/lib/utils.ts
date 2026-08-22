import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * クラス名を安全に結合し、Tailwind CSSのクラス競合を自動解決するユーティリティ関数
 * フールプルーフ: 不正な型や重複クラスの混入を防止する
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
