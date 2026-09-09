"""
【FastAPI バックエンド エントリーポイント】
CORS設定、ヘルスチェック、Resendメール送信API（エントリー確認・選手個別QR受付コード配信・一括配信）を提供。

Pylance静的解析エラー対応:
- `import qrcode` 単体では `constants` サブモジュールが型チェッカーに解決されないため、
  `import qrcode.constants` を明示的にインポートして型エラー（reportAttributeAccessIssue）を解消。

フールプルーフ設計（操作ミス・不正入力の入口遮断）:
- Pydantic v2仕様に準拠したスキーマ定義により、リクエストボディの不正な型や欠落パラメータを入口で遮断。
- EmailStr による厳格なメール構文チェック。
- ゼッケン番号（1以上）、立順（1〜5番）、立番号（1以上）の境界値検証（Field ge, le）。
- QRコード生成用文字列が空文字または空白のみの場合に入口で検証。

フェイルセーフ設計（障害発生時の安全縮退）:
- QRコード画像をディスクに保存せず、メモリバッファ（io.BytesIO）内で生成・Base64化してCIDインライン添付。ファイル残留障害を防止。
- 単体送信 (/api/v1/email/send-qr-single) と一括送信 (/api/v1/email/send-qr-batch) の両エンドポイントを提供。
- RESEND_API_KEY 未設定時やResend側通信障害時でも例外によるプロセス停止を防ぎ、構造化された失敗レスポンスを返却。
- QR生成処理の例外を捕捉し、生成失敗時は呼び出し元へ明確なエラー詳細を返却。
"""

import os
import sys
import io
import base64
import logging
from pathlib import Path
from typing import List, Optional
from fastapi import FastAPI, status, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from dotenv import load_dotenv
import qrcode
import qrcode.constants
from qrcode.constants import ERROR_CORRECT_M
import resend

# ログ出力の統一フォーマット設定
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("kyudo-api")

# プロジェクトルートの .env ファイルを確実にロード
env_path = Path(__file__).resolve().parent.parent / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
    logger.info(f".env ファイルを読み込みました: {env_path}")
else:
    logger.warning(f".env ファイルが見つかりません: {env_path}")

app = FastAPI(
    title="Kyudo Tournament API",
    description="第5回めんたいこ杯争奪弓道大会 運営管理API",
    version="1.3.1"
)

# CORS設定（フロントエンドからの通信を許可）
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
    status: str = Field(description="稼働状態")
    service: str = Field(default="kyudo-backend", description="サービス識別名")
    version: str = Field(default="1.3.1", description="APIバージョン")
    resend_configured: bool = Field(description="Resend APIキーの設定状態")
    error: Optional[str] = Field(default=None, description="エラー内容")


class EmailConfirmationRequest(BaseModel):
    to_email: EmailStr = Field(description="送信先メールアドレス")
    representative_name: str = Field(min_length=1, description="参加申込代表者氏名")
    player_names: List[str] = Field(min_length=1, description="登録選手氏名一覧")
    total_fee: int = Field(ge=0, description="合計参加費")


class EmailConfirmationResponse(BaseModel):
    success: bool
    message: str


class SendQrEmailSingleRequest(BaseModel):
    tournamentTitle: str = Field(default="第5回めんたいこ杯争奪弓道大会", description="大会名")
    participantId: str = Field(min_length=1, description="選手ID")
    bibNumber: int = Field(ge=1, description="ゼッケン番号")
    name: str = Field(min_length=1, description="選手氏名")
    email: EmailStr = Field(description="送信先メールアドレス")
    organization: str = Field(default="", description="所属団体")
    stand1Group: int = Field(ge=1, default=1, description="第1立の立番号")
    stand1Order: int = Field(ge=1, le=5, default=1, description="第1立の立順")
    stand2Group: int = Field(ge=1, default=1, description="第2立の立番号")
    stand2Order: int = Field(ge=1, le=5, default=1, description="第2立の立順")
    checkinPayload: str = Field(min_length=1, description="QRコードに埋め込む認証データ文字列")


