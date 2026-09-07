"""
【FastAPI バックエンド エントリーポイント】
CORS設定、ヘルスチェック（/health および /api/health）、Resendメール送信APIを提供。

フールプルーフ設計:
- load_dotenv() により .env ファイルから自動で環境変数をロード。起動時の設定漏れを防止。
- /health および /api/health の両エンドポイントを同一ハンドラーに割り当て、監視ツールや手動アクセス時のURLパス指定ミスを吸収。
- Pydantic v2 仕様に準拠した型定義（HealthCheckResponse, EmailConfirmationRequest, EmailConfirmationResponse）により入出力スキーマを厳格化。
- APIキーの存在およびプレフィックス（'re_'）の事前検証。

フェイルセーフ設計:
- CORSミドルウェアを明示的に設定し、クロスオリジン通信ブロックを未然に防止。
- ヘルスチェック処理内で例外が発生した場合でも、プロセス停止を防ぎ 503 Service Unavailable と障害内容を安全に返却。
- メール配信用APIキー未設定時や外部通信障害時でも例外でプロセスを落とさず、安全なレスポンスを返却。
- 構造化ログを出力し、問題発生時のトレーサビリティを確保。
"""

import os
import sys
import logging
from pathlib import Path
from typing import List, Optional
from fastapi import FastAPI, status, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from dotenv import load_dotenv
import resend

# ロギング設定（フールプルーフ：ログの標準出力フォーマット統一）
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("kyudo-api")

# 【フールプルーフ】プロジェクトルートの .env ファイルを確実に解決してロード
env_path = Path(__file__).resolve().parent.parent / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
    logger.info(f".env ファイルを読み込みました: {env_path}")
else:
    logger.warning(f".env ファイルが見つかりません: {env_path}")

app = FastAPI(
    title="Kyudo Tournament API",
    description="第5回めんたいこ杯争奪弓道大会 運営管理API",
    version="1.0.0"
)

# 【フェイルセーフ】Next.jsフロントエンド（ローカル開発環境）からの通信を許可するCORS設定
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# スキーマ定義 (Pydantic Models)
# ==========================================

class HealthCheckResponse(BaseModel):
    status: str = Field(description="稼働状態（healthy / degraded / unhealthy）")
    service: str = Field(default="kyudo-backend", description="サービス識別名")
    version: str = Field(default="1.0.0", description="APIバージョン")
    resend_configured: bool = Field(description="Resend APIキーの設定状態")
    error: Optional[str] = Field(default=None, description="異常時のエラーメッセージ")


class EmailConfirmationRequest(BaseModel):
    to_email: EmailStr = Field(description="送信先メールアドレス")
    representative_name: str = Field(min_length=1, description="参加申込代表者氏名")
    player_names: List[str] = Field(min_length=1, description="登録選手氏名一覧")
    total_fee: int = Field(ge=0, description="合計参加費")


class EmailConfirmationResponse(BaseModel):
    success: bool
    message: str


# ==========================================
# エンドポイント定義
# ==========================================

def execute_health_check(response: Response) -> HealthCheckResponse:
    """
    ヘルスチェック共通ロジック。
    環境変数の設定状態を評価し、異常発生時もフェイルセーフにレスポンスを生成する。
    """
    try:
        resend_key = os.environ.get("RESEND_API_KEY", "").strip()
        is_resend_ready = bool(resend_key and resend_key.startswith("re_"))

        response.status_code = status.HTTP_200_OK
        return HealthCheckResponse(
            status="healthy",
            service="kyudo-backend",
            version="1.0.0",
            resend_configured=is_resend_ready,
            error=None
        )
    except Exception as exc:
        # 【フェイルセーフ】内部エラー時も例外を送出せず503レスポンスを返却
        logger.error(f"ヘルスチェック処理中に例外が発生しました: {str(exc)}", exc_info=True)
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthCheckResponse(
            status="unhealthy",
            service="kyudo-backend",
            version="1.0.0",
            resend_configured=False,
            error=str(exc)
        )


