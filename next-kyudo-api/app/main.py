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
    description="大会進行状態の検証およびスコア・通知・遠近順位制御を行うバックエンドAPI",
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

# フェイルセーフ: グローバル例外ハンドラ（未捕捉の例外発生時もAPIサーバーを落さず安全側で500応答を返却）
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

# フールプルーフ: 立進行通知リクエストの型・値制約（1以上の整数のみ許容）
class StandProgressNotificationRequest(BaseModel):
    current_match_id: str = Field(..., min_length=1, description="現在の試合/立ID")
    current_stand_number: int = Field(..., ge=1, description="現在競技中の立番号（1以上の整数）")

# 順位判定・同中者抽出リクエスト（フールプルーフ: 不正な射数形式やスコアの混入を防止）
class RankCalculationRequest(BaseModel):
    match_id: str = Field(..., min_length=1, description="試合ID")
    match_format: str = Field(..., description="一手 / 四矢")
    tie_breaker_format: str = Field(..., description="射詰 / 遠近")
    participants_scores: typing.List[typing.Dict[str, typing.Any]] = Field(..., description="各選手のスコアリスト")

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
    """
    システムの死活監視用ヘルスチェックエンドポイント
    """
    return {
        "status": "healthy",
        "service": "next-kyudo-api",
        "version": "1.0.0"
    }

@app.post("/api/v1/notifications/trigger-call", status_code=status.HTTP_200_OK)
async def trigger_stand_call_notification(
    payload: StandProgressNotificationRequest
) -> typing.Dict[str, typing.Any]:
    """
    立の進行に応じた呼出対象立（2立後）を計算・返却するエンドポイント
    """
    try:
        current_stand: int = payload.current_stand_number
        target_stand: int = current_stand + 2  # 弓道大会運用ルール: 2立前の立開始時に招集

        logger.info(f"進行更新検知: match_id={payload.current_match_id}, 現在立={current_stand}, 呼出対象立={target_stand}")

        return {
            "success": True,
            "match_id": payload.current_match_id,
            "current_stand": current_stand,
            "target_call_stand": target_stand,
            "message": f"第{target_stand}立の選手に向けた呼出通知トリガーを受信しました。"
        }
    except Exception as e:
        logger.error(f"【エラーログ】呼出計算処理中にエラーが発生しました: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="呼出処理の計算中に内部エラーが発生しました。"
        )

@app.post("/api/v1/ranking/calculate", status_code=status.HTTP_200_OK)
async def calculate_rankings(
    payload: RankCalculationRequest
) -> typing.Dict[str, typing.Any]:
    """
    競技結果の集計と順位判定・競射進出者の自動抽出ロジック（弓道競技規則準拠）
    """
    try:
        scores_list = payload.participants_scores

        # 遠近競射が実施されている場合は、直接入力された遠近順位（enkinRank）を最優先で評価
        if payload.tie_breaker_format == "遠近":
            def sort_key_enkin(p: typing.Dict[str, typing.Any]) -> typing.Tuple[int, int]:
                enkin_rank = p.get("enkinRank")
                rank_val = enkin_rank if (isinstance(enkin_rank, int) and enkin_rank > 0) else 999
                hits_val = -1 * p.get("totalHits", 0)
                return (rank_val, hits_val)

            sorted_participants = sorted(scores_list, key=sort_key_enkin)
            requires_tie_breaker = False
            top_contenders = []
        else:
            # 射詰および本戦の場合: 的中数降順ソート
            sorted_participants = sorted(
                scores_list,
                key=lambda x: x.get("totalHits", 0),
                reverse=True
            )
            max_hits = sorted_participants[0].get("totalHits", 0) if sorted_participants else 0
            top_contenders = [p for p in sorted_participants if p.get("totalHits", 0) == max_hits]
            requires_tie_breaker = len(top_contenders) > 1 and max_hits > 0

        return {
            "success": True,
            "match_id": payload.match_id,
            "format": payload.match_format,
            "tie_breaker_format": payload.tie_breaker_format,
            "ranked_participants": sorted_participants,
            "requires_tie_breaker": requires_tie_breaker,
            "tie_breaker_contenders": top_contenders if requires_tie_breaker else [],
            "message": "順位集計が正常に完了しました。"
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