// 弓道ドメインの厳密な型定義

// 試合形式（一手: 2本, 四矢: 4本）
export type ArrowCountFormat = '一手' | '四矢';

// 順位決定戦ルール（射詰: サドンデス、遠近: 的中心からの距離）
export type TieBreakerFormat = '射詰' | '遠近';

// 大会ルール設定インターフェース
export interface MatchFormat {
  id: string;
  name: string;
  arrowCount: ArrowCountFormat;
  totalArrowsPerPerson: number;
  isTeamMatch: boolean;
  playersPerTeam: number;
  tieBreaker: TieBreakerFormat;
}

// ユーザーおよびFCMトークン管理インターフェース
export interface UserSession {
  userId: string;
  selectedTeamId: string | null;
  fcmToken: string | null;
  updatedAt: number;
}

// 的中結果の定義（1: 〇的中, 0: ✕不中）
export type HitResult = 1 | 0;

// スコア入力データのインターフェース
export interface PlayerScore {
  playerId: string;
  playerName: string;
  arrows: HitResult[];
}
