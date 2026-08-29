import { EntryType, ProgressStatus, QualificationStatus, ShootingPosition, DivisionType } from "./index";

// 参加選手エンティティのインターフェース（3層ステータス完全統合）
export interface Participant {
  id: string;                                   // 選手固有ID
  standNumber: number;                          // 立順番号（1以上の整数）
  position: ShootingPosition;                   // 立ち位置
  entryType: EntryType;                         // ① エントリー形態（TEAM / INDIVIDUAL）
  progressStatus: ProgressStatus;               // ② 進行・招集ステータス（WAITING / CALLED / SHOOTING / COMPLETED）
  qualificationStatus: QualificationStatus;     // ③ 出欠・資格ステータス（ACTIVE / ABSENT / WITHDRAWN / DISQUALIFIED）
  teamId?: string | null;                       // 所属チームID（個人の場合はnull）
  teamName: string;                             // チーム・所属団体名
  playerName: string;                           // 選手氏名
  division: DivisionType;                       // 部門
  totalHits: number;                            // 現在の的中数（0以上の整数）
  totalShots: number;                           // 射数（例: 2本、4本など）
  isPerfect?: boolean;                          // 皆中フラグ
  enkinRank?: number | null;                    // 遠近順位（決定順位）
  finalRank?: number | null;                    // 総合確定順位
  userId?: string;                              // 個人通知用ユーザーID
  updatedAt?: number;                           // 最終更新エポックミリ秒
}