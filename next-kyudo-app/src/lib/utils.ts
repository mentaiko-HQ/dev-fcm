import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn/ui クラス名マージユーティリティ
 * フールプルーフ: 不正な型や重複したTailwindクラスを安全に統合
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}