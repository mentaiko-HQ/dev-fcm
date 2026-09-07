/**
 * 【大会運営システム 共通ドメイン型定義モジュール】
 * 
 * 弓道大会特有の競技構造（立・射・所作・段位・役員・チーム・スコア・競射）および
 * システム共通モデル（ユーザー・進行管理・エントリー）を統合管理する型定義ファイル。
 * 
 * フールプルーフ設計:
 * - 各種リテラル型（HitResult, StandRoundIndex, ShosaType等）による不正な値のコンパイル時検出。
 * - 型ガード関数（isHitResult, isStandRoundIndex等）により、ランタイムでの不正入力や異常値を入口で遮断。
 * 
 * フェイルセーフ設計:
 * - サニタイズ関数（sanitizeStandRoundIndex, sanitizeShosaType等）を提供し、
 *   Firestore等の外部データに未定義・破損値が含まれていた場合でも安全な規定値へ自動フォールバック。
 */

// ==========================================
// 1. 弓道ドメイン 基礎プリミティブ型
// ==========================================

// 射（矢）ごとの的中判定（1: 的中〇, 0: 外れ✕）
export type HitResult = 1 | 0;

// 立（ラウンド）のインデックス（1: 第1立・午前一手, 2: 第2立・午後一手, 3: 第3立・決勝四矢）
export type StandRoundIndex = 1 | 2 | 3;

// 立順（射位番号: 1番大前 〜 5番落）
export type StandOrderIndex = 1 | 2 | 3 | 4 | 5;

// 所作（射法区分）
export type ShosaType = "肌脱ぎ" | "襷掛け";

// 称号・段位区分
export type RankTitleType = "段位は三段以下" | "段位は四段以上" | "称号を取得している";

// 大会役員・係員の役割区分
export type StaffRoleType = "進行" | "的前" | "招集" | "記録" | "カメラマン" | "運営" | "無し";

// 役員担当時間帯区分
export type StaffDutyShiftType = "AM" | "PM" | "終日" | "無し";

// 受付・チェックインステータス
export type CheckInStatus = "UNCHECKED" | "CHECKED_IN" | "ABSENT";

// 選手の競技進行ステータス
export type ProgressStatus = "WAITING" | "CALLED" | "IN_STAND" | "FINISHED";

// 選手の参加資格ステータス
export type QualificationStatus = "ACTIVE" | "DISQUALIFIED" | "WITHDRAWN";

// 試合・大会全体の進行ステータス
export type MatchStatus = "READY" | "IN_PROGRESS" | "TIE_BREAKER" | "FINISHED";


// ==========================================
// 2. 立構造・大会設定モデル
// ==========================================

// 各立の構成設定
export interface StandConfig {
  roundIndex: StandRoundIndex;
  name: string;
  arrowCount: number; // 射数（一手: 2射, 四矢: 4射）
}

// 立構成マスターデータ
export const STAND_CONFIGS: Record<StandRoundIndex, StandConfig> = {
  1: { roundIndex: 1, name: "第1立 (午前・一手)", arrowCount: 2 },
  2: { roundIndex: 2, name: "第2立 (午後・一手)", arrowCount: 2 },
  3: { roundIndex: 3, name: "第3立 (決勝・四矢)", arrowCount: 4 },
};

// 大会メタ設定モデル
export interface TournamentConfig {
  matchId: string;
  title: string;
  date: string;
  venue: string;
  totalRounds: number;
}


// ==========================================
// 3. スコア・選手成績モデル
// ==========================================

// 選手1名あたりのスコア記録モデル
export interface PlayerScore {
  playerId: string;
  playerName: string;
  bibNumber: number;
  name: string;
  nameKana: string;
  organization: string;
  shosa: ShosaType;
  staffRole: StaffRoleType;
  qualificationStatus: QualificationStatus;
  standAssignments: Record<StandRoundIndex, { standGroup: number; standOrder: StandOrderIndex }>;
  stand1_arrows: HitResult[];
  stand2_arrows: HitResult[];
  stand3_arrows: HitResult[];
  totalHits: number;
  isCompleted: boolean;
  isPerfect: boolean;
}

// 特定の立グループ・立における試合スコアドキュメント（Firestore `scores` 格納モデル）
export interface StandMatchScore {
  matchId: string;
  standGroup: number;
  roundIndex: StandRoundIndex;
  playerScores: Record<string, PlayerScore>;
  isLocked: boolean;
  updatedAt: number;
}


