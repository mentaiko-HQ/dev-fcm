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
 * - 過去のコンポーネントとの互換性を保つための型エイリアス（StandOrderType）を定義。
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

// 【下位互換性維持のための型エイリアス】
export type StandOrderType = StandOrderIndex;

// 矢数種別（2: 一手, 4: 四矢）
export type ArrowCountType = 2 | 4;

// 競技種別（個人戦 / 団体戦）
export type CompetitionCategory = "INDIVIDUAL" | "TEAM";

// 順位決定戦（競射）の競技方式（IZUME: 射詰サドンデス, ENKIN: 遠近中心距離判定）
export type TieBreakerMethod = "IZUME" | "ENKIN";

// 所作（射法区分）
export type ShosaType = "肌脱ぎ" | "襷掛け";

// 称号・段位区分
export type RankTitleType = "段位は三段以下" | "段位は四段以上" | "称号を取得している";

// 大会役員・係員の役割区分
export type StaffRoleType = "進行" | "的前" | "招集" | "記録" | "カメラマン" | "運営" | "無し";

// 役員担当時間帯区分
export type StaffDutyShiftType = "AM" | "PM" | "終日" | "無し";

// 受付・チェックインステータス（出欠管理）
export type CheckInStatus = "UNCHECKED" | "CHECKED_IN" | "ABSENT";

// 選手の競技進行ステータス
export type ProgressStatus = "WAITING" | "CALLED" | "IN_STAND" | "FINISHED";

// 選手の参加資格ステータス
export type QualificationStatus = "ACTIVE" | "DISQUALIFIED" | "WITHDRAWN";

// 試合・大会全体の進行ステータス
export type MatchStatus = "READY" | "IN_PROGRESS" | "TIE_BREAKER" | "FINISHED";

// QRコード送信ステータス
export type QrDeliveryStatus = "UNSENT" | "SENT" | "FAILED";


// ==========================================
// 2. 立構造・大会設定モデル
// ==========================================

export interface StandConfig {
  roundIndex: StandRoundIndex;
  name: string;
  arrowCount: ArrowCountType;
}

export const STAND_CONFIGS: Record<StandRoundIndex, StandConfig> = {
  1: { roundIndex: 1, name: "第1立 (午前・一手)", arrowCount: 2 },
  2: { roundIndex: 2, name: "第2立 (午後・一手)", arrowCount: 2 },
  3: { roundIndex: 3, name: "第3立 (決勝・四矢)", arrowCount: 4 },
};

export interface TournamentConfig {
  matchId: string;
  title: string;
  date: string;
  venue: string;
  totalStandGroups: number;
}


// ==========================================
// 3. 立配置・スコア・競射モデル
// ==========================================

export interface StandAssignment {
  standGroup: number;
  standOrder: StandOrderIndex;
}

export interface ScoreHistoryItem {
  arrowIndex: number;
  result: HitResult;
  timestamp: number;
}

export interface TieBreakerRecord {
  method: TieBreakerMethod;
  arrows: HitResult[];
  distanceMm?: number;
  rank?: number;
}

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
  standAssignments: Record<StandRoundIndex, StandAssignment>;
  stand1_arrows: HitResult[];
  stand2_arrows: HitResult[];
  stand3_arrows: HitResult[];
  tieBreaker?: TieBreakerRecord;
  totalHits: number;
  isCompleted: boolean;
  isPerfect: boolean;
}

export interface StandMatchScore {
  matchId: string;
  standGroup: number;
  roundIndex: StandRoundIndex;
  playerScores: Record<string, PlayerScore>;
  isLocked: boolean;
  updatedAt: number;
}


// ==========================================
// 4. チーム・ユーザー・進行通知モデル
// ==========================================

