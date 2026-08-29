// 弓道ドメインの厳密な型定義（フールプルーフ: 不正な競技ルールやスコア値の混入をコンパイル段階で防止）

// 射数形式（一手: 2本, 四矢: 4本）
export type ArrowCountFormat = "一手" | "四矢";

// 順位決定戦・競射ルール（射詰: サドンデス、遠近: 審判判定による順位直接入力）
export type TieBreakerFormat = "射詰" | "遠近";

// 競技モード（本戦 / 射詰競射 / 遠近競射）
export type MatchMode = "本戦" | "射詰競射" | "遠近競射";

// 的中結果の厳密な型定義（1: 〇的中, 0: ✕不中）
export type HitResult = 1 | 0;

// ① エントリー形態（個人参加 vs 団体参加）
export type EntryType = "TEAM" | "INDIVIDUAL";

// ② 進行・招集ステータス
export type ProgressStatus = "WAITING" | "CALLED" | "SHOOTING" | "COMPLETED";

// ③ 出欠・競技資格ステータス（フールプルーフ & フェイルセーフ）
export type QualificationStatus = "ACTIVE" | "ABSENT" | "WITHDRAWN" | "DISQUALIFIED";

// 立ち位置の定義（弓道の標準的な5人立ち形式）
export type ShootingPosition = "大前" | "二番" | "中" | "落前" | "落";

// 競技部門の定義
export type DivisionType =
  | "一般男子"
  | "一般女子"
  | "シニア男子"
  | "シニア女子";

// 試合全体のルール設定インターフェース
export interface MatchFormat {
  id: string;
  name: string;
  arrowCount: ArrowCountFormat;
  totalArrowsPerPerson: number;
  isTeamMatch: boolean;
  playersPerTeam: number;
  tieBreaker: TieBreakerFormat;
}

// 選手個別のスコア・ステータスエンティティ
export interface PlayerScore {
  playerId: string;
  playerName: string;
  position: ShootingPosition;
  entryType: EntryType;                         // 団体 / 個人
  progressStatus: ProgressStatus;               // 待機 / 招集 / 行射 / 終了
  qualificationStatus: QualificationStatus;     // 出欠・資格（ACTIVE, ABSENT, WITHDRAWN, DISQUALIFIED）
  teamId?: string | null;                       // 団体時必須、個人時null
  teamName?: string;
  arrows: HitResult[];                          // 入力された矢の結果配列
  totalHits: number;                            // 的中合計数 (0以上の整数)
  isCompleted: boolean;                         // 規定射数終了フラグ
  isPerfect: boolean;                           // 皆中フラグ
  tieBreakerArrows?: HitResult[];               // 射詰競射時の矢の結果配列
  enkinRank?: number | null;                    // 遠近競射時の決定順位（1: 1位, 2: 2位, ... / null: 未設定）
  finalRank?: number | null;                    // 確定順位（1位〜）
  updatedAt: number;                            // 最終更新エポックミリ秒
}

// チーム・立全体の進行・スコア管理エンティティ
export interface StandMatchScore {
  matchId: string;
  standNumber: number;                          // 立順番号
  teamId: string;
  teamName: string;
  format: MatchFormat;
  mode: MatchMode;                              // 現在の入力モード（本戦 / 射詰 / 遠近）
  playerScores: Record<string, PlayerScore>;    // 選手IDをキーとするスコアマップ
  totalTeamHits: number;                        // チーム総的中数（団体選手のみ合算）
  updatedAt: number;
}