class SendQrEmailSingleResponse(BaseModel):
    participantId: str
    bibNumber: int
    name: str
    email: str
    success: bool
    message: str
    errorDetail: Optional[str] = None


class ParticipantQrEmailItem(BaseModel):
    participantId: str = Field(min_length=1, description="選手ID")
    bibNumber: int = Field(ge=1, description="ゼッケン番号")
    name: str = Field(min_length=1, description="選手氏名")
    email: EmailStr = Field(description="送信先メールアドレス")
    organization: str = Field(default="", description="所属団体")
    stand1Group: int = Field(ge=1, default=1, description="第1立の立番号")
    stand1Order: int = Field(ge=1, le=5, default=1, description="第1立の立順")
    stand2Group: int = Field(ge=1, default=1, description="第2立の立番号")
    stand2Order: int = Field(ge=1, le=5, default=1, description="第2立の立順")
    checkinPayload: str = Field(min_length=1, description="QRコードに埋め込む認証データ文字列")


class SendQrEmailBatchRequest(BaseModel):
    tournamentTitle: str = Field(default="第5回めんたいこ杯争奪弓道大会", description="大会名")
    participants: List[ParticipantQrEmailItem] = Field(min_length=1, description="送信対象選手一覧")


class SendQrEmailBatchResponse(BaseModel):
    totalRequested: int
    successCount: int
    failureCount: int
    results: List[SendQrEmailSingleResponse]


# ==========================================
# ユーティリティ関数
# ==========================================

def generate_qr_png_bytes(data_text: str) -> bytes:
    """
    指定文字列からQRコードをインメモリ生成し、PNGバイト列を返却する。
    
    フールプルーフ:
    - 空文字または空白のみのデータが渡された場合はValueErrorを送出。
    
    フェイルセーフ:
    - ディスクI/Oを行わずメモリ上（io.BytesIO）で完結させ、ファイルシステムの障害を回避。
    - 明示的にインポートした ERROR_CORRECT_M 定数を使用し、Pylance静的解析エラーを回避。
    """
    if not data_text or not data_text.strip():
        raise ValueError("QRコード生成データが空です。")

    qr = qrcode.QRCode(
        version=1,
        error_correction=ERROR_CORRECT_M,
        box_size=8,
        border=2,
    )
    qr.add_data(data_text.strip())
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


# ==========================================
# エンドポイント定義
# ==========================================

@app.get(
    "/health",
    response_model=HealthCheckResponse,
    status_code=status.HTTP_200_OK,
    summary="ヘルスチェック",
    tags=["Monitoring"]
)
def health_check(response: Response):
    """
    APIサーバーの稼働状態および外部サービス設定状況（Resend APIキー）を検査する。
    """
    try:
        resend_key = os.environ.get("RESEND_API_KEY", "").strip()
        is_ready = bool(resend_key and resend_key.startswith("re_"))
        return HealthCheckResponse(
            status="healthy",
            service="kyudo-backend",
            version="1.3.1",
            resend_configured=is_ready,
            error=None
        )
    except Exception as exc:
        logger.error(f"ヘルスチェック例外: {str(exc)}", exc_info=True)
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthCheckResponse(
            status="unhealthy",
            service="kyudo-backend",
            version="1.3.1",
            resend_configured=False,
            error=str(exc)
        )


@app.get(
    "/api/health",
    response_model=HealthCheckResponse,
    status_code=status.HTTP_200_OK,
    summary="ヘルスチェック (互換パス)",
    tags=["Monitoring"]
)
def health_check_api(response: Response):
    """
    リバースプロキシやNext.jsリライト設定経由のヘルスチェック用エンドポイント。
    """
    return health_check(response)


