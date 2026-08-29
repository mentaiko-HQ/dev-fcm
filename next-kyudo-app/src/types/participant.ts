import { EntryType, ProgressStatus, QualificationStatus, ShootingPosition, DivisionType, HitResult } from "./index";

export interface Participant {
  id: string;
  standNumber: number;
  position: ShootingPosition;
  entryType: EntryType;
  progressStatus: ProgressStatus;
  qualificationStatus: QualificationStatus;
  teamId?: string | null;
  teamName: string;
  playerName: string;
  division: DivisionType;
  preliminaryArrows?: HitResult[];
  finalArrows?: HitResult[];
  totalHits: number;
  totalShots: number;
  isPerfect?: boolean;
  enkinRank?: number | null;
  finalRank?: number | null;
  userId?: string;
  updatedAt?: number;
}