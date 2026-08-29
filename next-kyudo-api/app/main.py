from fastapi import FastAPI, HTTPException, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
import logging
import typing

# 構造化ログ設定（フェイルセーフ: 障害発生時の原因究明を迅速化するためのログ設計）
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(filename)s:%(lineno)d - %(message)s"
)
logger = logging.getLogger("kyudo-api")

app = FastAPI(
    title="弓道大会運営システム API",
    description="大会進行状態の検証および個人/団体スコア・通知・遠近順位制御を行うバックエンドAPI",
    version="1.0.0"
)

# CORS設定（クロスオリジン通信制御: フロントエンドからの安全な通信を許可）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# フェイルセーフ: グローバル例外ハンドラ
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(f"【システム障害ログ】未捕捉の例外が発生しました: URL={request.url.path}, Error={str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error_code": "INTERNAL_SERVER_ERROR",
            "message": "システム内部で予期せぬエラーが発生しました。管理者ログを確認してください。"
        }
    )

class StandProgressNotificationRequest(BaseModel):
    current_match_id: str = Field(..., min_length=1, description="現在の試合/立ID")
    current_stand_number: int = Field(..., ge=1, description="現在競技中の立番号（1以上の整数）")

class ParticipantScorePayload(BaseModel):
    id: str = Field(..., min_length=1)
    entryType: str = Field(..., description="TEAM または INDIVIDUAL")
    teamId: typing.Optional[str] = None
    teamName: typing.Optional[str] = None
    playerName: str
    totalHits: int = Field(default=0, ge=0)
    totalShots: int = Field(default=0, ge=0)
    enkinRank: typing.Optional[int] = None
    qualificationStatus: str = Field(default="ACTIVE", description="ACTIVE, ABSENT, WITHDRAWN, DISQUALIFIED")

class RankCalculationRequest(BaseModel):
    match_id: str = Field(..., min_length=1, description="試合ID")
    match_format: str = Field(..., description="一手 / 四矢")
    tie_breaker_format: str = Field(..., description="射詰 / 遠近")
    participants: typing.List[ParticipantScorePayload] = Field(..., description="各選手のスコア・ステータスリスト")

    @field_validator("match_format")
    @classmethod
    def validate_match_format(cls, value: str) -> str:
        if value not in ["一手", "四矢"]:
            raise ValueError("match_format は '一手' または '四矢' である必要があります。")
        return value

    @field_validator("tie_breaker_format")
    @classmethod
    def validate_tie_breaker(cls, value: str) -> str:
        if value not in ["射詰", "遠近"]:
            raise ValueError("tie_breaker_format は '射詰' または '遠近' である必要があります。")
        return value

@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check() -> typing.Dict[str, str]:
    return {
        "status": "healthy",
        "service": "next-kyudo-api",
        "version": "1.0.0"
    }

@app.post("/api/v1/ranking/calculate", status_code=status.HTTP_200_OK)
async def calculate_rankings(
    payload: RankCalculationRequest
) -> typing.Dict[str, typing.Any]:
    """
    個人戦・団体戦の分離集計および欠員（ABSENT）を考慮した順位判定ロジック
    """
    try:
        raw_participants = payload.participants

        # 1. 個人戦ランキングの集計（失格者 DISQUALIFIED を除外）
        individual_eligible = [
            p for p in raw_participants
            if p.qualificationStatus in ["ACTIVE", "WITHDRAWN", "ABSENT"]
        ]

        def sort_individual_key(p: ParticipantScorePayload) -> typing.Tuple[int, int]:
            # 遠近順位が存在する場合は最優先
            enkin = p.enkinRank if (p.enkinRank is not None and p.enkinRank > 0) else 999
            hits = -1 * p.totalHits
            return (enkin, hits)

        ranked_individuals = sorted(individual_eligible, key=sort_individual_key)

        # 2. 団体戦ランキングの集計（フールプルーフ: entryType === 'INDIVIDUAL' の選手を完全に除外）
        team_groups: typing.Dict[str, typing.Dict[str, typing.Any]] = {}
        for p in raw_participants:
            if p.entryType == "TEAM" and p.teamId:
                if p.teamId not in team_groups:
                    team_groups[p.teamId] = {
                        "teamId": p.teamId,
                        "teamName": p.teamName or p.teamId,
                        "totalHits": 0,
                        "totalShots": 0,
                        "activeMemberCount": 0,
                        "members": []
                    }
                # 欠席でない選手のみチーム総的中数へ加算（欠員立ちフェイルセーフ）
                if p.qualificationStatus in ["ACTIVE", "WITHDRAWN"]:
                    team_groups[p.teamId]["totalHits"] += p.totalHits
                    team_groups[p.teamId]["totalShots"] += p.totalShots
                    team_groups[p.teamId]["activeMemberCount"] += 1
                team_groups[p.teamId]["members"].append(p.model_dump())

        ranked_teams = sorted(
            list(team_groups.values()),
            key=lambda t: t["totalHits"],
            reverse=True
        )

        return {
            "success": True,
            "match_id": payload.match_id,
            "format": payload.match_format,
            "tie_breaker_format": payload.tie_breaker_format,
            "ranked_individuals": [p.model_dump() for p in ranked_individuals],
            "ranked_teams": ranked_teams,
            "message": f"集計完了: 個人 {len(ranked_individuals)} 名, 団体 {len(ranked_teams)} チーム"
        }
    except Exception as e:
        logger.error(f"【エラーログ】順位集計処理中にエラーが発生しました: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="順位集計中にシステム内部エラーが発生しました。"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)