@app.post(
    "/api/v1/email/send-confirmation",
    response_model=EmailConfirmationResponse,
    status_code=status.HTTP_200_OK,
    summary="仮エントリー受付確認メール送信",
    tags=["Email"]
)
def send_confirmation_email(payload: EmailConfirmationRequest):
    """
    エントリー完了時に代表者へ仮受付通知メールを送信する。
    """
    resend_api_key = os.environ.get("RESEND_API_KEY", "").strip()

    if not resend_api_key or not resend_api_key.startswith("re_"):
        masked_key = f"{resend_api_key[:5]}..." if resend_api_key else "None"
        logger.warning(
            f"【メール送信スキップ】有効なRESEND_API_KEYが未設定です。キー: '{masked_key}' / 宛先: {payload.to_email}"
        )
        return EmailConfirmationResponse(
            success=False,
            message="有効なメール配信用APIキー（re_...）が未設定のため、送信をスキップしました。"
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
        logger.error(f"【メール送信失敗】例外ログ: {str(exc)}", exc_info=True)
        return EmailConfirmationResponse(
            success=False,
            message=f"メール配信サービスでエラーが発生しました: {str(exc)}"
        )


@app.post(
    "/api/v1/email/send-qr-single",
    response_model=SendQrEmailSingleResponse,
    status_code=status.HTTP_200_OK,
    summary="参加受付QRコードメール個別送信",
    tags=["Email"]
)
def send_qr_code_single(payload: SendQrEmailSingleRequest):
    """
    対象選手1名に対して、最新の立順情報および受付用QRコード画像をインライン添付してメール送信する。
    """
    resend_api_key = os.environ.get("RESEND_API_KEY", "").strip()

    if not resend_api_key or not resend_api_key.startswith("re_"):
        logger.error("【メール配信拒否】有効な RESEND_API_KEY が未設定です。")
        return SendQrEmailSingleResponse(
            participantId=payload.participantId,
            bibNumber=payload.bibNumber,
            name=payload.name,
            email=payload.email,
            success=False,
            message="バックエンドでメール配信用APIキーが未設定です。",
            errorDetail="RESEND_API_KEY is not configured on backend."
        )

    try:
        resend.api_key = resend_api_key

        # 1. QRコード画像バイト列のインメモリ生成
        qr_bytes = generate_qr_png_bytes(payload.checkinPayload)
        qr_base64 = base64.b64encode(qr_bytes).decode("ascii")

        # 2. メール本文 (HTML) の生成
        html_body = f"""
        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
            <div style="background-color: #0f172a; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="color: #ffffff; font-size: 18px; margin: 0;">{payload.tournamentTitle}</h1>
                <p style="color: #94a3b8; font-size: 12px; margin: 5px 0 0 0;">大会当日 受付用QRコードのご案内</p>
            </div>
            
            <div style="background-color: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-top: none;">
                <p style="font-size: 15px; font-weight: bold; margin-top: 0;">{payload.name} 選手（{payload.organization or "無所属"}）</p>
                <p style="font-size: 13px; color: #475569;">
                    大会へのご参加ありがとうございます。<br />
                    立順情報および当日の受付用QRコードを発行いたしました。<br />
                    会場到着後、受付端末に以下の<strong>受付用QRコード</strong>をご提示ください。
                </p>

                <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center;">
                    <span style="font-size: 12px; color: #64748b; display: block; margin-bottom: 4px;">ゼッケン番号</span>
                    <span style="font-size: 26px; font-weight: 800; color: #0f172a; font-family: monospace;">No. {payload.bibNumber}</span>
                </div>

                <div style="text-align: center; padding: 20px; background-color: #ffffff; border: 2px dashed #cbd5e1; border-radius: 8px; margin: 20px 0;">
                    <img src="cid:checkin-qrcode" alt="受付用QRコード" style="width: 200px; height: 200px; display: inline-block;" />
                    <p style="font-size: 11px; color: #64748b; margin: 8px 0 0 0;">※画像が表示されない場合は添付ファイルの qrcode.png をご確認ください。</p>
                </div>

                <div style="background-color: #f1f5f9; border-radius: 6px; padding: 14px; margin-top: 20px;">
                    <h3 style="font-size: 13px; margin: 0 0 8px 0; color: #0f172a;">■ 確定立順情報</h3>
                    <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 6px 0; color: #475569; border-bottom: 1px solid #e2e8f0;">第1立 (午前一手):</td>
                            <td style="padding: 6px 0; font-weight: bold; color: #0f172a; border-bottom: 1px solid #e2e8f0;">第 {payload.stand1Group} 立 - {payload.stand1Order} 番</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; color: #475569;">第2立 (午後一手):</td>
                            <td style="padding: 6px 0; font-weight: bold; color: #0f172a; border-bottom: 1px solid #e2e8f0;">第 {payload.stand2Group} 立 - {payload.stand2Order} 番</td>
                        </tr>
                    </table>
                </div>

                <div style="margin-top: 24px; padding: 12px; background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; font-size: 11px; color: #92400e;">
                    <strong>【注意事項】</strong><br />
                    ・立順変更等により複数回本メールを受信された場合は、<strong>最新のメールに記載された立順およびQRコード</strong>を有効とします。<br />
                    ・競技進行状況に連動した入場呼出通知は、選手専用ポータル（/standby）にて通知を許可しておくことでスマートフォンに届きます。
                </div>
            </div>

            <div style="background-color: #f8fafc; padding: 16px; text-align: center; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; font-size: 11px; color: #94a3b8;">
                めんたいこ杯争奪弓道大会 運営事務局
            </div>
        </div>
        """

        # 3. Resend API 経由でのメール送信実行
        params: resend.Emails.SendParams = {
            "from": "めんたいこ杯運営事務局 <onboarding@resend.dev>",
            "to": [payload.email],
            "subject": f"【受付QRコード】{payload.tournamentTitle}（ゼッケンNo.{payload.bibNumber} {payload.name} 選手）",
            "html": html_body,
            "attachments": [
                {
                    "filename": f"qrcode_bib_{payload.bibNumber}.png",
                    "content": qr_base64,
                    "content_id": "checkin-qrcode"
                }
            ]
        }

        resend.Emails.send(params)
        logger.info(f"【個別QRメール送信成功】ゼッケン {payload.bibNumber} ({payload.name}) -> {payload.email}")

        return SendQrEmailSingleResponse(
            participantId=payload.participantId,
            bibNumber=payload.bibNumber,
            name=payload.name,
            email=payload.email,
            success=True,
            message="送信完了"
        )

    except Exception as err:
        logger.error(f"【個別QRメール送信失敗】ゼッケン {payload.bibNumber} 宛先 {payload.email}: {str(err)}", exc_info=True)
        return SendQrEmailSingleResponse(
            participantId=payload.participantId,
            bibNumber=payload.bibNumber,
            name=payload.name,
            email=payload.email,
            success=False,
            message="メール送信処理中にエラーが発生しました。",
            errorDetail=str(err)
        )


@app.post(
    "/api/v1/email/send-qr-batch",
    response_model=SendQrEmailBatchResponse,
    status_code=status.HTTP_200_OK,
    summary="参加受付QRコードメール一括送信 (下位互換対応)",
    tags=["Email"]
)
def send_qr_code_batch(payload: SendQrEmailBatchRequest):
    """
    複数選手に対する一括送信を受け付け、個別の送信ロジックを実行して集計結果を返却する。
    1件が失敗してもループ全体を中断せず、残りの選手への配信を継続する。
    """
    results: List[SendQrEmailSingleResponse] = []
    success_count = 0
    failure_count = 0

    for item in payload.participants:
        single_req = SendQrEmailSingleRequest(
            tournamentTitle=payload.tournamentTitle,
            participantId=item.participantId,
            bibNumber=item.bibNumber,
            name=item.name,
            email=item.email,
            organization=item.organization,
            stand1Group=item.stand1Group,
            stand1Order=item.stand1Order,
            stand2Group=item.stand2Group,
            stand2Order=item.stand2Order,
            checkinPayload=item.checkinPayload,
        )
        res = send_qr_code_single(single_req)
        results.append(res)
        if res.success:
            success_count += 1
        else:
            failure_count += 1

    return SendQrEmailBatchResponse(
        totalRequested=len(payload.participants),
        successCount=success_count,
        failureCount=failure_count,
        results=results
    )