// 弓道ドメインの厳密な型定義（第5回めんたいこ杯争奪弓道大会 個人戦・代表者一括エントリー仕様）

export type HitResult = 1 | 0;

// 行射回次（第1立: 一手2射, 第2立: 一手2射, 第3立: 四ツ矢4射 / 全3立・計8射）
export type StandRoundIndex = 1 | 2 | 3;

export type MatchMode = "本戦" | "射詰競射" | "遠近競射";
export type TieBreakerFormat = "射詰" | "遠近" | "なし";
export type ProgressStatus = "WAITING" | "CALLED" | "SHOOTING" | "COMPLETED";
export type QualificationStatus = "ACTIVE" | "ABSENT" | "WITHDRAWN" | "DISQUALIFIED";

// 所作（肌脱ぎ / 襷掛け）
export type ShosaType = "肌脱ぎ" | "襷掛け";

// 大会役員種類（進行 / 的前 / 招集 / 記録 / カメラマン / 運営 / 無し）
export type StaffRoleType = "進行" | "的前" | "招集" | "記録" | "カメラマン" | "運営" | "無し";

// 役員担当時間帯（AM / PM / 終日 / 無し）
export type StaffDutyShiftType = "AM" | "PM" | "終日" | "無し";

// 称号・段位ステータス
export type RankTitleType = "称号を取得している" | "段位は四段以上" | "段位は三段以下";

// 立順（弓道の伝統的呼称: 大前 / ２番 / 中 / 三番 / 落ち、内部数値は 1〜5）
export type StandOrderType = 1 | 2 | 3 | 4 | 5;

// 立順の表示名マッピング定義（フールプルーフ: UI表記の統一）
export const STAND_ORDER_LABELS: Record<StandOrderType, string> = {
  1: "大前",
  2: "２番",
  3: "中",
  4: "三番",
  5: "落ち",
};

// 大会設定インターフェース
export interface TournamentConfig {
  matchId: string;
  title: string;
  totalStands: number; // 3
  totalArrows: number; // 8 (2 + 2 + 4)
  tieBreakerFormat: TieBreakerFormat;
  status: "IN_PROGRESS" | "FINISHED";
  currentStandGroup: number;
  maxStandGroup: number;
  entryStartDate: string;               // エントリー開始日時（ISO形式: YYYY-MM-DDTHH:mm）
  entryEndDate: string;                 // エントリー終了日時（ISO形式: YYYY-MM-DDTHH:mm）
  isEntryEnabled: boolean;              // エントリー受付有効/無効フラグ
  updatedAt?: unknown;
}

// 大会要項およびエントリー期間管理インターフェース
export interface TournamentGuidelines extends TournamentConfig {
  dateText: string;                     // 開催日時テキスト
  venueText: string;                    // 会場テキスト
  organizerText: string;                // 主催・主管
  competitionRulesText: string;         // 競技規定
  eligibilityText: string;              // 参加資格
  entryFeeText: string;                 // 参加費
  notesText: string;                    // 注意事項・安全管理
}

// エントリーフォーム内 個別選手入力データ定義
export interface EntryPlayerItem {
  name: string;                         // 選手氏名
  nameKana: string;                     // 選手ふりがな
  shosa: ShosaType;                     // 所作（肌脱ぎ / 襷掛け）
  rankTitle: RankTitleType;             // 称号・段位
  needsSupport: boolean;                // サポートの必要の有無
  isStaffVolunteer: boolean;            // 大会役員協力希望の有無
}

// 代表者一括エントリーフォーム入力用インターフェース
export interface RepresentativeEntryFormData {
  representativeName: string;           // 参加申し込み代表者
  representativeEmail: string;          // 代表者メールアドレス
  representativePhone: string;          // 代表者携帯電話番号
  representativeOrganization: string;   // 代表者所属団体
  players: EntryPlayerItem[];           // 参加選手リスト（希望人数分）
  notes: string;                        // 運営に伝えたいこと（備考欄）
}

// 選手個別のスコア・ステータスエンティティ
export interface PlayerScore {
  playerId: string;
  bibNumber: number;
  name: string;
  nameKana: string;
  organization: string;
  shosa: ShosaType;
  rankTitle: RankTitleType;
  staffRole: StaffRoleType;
  staffDutyShift?: StaffDutyShiftType;
  standGroup: number;
  standOrder: StandOrderType;
  progressStatus: ProgressStatus;
  qualificationStatus: QualificationStatus;
  stand1_arrows: HitResult[];
  stand2_arrows: HitResult[];
  stand3_arrows: HitResult[];
  totalHits: number;
  isCompleted: boolean;
  isPerfect: boolean;
  isIshuSokuchu?: boolean;
  isYotsuyaKaichu?: boolean;
  tieBreakerArrows?: HitResult[];
  enkinRank?: number | null;
  finalRank?: number | null;
  updatedAt: number;
}

// 立ちグループ単位のスコア管理エンティティ
export interface StandMatchScore {
  matchId: string;
  standGroup: number;
  currentStandRound: StandRoundIndex;
  mode: MatchMode;
  playerScores: Record<string, PlayerScore>;
  updatedAt: number;
}