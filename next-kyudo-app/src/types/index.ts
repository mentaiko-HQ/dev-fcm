// 弓道ドメインの厳密な型定義（フールプルーフ: 不正な競技ルールやスコア値の混入をコンパイル段階で防止）

export type ArrowCountFormat = "一手" | "四矢";
export type TieBreakerFormat = "射詰" | "遠近" | "なし";
export type MatchType = "INDIVIDUAL" | "TEAM" | "HYBRID"; // 個人戦 / 団体戦 / 複合
export type RoundTabType = "PRELIMINARY" | "FINAL";         // 成績入力タブ: 予選 / 決勝
export type MatchMode = "本戦" | "射詰競射" | "遠近競射";
export type HitResult = 1 | 0;

export type EntryType = "TEAM" | "INDIVIDUAL";
export type ProgressStatus = "WAITING" | "CALLED" | "SHOOTING" | "COMPLETED";
export type QualificationStatus = "ACTIVE" | "ABSENT" | "WITHDRAWN" | "DISQUALIFIED";
export type ShootingPosition = "大前" | "二番" | "中" | "落前" | "落";
export type DivisionType = "一般男子" | "一般女子" | "シニア男子" | "シニア女子";

// 大会設定・試合形式インターフェース
export interface TournamentConfig {
  matchId: string;
  title: string;                         // 大会名
  targetCount: number;                   // 射場的数
  matchType: MatchType;                  // 競技種別 (個人 / 団体 / 複合)
  playersPerTeam: number;                // 1チーム人数 (例: 3人立、5人立)
  preliminaryArrowCount: ArrowCountFormat; // 予選射数 (一手: 2, 四矢: 4)
  preliminaryStands: number;             // 予選立数 (例: 2立)
  finalArrowCount: ArrowCountFormat;     // 決勝射数
  finalStands: number;                   // 決勝立数 (例: 1立)
  tieBreakerFormat: TieBreakerFormat;    // 順位決定方式 (射詰 / 遠近 / なし)
  status: "CONFIGURING" | "IN_PROGRESS" | "FINISHED";
  currentStandNumber: number;
  maxStandNumber: number;
  updatedAt?: unknown;
}

// 選手個別のスコア・ステータスエンティティ
export interface PlayerScore {
  playerId: string;
  playerName: string;
  position: ShootingPosition;
  entryType: EntryType;
  progressStatus: ProgressStatus;
  qualificationStatus: QualificationStatus;
  teamId?: string | null;
  teamName?: string;
  preliminaryArrows: HitResult[];        // 予選矢配列
  finalArrows: HitResult[];              // 決勝矢配列
  totalHits: number;                     // 総合的中数
  isCompleted: boolean;                  // 規定射数終了フラグ
  isPerfect: boolean;                    // 皆中フラグ
  tieBreakerArrows?: HitResult[];        // 射詰競射矢配列
  enkinRank?: number | null;             // 遠近順位
  finalRank?: number | null;             // 確定総合順位
  updatedAt: number;
}

// チーム・立全体の進行・スコア管理エンティティ
export interface StandMatchScore {
  matchId: string;
  standNumber: number;
  currentRound: RoundTabType;            // PRELIMINARY (予選) | FINAL (決勝)
  teamId: string;
  teamName: string;
  mode: MatchMode;                       // 本戦 / 射詰競射 / 遠近競射
  playerScores: Record<string, PlayerScore>;
  totalTeamHits: number;
  updatedAt: number;
}