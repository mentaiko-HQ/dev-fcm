// 競技部門の定義（フールプルーフ: 不正な部門文字列の混入をコンパイル段階で防ぐ）
export type DivisionType =
  | '一般男子'
  | '一般女子'
  | 'シニア男子'
  | 'シニア女子';

// 進行・招集ステータスの定義（フールプルーフ: 想定外の状態遷移を防止する）
export type ParticipantStatus =
  | '待機中'
  | '招集中'
  | '行射中'
  | '競技終了'
  | '棄権';

// 立ち位置の定義（弓道の標準的な5人立ち形式）
export type ShootingPosition = '大前' | '二番' | '中' | '落前' | '落';

// 参加選手エンティティのインターフェース
export interface Participant {
  id: string; // 選手固有ID
  standNumber: number; // 立順番号（1以上の整数）
  position: ShootingPosition; // 立ち位置
  teamId: string; // 所属チームID
  teamName: string; // チーム・所属団体名
  playerName: string; // 選手氏名
  division: DivisionType; // 部門
  status: ParticipantStatus; // 招集・競技ステータス
  totalHits: number; // 現在の的中数（0以上の整数）
  totalShots: number; // 射数（例: 4本、8本など）
}
