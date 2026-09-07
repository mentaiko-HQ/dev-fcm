/**
 * 【参加者データモデル (Participant)】
 * 午前一手（第1立）、午後一手（第2立）、午後四矢（第3立）のそれぞれに対して、
 * 独立した「立ちグループ (standGroup)」および「立順 (standOrder)」を設定できる構造へ拡張。
 */

import {
  ProgressStatus,
  QualificationStatus,
  ShosaType,
  StaffRoleType,
  StaffDutyShiftType,
  HitResult,
  RankTitleType,
  CheckInStatus,
  StandRoundIndex
} from "./index";

/**
 * 【フールプルーフ】各立ごとの立グループおよび立順の個別設定
 */
export interface StandAssignment {
  standGroup: number; // 立ちグループ番号 (例: 1, 2, 3...)
  standOrder: 1 | 2 | 3 | 4 | 5; // 立順 (1:大前, 2:2番, 3:中, 4:三番, 5:落ち)
}

export interface Participant {
  id: string;
  bibNumber: number;
  name: string;
  nameKana: string;
  organization: string;
  shosa: ShosaType;
  rankTitle: RankTitleType;
  staffRole: StaffRoleType;
  staffDutyShift?: StaffDutyShiftType;
  checkInStatus: CheckInStatus;
  checkInAt?: number | null;
  // 【フールプルーフ】入金確認済みフラグを追加し、未入金者の参加を制限
  isPaid: boolean;
  paidAt?: number | null;
  isStaffVolunteer?: boolean;
  needsSupport?: boolean;

  // 【新仕様】各立（第1立・第2立・第3立）ごとの立グループと立順の個別設定マップ
  standAssignments: Record<StandRoundIndex, StandAssignment>;

  progressStatus: ProgressStatus;
  qualificationStatus: QualificationStatus;

  // 各立の矢の的中記録（第1立: 2射, 第2立: 2射, 第3立: 4射 = 計8射）
  stand1_arrows: HitResult[];
  stand2_arrows: HitResult[];
  stand3_arrows: HitResult[];

  totalHits: number;
  totalShots: number; // 固定で8
  isPerfect?: boolean;
  enkinRank?: number | null;
  finalRank?: number | null;
  userId?: string;
  representativeName?: string;
  representativeEmail?: string;
  representativePhone?: string;
  representativeOrganization?: string;
  notes?: string;
  agreedAt?: number;
  updatedAt?: number;
}