export interface Team {
  id: string;
  name: string;
  organization: string;
  standGroup: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface AppUser {
  userId: string;
  teamId: string;
  teamName: string;
  participantId?: string;
  playerName?: string;
  bibNumber?: number;
  standGroup: number;
  fcmToken: string | null;
  updatedAt: number;
  tokenCleanedAt?: number;
}

export interface MatchProgress {
  matchId: string;
  title: string;
  currentRound: StandRoundIndex;
  currentStandGroup: number;
  totalStandGroups: number;
  status: MatchStatus;
  updatedAt: number;
}


// ==========================================
// 5. エントリーフォーム関連モデル
// ==========================================

export interface EntryPlayerItem {
  name: string;
  nameKana: string;
  shosa: ShosaType;
  rankTitle: RankTitleType;
  needsSupport: boolean;
  isStaffVolunteer: boolean;
}

export interface RepresentativeEntryFormData {
  representativeName: string;
  representativeEmail: string;
  representativePhone: string;
  representativeOrganization: string;
  players: EntryPlayerItem[];
  notes: string;
}


// ==========================================
// 6. 参加選手統合モデル
// ==========================================

export interface Participant {
  id: string;
  bibNumber: number;
  name: string;
  nameKana: string;
  organization: string;
  shosa: ShosaType;
  rankTitle: RankTitleType;
  staffRole: StaffRoleType;
  staffDutyShift: StaffDutyShiftType;
  checkInStatus: CheckInStatus;
  checkInAt: number | null;
  isStaffVolunteer: boolean;
  needsSupport: boolean;
  standAssignments: Record<StandRoundIndex, StandAssignment>;
  progressStatus: ProgressStatus;
  qualificationStatus: QualificationStatus;
  stand1_arrows: HitResult[];
  stand2_arrows: HitResult[];
  stand3_arrows: HitResult[];
  totalHits: number;
  totalShots: number;
  isPerfect: boolean;
  enkinRank: number | null;
  finalRank: number | null;
  representativeName: string;
  representativeEmail: string;
  representativePhone: string;
  representativeOrganization: string;
  isPaid: boolean;
  paidAt: number | null;
  notes: string;
  qrSentAt?: number | null;
  qrSentStatus?: QrDeliveryStatus;
  qrSentError?: string | null;
  updatedAt?: number;
}


// ==========================================
// 7. フールプルーフ / フェイルセーフ ヘルパー関数群
// ==========================================

export function isHitResult(value: unknown): value is HitResult {
  return value === 1 || value === 0;
}

export function isStandRoundIndex(value: unknown): value is StandRoundIndex {
  return value === 1 || value === 2 || value === 3;
}

export function sanitizeStandRoundIndex(value: unknown): StandRoundIndex {
  const num = Number(value);
  if (num === 1 || num === 2 || num === 3) {
    return num;
  }
  console.warn("【フェイルセーフ】不正な立インデックスを検出。第1立にフォールバック:", value);
  return 1;
}

export function isShosaType(value: unknown): value is ShosaType {
  return value === "肌脱ぎ" || value === "襷掛け";
}

export function sanitizeShosaType(value: unknown): ShosaType {
  if (isShosaType(value)) {
    return value;
  }
  console.warn("【フェイルセーフ】不正な所作区分を検出。肌脱ぎにフォールバック:", value);
  return "肌脱ぎ";
}

export function isRankTitleType(value: unknown): value is RankTitleType {
  return (
    value === "段位は三段以下" ||
    value === "段位は四段以上" ||
    value === "称号を取得している"
  );
}

export function sanitizeRankTitleType(value: unknown): RankTitleType {
  if (isRankTitleType(value)) {
    return value;
  }
  console.warn("【フェイルセーフ】不正な段位称号区分を検出。段位は三段以下にフォールバック:", value);
  return "段位は三段以下";
}

export function sanitizeStandOrder(value: unknown): StandOrderIndex {
  const num = Number(value);
  if (num >= 1 && num <= 5) {
    return num as StandOrderIndex;
  }
  console.warn("【フェイルセーフ】不正な立順番号を検出。1番立にフォールバック:", value);
  return 1;
}

export function isCheckInStatus(value: unknown): value is CheckInStatus {
  return value === "UNCHECKED" || value === "CHECKED_IN" || value === "ABSENT";
}

export function sanitizeCheckInStatus(value: unknown): CheckInStatus {
  if (isCheckInStatus(value)) {
    return value;
  }
  console.warn("【フェイルセーフ】不正な受付ステータスを検出。UNCHECKEDにフォールバック:", value);
  return "UNCHECKED";
}

export function isProgressStatus(value: unknown): value is ProgressStatus {
  return value === "WAITING" || value === "CALLED" || value === "IN_STAND" || value === "FINISHED";
}

export function sanitizeProgressStatus(value: unknown): ProgressStatus {
  if (isProgressStatus(value)) {
    return value;
  }
  console.warn("【フェイルセーフ】不正な進行ステータスを検出。WAITINGにフォールバック:", value);
  return "WAITING";
}

export function isQualificationStatus(value: unknown): value is QualificationStatus {
  return value === "ACTIVE" || value === "DISQUALIFIED" || value === "WITHDRAWN";
}

export function sanitizeQualificationStatus(value: unknown): QualificationStatus {
  if (isQualificationStatus(value)) {
    return value;
  }
  console.warn("【フェイルセーフ】不正な参加資格ステータスを検出。ACTIVEにフォールバック:", value);
  return "ACTIVE";
}