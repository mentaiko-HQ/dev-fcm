from fastapi import FastAPI, HTTPException, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, validator
import logging
import typing

# 構造化ログ設定（フェイルセーフ: 異常発生時の即時追跡・エラーログ収集）
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(filename)s:%(lineno)d - %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="弓道大会運営システム 高度処理 API",
    description="大会進行状態の検証およびスコア・通知制御を行うバックエンドAPI",
    version="1.0.0"
)

# CORS設定（クロスオリジン通信制御）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# フェイルセーフ: グローバル例外ハンドラ（未捕捉の例外時もプロセスを落とさず安全側で500応答）
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(f"【システム障害ログ】未捕捉の例外が発生しました: URL={request.url.path}, Error={str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error_code": "INTERNAL_SERVER_ERROR",
            "message": "システム内部で予期せぬエラーが発生しました。運営管理者へご連絡ください。"
        }
    )

# フールプルーフ: 立進行リクエストの厳格な型・値制約（1以上の整数値のみ許可）
class StandProgressNotificationRequest(BaseModel):
    current_match_id: str = Field(..., min_length=1, description="現在の立/試合ID")
    current_stand_number: int = Field(..., ge=1, description="現在競技中の立番号（1以上の整数）")

# フールプルーフ: スコア検証リクエストのバリデーション
class MatchRuleVerificationRequest(BaseModel):
    match_id: str = Field(..., min_length=1, description="試合のユニークID")
    arrow_format: str = Field(..., description="試合形式（一手 または 四矢）")
    scores: typing.List[int] = Field(..., description="的中データ（0: ✕, 1: 〇）の配列")

    @validator("arrow_format")
    def validate_arrow_format(cls, value: str) -> str:
        if value not in ["一手", "四矢"]:
            raise ValueError("arrow_format は '一手' または '四矢' である必要があります。")
        return value

    @validator("scores")
    def validate_scores_values(cls, scores: typing.List[int]) -> typing.List[int]:
        for idx, score in enumerate(scores):
            if score not in [0, 1]:
                raise ValueError(f"インデックス {idx} のスコア値が無効です。0（✕）または 1（〇）のみ指定可能です。")
        return scores

@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check() -> typing.Dict[str, str]:
    """
    システムの死活監視用ヘルスチェックエンドポイント
    """
    return {"status": "healthy", "service": "next-kyudo-api", "version": "1.0.0"}

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

@app.post("/api/v1/rules/verify", status_code=status.HTTP_200_OK)
async def verify_match_rules(
    payload: MatchRuleVerificationRequest
) -> typing.Dict[str, typing.Any]:
    """
    入力されたスコアが弓道の試合形式ルール（規定矢数等）に適合しているか検証するエンドポイント
    """
    try:
        logger.info(f"スコア検証リクエスト受信: match_id={payload.match_id}, format={payload.arrow_format}")

        expected_max_arrows: int = 2 if payload.arrow_format == "一手" else 4
        actual_arrows: int = len(payload.scores)

        # フールプルーフ: 規定矢数超過の入力ミスを入口でブロック
        if actual_arrows > expected_max_arrows:
            logger.warning(f"【バリデーション警告】規定矢数超過: 形式={payload.arrow_format}, 期待値={expected_max_arrows}, 入力値={actual_arrows}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{payload.arrow_format}の規定矢数は {expected_max_arrows} 本ですが、{actual_arrows} 本のデータが送信されました。"
            )

        total_hits: int = sum(payload.scores)

        return {
            "success": True,
            "message": "ルール整合性検証を通過しました。",
            "details": {
                "match_id": payload.match_id,
                "format": payload.arrow_format,
                "verified_arrows": actual_arrows,
                "total_hits": total_hits
            }
        }

    except HTTPException as http_err:
        raise http_err
    except Exception as e:
        logger.error(f"【エラーログ】ルール検証中に予期せぬエラーが発生しました: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="スコア検証中にシステム内部エラーが発生しました。"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)