import {
  ProgressStatus,
  QualificationStatus,
  ShosaType,
  StaffRoleType,
  StaffDutyShiftType,
  StandOrderType,
  HitResult,
  RankTitleType,
  CheckInStatus
} from "./index";

export interface Participant {
  id: string;
  bibNumber: number;                    // ゼッケン番号
  name: string;                         // 選手氏名
  nameKana: string;                     // ふりがな
  organization: string;                 // 所属団体名
  shosa: ShosaType;                     // 所作（肌脱ぎ / 襷掛け）
  rankTitle: RankTitleType;             // 称号・段位
  staffRole: StaffRoleType;             // 役員種類
  staffDutyShift?: StaffDutyShiftType;  // 担当時間帯
  checkInStatus: CheckInStatus;         // ★ 受付チェックイン状態
  checkInAt?: number | null;            // ★ チェックイン時刻
  isStaffVolunteer?: boolean;
  needsSupport?: boolean;
  standGroup: number;                   // 立ちグループ
  standOrder: StandOrderType;           // 立順
  progressStatus: ProgressStatus;
  qualificationStatus: QualificationStatus;
  stand1_arrows: HitResult[];
  stand2_arrows: HitResult[];
  stand3_arrows: HitResult[];
  totalHits: number;
  totalShots: number;
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