@app.get(
    "/health",
    response_model=HealthCheckResponse,
    status_code=status.HTTP_200_OK,
    summary="システムヘルスチェック（標準ルート）",
    tags=["Monitoring"]
)
def health_check_root(response: Response):
    """
    【フールプルーフ対応】
    /health への直接アクセスを許容し、監視エージェントやブラウザからのパス指定ミスによる 404 Not Found を防止。
    """
    return execute_health_check(response)


@app.get(
    "/api/health",
    response_model=HealthCheckResponse,
    status_code=status.HTTP_200_OK,
    summary="システムヘルスチェック（APIプレフィックスルート）",
    tags=["Monitoring"]
)
def health_check_api(response: Response):
    """
    【互換性維持】
    従来の /api/health エンドポイント。/health と同一の処理を実行。
    """
    return execute_health_check(response)


@app.post(
    "/api/v1/email/send-confirmation",
    response_model=EmailConfirmationResponse,
    status_code=status.HTTP_200_OK,
    summary="仮エントリー受付確認メール送信",
    tags=["Email"]
)
def send_confirmation_email(payload: EmailConfirmationRequest):
    """
    【仮エントリー受付確認メール送信エンドポイント】
    Resend API経由で代表者宛てに受付通知とPayPay送金案内を送信する。
    """
    resend_api_key = os.environ.get("RESEND_API_KEY", "").strip()

    # 【フールプルーフ ＆ フェイルセーフ】APIキーの存在および書式（re_で開始）の検証
    if not resend_api_key or not resend_api_key.startswith("re_"):
        masked_key = f"{resend_api_key[:5]}..." if resend_api_key else "None"
        logger.warning(
            f"【メール送信スキップ】有効なRESEND_API_KEYが未設定です。キー: '{masked_key}' / 宛先: {payload.to_email}"
        )
        return EmailConfirmationResponse(
            success=False,
            message="有効なメール配信用APIキー（re_...）が未設定のため、送信をスキップしました（エントリー自体は完了しています）。"
        )

    try:
        resend.api_key = resend_api_key

        players_list_str = "、".join(payload.player_names)
        html_content = f"""
        <h2>【第5回めんたいこ杯争奪弓道大会】仮エントリー受付のお知らせ</h2>
        <p>{payload.representative_name} 様</p>
        <p>大会への参加エントリーを受け付けました。</p>
        <hr />
        <h3>■ エントリー内容</h3>
        <ul>
            <li><strong>代表者氏名:</strong> {payload.representative_name}</li>
            <li><strong>参加選手:</strong> {players_list_str}（計 {len(payload.player_names)} 名）</li>
            <li><strong>合計参加費:</strong> {payload.total_fee:,} 円</li>
        </ul>
        <hr />
        <h3>■ 参加確定手順（PayPay送金）</h3>
        <p>参加費合計 <strong>{payload.total_fee:,} 円</strong> を以下のPayPayID宛にご送金ください。</p>
        <p><strong>送金先PayPayID:</strong> hayapaaaay</p>
        <p><strong>メッセージ欄記入名:</strong> {payload.representative_name}</p>
        <p>※送金確認をもって正式な受付完了となります。</p>
        """

        # 【フールプルーフ】型定義 SendParams に準拠
        params: resend.Emails.SendParams = {
            "from": "めんたいこ杯運営事務局 <onboarding@resend.dev>",
            "to": [payload.to_email],
            "subject": "【第5回めんたいこ杯】仮エントリー受付完了のお知らせ",
            "html": html_content,
        }

        resend.Emails.send(params)
        logger.info(f"【メール送信成功】送信先: {payload.to_email}")
        return EmailConfirmationResponse(
            success=True,
            message="確認メールを正常に送信しました。"
        )

    except Exception as exc:
        # 【フェイルセーフ】外部API通信失敗時でもプロセス停止を防ぎエラー内容を返却
        logger.error(f"【メール送信失敗】例外ログ: {str(exc)}", exc_info=True)
        return EmailConfirmationResponse(
            success=False,
            message=f"メール配信サービスでエラーが発生しました: {str(exc)}"
        )