// 弓道ドメインの厳密な型定義（チェックイン機能・QRコード用プロパティを含む）

export type HitResult = 1 | 0;

export type StandRoundIndex = 1 | 2 | 3;

export type MatchMode = "本戦" | "射詰競射" | "遠近競射";
export type TieBreakerFormat = "射詰" | "遠近" | "なし";
export type ProgressStatus = "WAITING" | "CALLED" | "SHOOTING" | "COMPLETED";
export type QualificationStatus = "ACTIVE" | "ABSENT" | "WITHDRAWN" | "DISQUALIFIED";

export type ShosaType = "肌脱ぎ" | "襷掛け";
export type StaffRoleType = "進行" | "的前" | "招集" | "記録" | "カメラマン" | "運営" | "無し";
export type StaffDutyShiftType = "AM" | "PM" | "終日" | "無し";
export type RankTitleType = "称号を取得している" | "段位は四段以上" | "段位は三段以下";
export type StandOrderType = 1 | 2 | 3 | 4 | 5;

export const STAND_ORDER_LABELS: Record<StandOrderType, string> = {
  1: "大前",
  2: "２番",
  3: "中",
  4: "三番",
  5: "落ち",
};

// ★ 受付チェックイン状態の型定義をここでエクスポート
export type CheckInStatus = "UNCHECKED" | "CHECKED_IN" | "ABSENT";

export interface TournamentConfig {
  matchId: string;
  title: string;
  totalStands: number;
  totalArrows: number;
  tieBreakerFormat: TieBreakerFormat;
  status: "IN_PROGRESS" | "FINISHED";
  currentStandGroup: number;
  maxStandGroup: number;
  entryStartDate: string;
  entryEndDate: string;
  isEntryEnabled: boolean;
  updatedAt?: unknown;
}

export interface TournamentGuidelines extends TournamentConfig {
  dateText: string;
  venueText: string;
  organizerText: string;
  competitionRulesText: string;
  eligibilityText: string;
  entryFeeText: string;
  notesText: string;
}

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