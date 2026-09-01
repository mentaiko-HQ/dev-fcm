import {
  ProgressStatus,
  QualificationStatus,
  ShosaType,
  StaffRoleType,
  StaffDutyShiftType,
  StandOrderType,
  HitResult,
  RankTitleType
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
  staffDutyShift?: StaffDutyShiftType;  // 役員担当時間帯（AM / PM / 終日 / 無し）
  isStaffVolunteer?: boolean;           // 大会役員協力希望の有無
  needsSupport?: boolean;               // サポートの必要の有無
  standGroup: number;                   // 立ちグループ (1〜99)
  standOrder: StandOrderType;           // 立順 (1: 大前, 2: ２番, 3: 中, 4: 三番, 5: 落ち)
  progressStatus: ProgressStatus;       // 進行状態
  qualificationStatus: QualificationStatus; // 出欠資格
  stand1_arrows: HitResult[];
  stand2_arrows: HitResult[];
  stand3_arrows: HitResult[];
  totalHits: number;
  totalShots: number;
  isPerfect?: boolean;
  isIshuSokuchu?: boolean;
  isYotsuyaKaichu?: boolean;
  enkinRank?: number | null;
  finalRank?: number | null;
  userId?: string;
  
  // 代表者一括エントリー情報
  representativeName?: string;
  representativeEmail?: string;
  representativePhone?: string;
  representativeOrganization?: string;
  notes?: string;
  agreedAt?: number;
  updatedAt?: number;
}