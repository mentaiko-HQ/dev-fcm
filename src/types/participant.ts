/**
 * 【参加選手ドメイン型定義モジュール（互換・一元化エクスポート）】
 *
 * 役割:
 * - 型の二重管理による型の不整合（TS2322）を解消するため、
 *   ドメインルート型定義（@/types）の型を完全同期して再エクスポート。
 * - standAssignments 内の standGroup / standOrder における null（未設定）許容を保証。
 *
 * フールプルーフ設計:
 * - 単一の型ソース（Single Source of Truth）として @/types を参照させ、
 *   インポート元による型定義の乖離事故を構造的に排除。
 */

export type {
  HitResult,
  StandRoundIndex,
  StandOrderIndex,
  StandOrderType,
  ArrowCountType,
  CompetitionCategory,
  MatchType,
  ArrowRule,
  TieBreakerMethod,
  TieBreakerRule,
  ShosaType,
  RankTitleType,
  StaffRoleType,
  StaffDutyShiftType,
  CheckInStatus,
  ProgressStatus,
  QualificationStatus,
  MatchStatus,
  QrDeliveryStatus,
  StandConfig,
  TournamentConfig,
  Match,
  StandAssignment,
  ScoreHistoryItem,
  ScoreRecord,
  TieBreakerRecord,
  PlayerScore,
  StandMatchScore,
  Team,
  AppUser,
  MatchProgress,
  EntryPlayerItem,
  RepresentativeEntryFormData,
  Participant,
} from './index';

export {
  STAND_CONFIGS,
  TOTAL_TOURNAMENT_SHOTS,
  isHitResult,
  isStandRoundIndex,
  sanitizeStandRoundIndex,
  isShosaType,
  sanitizeShosaType,
  isRankTitleType,
  sanitizeRankTitleType,
  sanitizeStandOrder,
  sanitizeStandGroup,
  isCheckInStatus,
  sanitizeCheckInStatus,
  isProgressStatus,
  sanitizeProgressStatus,
  isQualificationStatus,
  sanitizeQualificationStatus,
} from './index';
