// 弓道ドメインの厳密な型定義（フールプルーフ: 不正な競技ルールやスコア値の混入をコンパイル段階で防止）

// 射数形式（一手: 2本, 四矢: 4本）
export type ArrowCountFormat = "一手" | "四矢";

// 順位決定戦・競射ルール（射詰: サドンデス、遠近: 的中心からの距離比較）
export type TieBreakerFormat = "射詰" | "遠近";

// 的中結果の厳密な型定義（1: 〇的中, 0: ✕不中）
export type HitResult = 1 | 0;

// 試合全体のルール設定インターフェース
export interface MatchFormat {
  id: string;
  name: string;
  arrowCount: ArrowCountFormat;          // 一手 または 四矢
  totalArrowsPerPerson: number;          // 1人あたりの規定射数 (一手: 2, 四矢: 4)
  isTeamMatch: boolean;                  // 団体戦フラグ (true: 団体, false: 個人)
  playersPerTeam: number;                // チーム人数 (例: 3人立、5人立)
  tieBreaker: TieBreakerFormat;          // 競射形式
}

// 選手個別のスコアエンティティ
export interface PlayerScore {
  playerId: string;
  playerName: string;
  position: "大前" | "二番" | "中" | "落前" | "落";
  arrows: HitResult[];                   // 入力された矢の結果配列
  totalHits: number;                     // 的中合計数 (0以上の整数)
  isCompleted: boolean;                  // 規定射数終了フラグ
  updatedAt: number;                     // 最終更新エポックミリ秒
}

// チーム・立全体の進行・スコア管理エンティティ
export interface StandMatchScore {
  matchId: string;
  standNumber: number;                   // 立順番号
  teamId: string;
  teamName: string;
  format: MatchFormat;
  playerScores: Record<string, PlayerScore>; // 選手IDをキーとするスコアマップ
  totalTeamHits: number;                 // チーム総的中数
  updatedAt: number;
}