// ==========================================
// 4. チーム・ユーザー・進行通知モデル（主要機能要件1・3対応）
// ==========================================

// チーム情報モデル（Firestore `teams` 格納モデル）
export interface Team {
  id: string;
  name: string;
  organization: string;
  standGroup: number; // 割り当てられた立番号（1〜N）
  createdAt?: number;
  updatedAt?: number;
}

// ユーザー・通知デバイストークン管理モデル（Firestore `users` 格納モデル）
export interface AppUser {
  userId: string;
  teamId: string;
  teamName: string;
  standGroup: number;
  fcmToken: string | null;
  updatedAt: number;
  tokenCleanedAt?: number;
}

// 試合全体のリアルタイム進行管理モデル（Firestore `matches` 格納モデル）
export interface MatchProgress {
  matchId: string;
  title: string;
  currentRound: StandRoundIndex;
  currentStandGroup: number; // 現在競技中の立グループ番号
  totalStandGroups: number;  // 総立グループ数
  status: MatchStatus;
  updatedAt: number;
}


// ==========================================
// 5. エントリーフォーム関連モデル
// ==========================================

// 参加選手個別入力データモデル
export interface EntryPlayerItem {
  name: string;
  nameKana: string;
  shosa: ShosaType;
  rankTitle: RankTitleType;
  needsSupport: boolean;
  isStaffVolunteer: boolean;
}

// 代表者エントリーフォーム送信データモデル
export interface RepresentativeEntryFormData {
  representativeName: string;
  representativeEmail: string;
  representativePhone: string;
  representativeOrganization: string;
  players: EntryPlayerItem[];
  notes: string;
}


// ==========================================
// 6. フールプルーフ / フェイルセーフ ヘルパー関数群
// ==========================================

/**
 * 【フールプルーフ】的中値の型ガード
 */
export function isHitResult(value: unknown): value is HitResult {
  return value === 1 || value === 0;
}

/**
 * 【フールプルーフ】立インデックスの型ガード
 */
export function isStandRoundIndex(value: unknown): value is StandRoundIndex {
  return value === 1 || value === 2 || value === 3;
}

/**
 * 【フェイルセーフ】立インデックスの安全サニタイズ（異常値検出時は第1立を返却）
 */
export function sanitizeStandRoundIndex(value: unknown): StandRoundIndex {
  const num = Number(value);
  if (num === 1 || num === 2 || num === 3) {
    return num;
  }
  console.warn("【フェイルセーフ】不正な立インデックスを検出。第1立にフォールバックします:", value);
  return 1;
}

/**
 * 【フールプルーフ】所作区分の型ガード
 */
export function isShosaType(value: unknown): value is ShosaType {
  return value === "肌脱ぎ" || value === "襷掛け";
}

/**
 * 【フェイルセーフ】所作区分の安全サニタイズ（異常値検出時は「肌脱ぎ」を返却）
 */
export function sanitizeShosaType(value: unknown): ShosaType {
  if (isShosaType(value)) {
    return value;
  }
  console.warn("【フェイルセーフ】不正な所作区分を検出。肌脱ぎにフォールバックします:", value);
  return "肌脱ぎ";
}

/**
 * 【フールプルーフ】段位・称号区分の型ガード
 */
export function isRankTitleType(value: unknown): value is RankTitleType {
  return (
    value === "段位は三段以下" ||
    value === "段位は四段以上" ||
    value === "称号を取得している"
  );
}

/**
 * 【フェイルセーフ】段位・称号区分の安全サニタイズ（異常値検出時は「段位は三段以下」を返却）
 */
export function sanitizeRankTitleType(value: unknown): RankTitleType {
  if (isRankTitleType(value)) {
    return value;
  }
  console.warn("【フェイルセーフ】不正な段位称号区分を検出。段位は三段以下にフォールバックします:", value);
  return "段位は三段以下";
}

/**
 * 【フェイルセーフ】立順の安全サニタイズ（1〜5の範囲外検出時は1番立にフォールバック）
 */
export function sanitizeStandOrder(value: unknown): StandOrderIndex {
  const num = Number(value);
  if (num >= 1 && num <= 5) {
    return num as StandOrderIndex;
  }
  console.warn("【フェイルセーフ】不正な立順番号を検出。1番立にフォールバックします:", value);
  return 1;
}