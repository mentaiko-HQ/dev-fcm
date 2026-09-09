/**
 * 【参加選手ドメインモデル型定義】
 * 大会受付、立順割り当て、QRコード送信管理に関する型定義。
 */

import { HitResult, StandRoundIndex, ShosaType, StaffRoleType, StaffDutyShiftType, CheckInStatus, ProgressStatus, QualificationStatus } from "@/types";

export interface StandAssignment {
  standGroup: number;
  standOrder: 1 | 2 | 3 | 4 | 5;
}

export interface Participant {
  id: string;
  bibNumber: number;
  name: string;
  nameKana: string;
  organization: string;
  shosa: ShosaType;
  rankTitle: string;
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
  
  // QRコード送信管理フィールド（本機能で利用）
  qrSentAt?: number | null;
  qrSentStatus?: "UNSENT" | "SENT" | "FAILED";
  qrSentError?: string | null;

  updatedAt?: number;
}