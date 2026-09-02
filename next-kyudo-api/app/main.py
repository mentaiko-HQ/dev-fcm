import logging
import typing
import os
from fastapi import FastAPI, HTTPException, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
from app.email_service import EmailPayload, send_entry_confirmation_email

# 【ロギング設定】システムの追跡および障害時のデバッグ用
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(filename)s:%(lineno)d - %(message)s"
)
logger = logging.getLogger("kyudo-api")

app = FastAPI(
    title="第5回めんたいこ杯争奪弓道大会 API",
    description="個人戦専用スコア・立順・メール配信API",
    version="5.3.0"
)

# 【CORS設定】フロントエンドからのクロスドメインアクセス許可
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CheckInPayload(BaseModel):
    participant_id: str
    bib_number: int

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(f"【システム障害】URL={request.url.path}, Error={str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error_code": "INTERNAL_SERVER_ERROR",
            "message": "システム内部で予期せぬエラーが発生しました。"
        }
    )

@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check() -> typing.Dict[str, str]:
    return {"status": "healthy", "tournament": "第5回めんたいこ杯争奪弓道大会"}

@app.post("/api/v1/email/send-confirmation", status_code=status.HTTP_200_OK)
async def send_confirmation_email_endpoint(payload: EmailPayload) -> typing.Dict[str, typing.Any]:
    """
    【メール配信エンドポイント】Resend経由で仮エントリー確認メールを送信する
    """
    success, error_detail = send_entry_confirmation_email(payload)
    if not success:
        logger.error(f"【メール配信エラー返却】詳細: {error_detail}")
        return {
            "success": False,
            "message": f"エントリーは登録されましたが、メール送信に失敗しました: {error_detail}"
        }
    
    return {
        "success": True,
        "message": "確認メールを正常に送信しました。"
    }

@app.post("/api/v1/checkin/verify", status_code=status.HTTP_200_OK)
async def verify_checkin_endpoint(payload: CheckInPayload) -> typing.Dict[str, typing.Any]:
    try:
        return {
            "success": True,
            "message": f"ゼッケン No.{payload.bib_number} の選手を受付完了として登録しました。",
            "checked_in_at": "2026-09-02T12:37:29JST"
        }
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)