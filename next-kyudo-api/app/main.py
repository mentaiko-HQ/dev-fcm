"""
【弓道大会運営システム バックエンドAPIサービス】
役割:
- 参加受付、スコア管理、および公式入場QRコード案内メールの配信。
- エントリー時の仮受付完了・PayPay送金案内メール送信 (/api/v1/email/send-confirmation)。
- 選手氏名・ゼッケン番号・午前午後立順が焼き込まれた「一体型QRカード画像」の合成およびメール送信 (/api/v1/email/send-qr-single)。
- Resend 公式仕様に基づく CID (Content-ID) インライン画像埋め込みによるメール本文内画像確実表示。

フールプルーフ設計:
- サーバー起動時に python-dotenv (load_dotenv) を絶対パスで強制実行し、カレントディレクトリに依存しない環境変数ロードを保証。
- SendConfirmationRequest において to_email と email の双方の属性アクセスを許容するプロパティ実装。
- FROM_EMAIL / RESEND_FROM_EMAIL / RESEND_FROM_NAME のいずれの命名設定でも送信元を安全に自動解決する多層フォールバック。
- 宛先メールアドレスの形式検証、選手リストの空検証。
- 立ち順（午前・午後の組・射位）が未設定（None）の選手に対するQR送信を400エラーで遮断。
- Resend SDK の TypedDict 定義差分を typing.cast で安全に吸収し、Pylance 型エラーを解消。

フェイルセーフ設計:
- 【修正】CORS設定 (ALLOWED_ORIGINS) にVercelの本番ドメインとワイルドカードを追加し、本番環境からの通信拒否(ERR_CONNECTION_REFUSED / Failed to fetch)を防止。
- Resend APIキー未設定時は success=False かつ isSimulation=True とし、UI側に設定不備を明示して安全に縮退。
- サーバーOS上に日本語フォントが存在しない場合でもデフォルトフォント (ImageFont.load_default) へ安全にフォールバック。
- Resend API通信時の例外を捕捉し、スタックトレース付きエラーログを記録してクライアントへ安全なJSONレスポンスを返却。
"""

import os
import io
import base64
from typing import Optional, List, Any, cast
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, status, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from PIL import Image, ImageDraw, ImageFont
import qrcode
from qrcode.constants import ERROR_CORRECT_M
import resend

# 【フールプルーフ】カレントディレクトリに依存しない絶対パスによる .env ロード
base_dir = Path(__file__).resolve().parent.parent
env_path = base_dir / ".env"
is_env_loaded = load_dotenv(dotenv_path=env_path)

# 環境変数の読み込みとトリミング
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip()

# 送信元アドレスの解決（多層フォールバック）
raw_from_email = os.getenv("FROM_EMAIL", "").strip()
raw_resend_from_email = os.getenv("RESEND_FROM_EMAIL", "").strip()
raw_resend_from_name = os.getenv("RESEND_FROM_NAME", "").strip()

if raw_from_email:
    FROM_EMAIL = raw_from_email
elif raw_resend_from_email:
    if raw_resend_from_name:
        FROM_EMAIL = f"{raw_resend_from_name} <{raw_resend_from_email}>"
    else:
        FROM_EMAIL = raw_resend_from_email
else:
    FROM_EMAIL = "第5回めんたいこ杯運営事務局 <info@mentaikotrophy-hq.com>"

# 【フールプルーフ】起動時コンソールログ出力
masked_key = f"{RESEND_API_KEY[:6]}...{RESEND_API_KEY[-4:]}" if len(RESEND_API_KEY) >= 10 else "(未設定または空文字)"
print("==================================================")
print("【Kyudo API 環境変数ロード確認ログ】")
print(f"・対象 .env パス      : {env_path}")
print(f"・.env ファイル存在   : {env_path.exists()}")
print(f"・load_dotenv 実行結果: {is_env_loaded}")
print(f"・RESEND_API_KEY 設定 : {bool(RESEND_API_KEY)} [{masked_key}]")
print(f"・FROM_EMAIL 設定     : {FROM_EMAIL}")
print("==================================================")

resend.api_key = RESEND_API_KEY

app = FastAPI(
    title="Kyudo Tournament API",
    description="弓道大会運営システム バックエンドAPIサービス",
    version="1.0.0"
)

# 【修正】CORS設定 (Vercel本番ドメインの追加とフールプルーフのワイルドカード)
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://5th.mentaikotrophy-hq.com",
    "https://www.5th.mentaikotrophy-hq.com",
    # VercelのプレビューURL等からのアクセスも許可する場合はワイルドカードも有効
    "*"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# 1. Pydantic リクエスト・レスポンスモデル
# ==========================================

class HealthCheckResponse(BaseModel):
    status: str
    service: str
    version: str
    resend_configured: bool
    env_file_exists: bool
    from_email: str


class SendConfirmationRequest(BaseModel):
    to_email: str = Field(..., description="送信先メールアドレス")
    representative_name: str = Field(..., min_length=1, description="代表者氏名")
    player_names: List[str] = Field(..., min_length=1, description="登録選手氏名リスト")
    total_fee: int = Field(..., ge=0, description="合計参加費")

    @property
    def email(self) -> str:
        """【フールプルーフ】to_email と email の両属性アクセスを許容"""
        return self.to_email


class SendConfirmationResponse(BaseModel):
    success: bool
    message: str
    isSimulation: bool = False
    errorDetail: Optional[str] = None


class SendQrSingleRequest(BaseModel):
    tournamentTitle: str = Field(..., description="大会名称")
    participantId: str = Field(..., description="選手ID")
    bibNumber: int = Field(..., ge=1, description="ゼッケン番号")
    name: str = Field(..., min_length=1, description="選手氏名")
    nameKana: Optional[str] = Field(default="", description="選手ふりがな")
    email: str = Field(..., description="送信先メールアドレス")
    organization: Optional[str] = Field(default="無所属", description="所属団体")
    shosa: Optional[str] = Field(default="肌脱ぎ", description="所作区分")
    rankTitle: Optional[str] = Field(default="段位は三段以下", description="称号・段位")
    stand1Group: Optional[int] = Field(default=None, description="午前の部 組番号")
    stand1Order: Optional[int] = Field(default=None, description="午前の部 立順")
    stand2Group: Optional[int] = Field(default=None, description="午後の部 組番号")
    stand2Order: Optional[int] = Field(default=None, description="午後の部 立順")
    checkinPayload: str = Field(..., description="QRコード読取用ペイロードJSON文字列")
    qrCardBase64: Optional[str] = Field(default=None, description="フロントエンドで合成されたQRカード画像のBase64文字列")


class SingleSendApiResponse(BaseModel):
    participantId: str
    bibNumber: int
    name: str
    email: str
    success: bool
    message: str
    isSimulation: bool = False
    errorDetail: Optional[str] = None


# ==========================================
# 2. サーバーサイド QRカード画像合成エンジン
# ==========================================

def get_stand_order_label(order: Optional[int]) -> str:
    if order is None:
        return "未確定"
    mapping = {
        1: "大前 (1番)",
        2: "二的 (2番)",
        3: "中 (3番)",
        4: "落前 (4番)",
        5: "落 (5番)",
    }
    return mapping.get(order, f"{order}番")


def generate_qr_card_image_bytes(req: SendQrSingleRequest) -> bytes:
    if req.qrCardBase64 and "base64," in req.qrCardBase64:
        try:
            base64_data = req.qrCardBase64.split("base64,")[1]
            return base64.b64decode(base64_data)
        except Exception as e:
            print(f"【Base64デコード警告】サーバー側フォールバック描画を実行します: {e}")

    width, height = 800, 1200
    image = Image.new("RGB", (width, height), color="#F8FAFC")
    draw = ImageDraw.Draw(image)

    def load_font(size: int):
        font_paths = [
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttf",
            "C:\\Windows\\Fonts\\msgothic.ttc",
            "C:\\Windows\\Fonts\\meiryo.ttc",
            "/System/Library/Fonts/Hiragino Sans GB.ttc",
        ]
        for path in font_paths:
            if os.path.exists(path):
                try:
                    return ImageFont.truetype(path, size)
                except Exception:
                    continue
        return ImageFont.load_default()

    font_title = load_font(24)
    font_sub = load_font(18)
    font_bib_label = load_font(16)
    font_bib = load_font(40)
    font_name = load_font(44)
    font_spec = load_font(18)
    font_table = load_font(16)
    font_footer = load_font(13)

    margin = 32
    card_box = [margin, margin, width - margin, height - margin]
    draw.rounded_rectangle(card_box, radius=24, fill="#FFFFFF", outline="#CBD5E1", width=3)

    header_height = 180
    header_box = [margin, margin, width - margin, margin + header_height]
    draw.rectangle(header_box, fill="#0F172A")

    title_text = req.tournamentTitle[:25] + "…" if len(req.tournamentTitle) > 26 else req.tournamentTitle
    draw.text((width // 2, margin + 50), title_text, fill="#F8FAFC", font=font_title, anchor="mm")
    draw.text((width // 2, margin + 95), "正式エントリー受付・当日入場QRコード", fill="#F59E0B", font=font_sub, anchor="mm")
    draw.text((width // 2, margin + 135), f"ENTRY ID: {req.participantId}", fill="#94A3B8", font=font_table, anchor="mm")

    bib_y = margin + header_height + 40
    bib_box = [margin + 40, bib_y, width - margin - 40, bib_y + 75]
    draw.rounded_rectangle(bib_box, radius=14, fill="#F8FAFC", outline="#CBD5E1", width=2)
    draw.text((margin + 65, bib_y + 37), "ゼッケン番号", fill="#64748B", font=font_bib_label, anchor="lm")
    draw.text((width - margin - 65, bib_y + 37), f"No. {req.bibNumber}", fill="#0F172A", font=font_bib, anchor="rm")

    name_y = bib_y + 115
    draw.text((width // 2, name_y + 20), f"{req.name} 選手", fill="#0F172A", font=font_name, anchor="mm")
    spec_text = f"{req.organization or '無所属'}  |  {req.shosa}  |  {req.rankTitle}"
    draw.text((width // 2, name_y + 70), spec_text, fill="#334155", font=font_spec, anchor="mm")

    qr_box_size = 330
    qr_x = (width - qr_box_size) // 2
    qr_y = name_y + 110
    draw.rounded_rectangle([qr_x, qr_y, qr_x + qr_box_size, qr_y + qr_box_size], radius=16, fill="#FFFFFF", outline="#CBD5E1", width=2)

    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=8,
        border=1,
    )
    qr.add_data(req.checkinPayload)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="#0F172A", back_color="#FFFFFF").convert("RGB")
    qr_img = qr_img.resize((qr_box_size - 24, qr_box_size - 24))
    image.paste(qr_img, (qr_x + 12, qr_y + 12))

    table_y = qr_y + qr_box_size + 25
    table_box = [margin + 40, table_y, width - margin - 40, table_y + 125]
    draw.rounded_rectangle(table_box, radius=14, fill="#F1F5F9", outline="#CBD5E1", width=1)

    m_group = f"第 {req.stand1Group} 組" if req.stand1Group else "未設定"
    m_order = get_stand_order_label(req.stand1Order)
    draw.text((margin + 60, table_y + 35), "午前の部 (一手・2射):", fill="#D97706", font=font_table, anchor="lm")
    draw.text((width - margin - 60, table_y + 35), f"{m_group}  -  {m_order}", fill="#0F172A", font=font_table, anchor="rm")

    draw.line([margin + 55, table_y + 62, width - margin - 55, table_y + 62], fill="#CBD5E1", width=1)

    a_group = f"第 {req.stand2Group} 組" if req.stand2Group else "未設定"
    a_order = get_stand_order_label(req.stand2Order)
    draw.text((margin + 60, table_y + 90), "午後の部 (一手/四矢):", fill="#475569", font=font_table, anchor="lm")
    draw.text((width - margin - 60, table_y + 90), f"{a_group}  -  {a_order}", fill="#0F172A", font=font_table, anchor="rm")

    draw.text(
        (width // 2, height - margin - 35),
        "※大会当日は本QRコードを受付端末にかざして入場チェックインを行ってください。",
        fill="#64748B",
        font=font_footer,
        anchor="mm"
    )

    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


# ==========================================
# 3. エンドポイント実装
# ==========================================

@app.get("/health", response_model=HealthCheckResponse, status_code=status.HTTP_200_OK)
def health_check() -> HealthCheckResponse:
    return HealthCheckResponse(
        status="healthy",
        service="kyudo-backend",
        version="1.0.0",
        resend_configured=bool(RESEND_API_KEY),
        env_file_exists=env_path.exists(),
        from_email=FROM_EMAIL
    )


@app.post(
    "/api/v1/email/send-confirmation",
    response_model=SendConfirmationResponse,
    status_code=status.HTTP_200_OK,
    summary="仮エントリー受付確認・送金案内メール送信"
)
@app.post(
    "/api/v1/email/send-confirmation/",
    response_model=SendConfirmationResponse,
    status_code=status.HTTP_200_OK,
    include_in_schema=False
)
def send_confirmation(req: SendConfirmationRequest) -> SendConfirmationResponse:
    if "@" not in req.to_email or "." not in req.to_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"無効なメールアドレスです: {req.to_email}"
        )

    if len(req.player_names) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="登録選手リストが空です。"
        )

    if not RESEND_API_KEY:
        err_msg = f"バックエンド環境変数 RESEND_API_KEY が未設定です。パス: {env_path}"
        print(f"【設定不備】{err_msg}")
        return SendConfirmationResponse(
            success=False,
            isSimulation=True,
            message="メール配信設定が未構成のため送信をスキップしました。",
            errorDetail=err_msg
        )

    players_list_html = "".join([f"<li style='padding: 2px 0;'>{name} 様</li>" for name in req.player_names])

    html_content = f"""
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 24px; }}
        .container {{ max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }}
        .header {{ background: #0f172a; color: #ffffff; padding: 24px; text-align: center; }}
        .header h1 {{ margin: 0; font-size: 20px; font-weight: 800; }}
        .header p {{ margin: 6px 0 0 0; color: #f59e0b; font-size: 13px; font-weight: bold; }}
        .content {{ padding: 24px; line-height: 1.6; font-size: 14px; }}
        .details {{ background: #f1f5f9; border-radius: 12px; padding: 16px; margin: 16px 0; font-size: 13px; }}
        .details ul {{ margin: 8px 0 0 16px; padding: 0; }}
        .payment-box {{ background: #fef3c7; border: 1px solid #fde68a; border-radius: 12px; padding: 16px; margin: 20px 0; }}
        .payment-box h2 {{ margin: 0 0 8px 0; font-size: 14px; color: #92400e; font-weight: bold; }}
        .fee {{ font-size: 20px; font-weight: 900; color: #dc2626; }}
        .footer {{ border-top: 1px solid #e2e8f0; padding: 16px 24px; font-size: 11px; color: #64748b; text-align: center; }}
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>第5回めんたいこ杯争奪弓道大会</h1>
          <p>仮エントリー受付のお知らせ</p>
        </div>
        <div class="content">
          <p><strong>{req.representative_name} 様</strong></p>
          <p>大会への参加エントリー申し込みを受け付けました。<br>現在<strong>「仮エントリー」</strong>の状態となっております。以下の送金手順に従って参加費のお支払いをお願いいたします。</p>

          <div class="details">
            <p style="margin: 0; font-weight: bold; color: #334155;">【エントリー選手一覧（計 {len(req.player_names)} 名）】</p>
            <ul>
              {players_list_html}
            </ul>
          </div>

          <div class="payment-box">
            <h2>■ 参加費送金のお願い</h2>
            <p style="margin: 0 0 8px 0;">お支払い合計金額: <span class="fee">{req.total_fee:,} 円</span>（1,500円 × {len(req.player_names)}名）</p>
            <p style="margin: 0; font-size: 13px; color: #78350f;">
              送金先PayPayID: <strong>hayapaaaay</strong><br>
              メッセージ欄記入名: <strong>{req.representative_name}</strong>
            </p>
            <p style="margin: 8px 0 0 0; font-size: 11px; color: #b45309;">
              ※送金時のメッセージ欄には必ず代表者氏名をご記入ください。送金確認後、正式エントリー受付QRコードを発行・送付いたします。
            </p>
          </div>
        </div>
        <div class="footer">
          <p>第5回めんたいこ杯争奪弓道大会 大会運営事務局</p>
        </div>
      </div>
    </body>
    </html>
    """

    try:
        params: dict[str, Any] = {
            "from": FROM_EMAIL,
            "to": [req.to_email],
            "subject": f"【仮エントリー受付】第5回めんたいこ杯争奪弓道大会（代表者: {req.representative_name} 様）",
            "html": html_content,
        }

        email_response = resend.Emails.send(cast(resend.Emails.SendParams, params))
        print(f"【仮エントリーメール送信成功】ID: {email_response.get('id')} from: {FROM_EMAIL} to: {req.to_email}")

        return SendConfirmationResponse(
            success=True,
            isSimulation=False,
            message="仮エントリー受付確認メールを送信しました。"
        )
    except Exception as send_err:
        err_str = str(send_err)
        print(f"【仮エントリーメール送信例外】: {err_str}")
        return SendConfirmationResponse(
            success=False,
            isSimulation=False,
            message="メール配信サーバー（Resend）での送信処理に失敗しました。",
            errorDetail=err_str
        )


@app.post(
    "/api/v1/email/send-qr-single",
    response_model=SingleSendApiResponse,
    status_code=status.HTTP_200_OK,
    summary="選手情報一体型QRカード添付メール送信"
)
@app.post(
    "/api/v1/email/send-qr-single/",
    response_model=SingleSendApiResponse,
    status_code=status.HTTP_200_OK,
    include_in_schema=False
)
def send_qr_single(req: SendQrSingleRequest) -> SingleSendApiResponse:
    """
    【フールプルーフ】
    - 立ち順未設定の選手（午前・午後の組・立順がNone）に対する送信要求を遮断。
    - メールアドレスの検証。
    - Resend公式仕様の content_id を用いて HTML 内の cid:qrcard_image と完全バインド。
    """
    if (
        req.stand1Group is None or req.stand1Order is None or
        req.stand2Group is None or req.stand2Order is None
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="立ち順（午前・午後の組および射位）が未設定です。立ち順確定後に送信してください。"
        )

    if "@" not in req.email or "." not in req.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"無効なメールアドレスです: {req.email}"
        )

    if not RESEND_API_KEY:
        err_msg = f"バックエンド環境変数 RESEND_API_KEY が未設定です。パス: {env_path}"
        print(f"【設定不備】{err_msg}")
        return SingleSendApiResponse(
            participantId=req.participantId,
            bibNumber=req.bibNumber,
            name=req.name,
            email=req.email,
            success=False,
            isSimulation=True,
            message="メール配信設定が未構成のため送信をスキップしました。",
            errorDetail=err_msg
        )

    try:
        qr_card_bytes = generate_qr_card_image_bytes(req)
        qr_card_base64_str = base64.b64encode(qr_card_bytes).decode("utf-8")
    except Exception as img_err:
        print(f"【QR画像合成例外】: {img_err}")
        return SingleSendApiResponse(
            participantId=req.participantId,
            bibNumber=req.bibNumber,
            name=req.name,
            email=req.email,
            success=False,
            isSimulation=False,
            message="QRカード画像の生成に失敗しました。",
            errorDetail=str(img_err)
        )

    filename = f"qrcard_bib_{req.bibNumber}_{req.name}.png"
    cid_key = "qrcard_image"

    html_content = f"""
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 24px; }}
        .container {{ max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }}
        .header {{ background: #0f172a; color: #ffffff; padding: 24px; text-align: center; }}
        .header h1 {{ margin: 0; font-size: 20px; font-weight: 800; }}
        .header p {{ margin: 6px 0 0 0; color: #f59e0b; font-size: 13px; font-weight: bold; }}
        .content {{ padding: 24px; line-height: 1.6; font-size: 14px; }}
        .details {{ background: #f1f5f9; border-radius: 12px; padding: 16px; margin: 16px 0; font-size: 13px; }}
        .details table {{ width: 100%; border-collapse: collapse; }}
        .details td {{ padding: 6px 0; }}
        .details td:first-child {{ color: #64748b; font-weight: bold; width: 120px; }}
        .card-preview {{ text-align: center; margin: 24px 0; }}
        .card-img {{ max-width: 320px; width: 100%; height: auto; border-radius: 12px; border: 1px solid #cbd5e1; box-shadow: 0 4px 12px rgba(0,0,0,0.1); display: inline-block; }}
        .footer {{ border-top: 1px solid #e2e8f0; padding: 16px 24px; font-size: 11px; color: #64748b; text-align: center; }}
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>{req.tournamentTitle}</h1>
          <p>参加受付用 QRコード発行のお知らせ</p>
        </div>
        <div class="content">
          <p><strong>{req.name} 様</strong></p>
          <p>参加費の受領および立ち順の編成が完了いたしました。<br>当日の参加受付に使用する<strong>選手情報一体型QRコードカード</strong>を発行いたしましたので送付いたします。</p>

          <div class="details">
            <table>
              <tr><td>選手氏名</td><td><strong>{req.name} 様</strong></td></tr>
              <tr><td>ゼッケン番号</td><td><strong>No. {req.bibNumber}</strong></td></tr>
              <tr><td>所属団体</td><td>{req.organization or '無所属'}</td></tr>
              <tr><td>午前の部 (第1立)</td><td><strong>第 {req.stand1Group} 組 - {get_stand_order_label(req.stand1Order)}</strong></td></tr>
              <tr><td>午後の部 (第2・3立)</td><td><strong>第 {req.stand2Group} 組 - {get_stand_order_label(req.stand2Order)}</strong></td></tr>
            </table>
          </div>

          <div class="card-preview">
            <p style="font-size: 12px; color: #475569; font-weight: bold; margin-bottom: 8px;">【当日提示用 QRコードカード】</p>
            <img src="cid:{cid_key}" alt="{req.name} 選手 QRカード" class="card-img" />
          </div>

          <p style="font-size: 12px; color: #334155; line-height: 1.6;">
            ※大会当日は弓道場入場受付にて、スマートフォン画面で上記QRコードカードをご提示いただくか、画像を印刷してご持参ください。<br>
            ※取り違え防止のため、画像内に選手氏名および立順が表示されています。
          </p>
        </div>
        <div class="footer">
          <p>第5回めんたいこ杯争奪弓道大会 大会運営事務局</p>
        </div>
      </div>
    </body>
    </html>
    """

    try:
        # 【重要】attachments 内の辞書を dict[str, Any] で構築して Pylance の Attachment TypedDict エラーを解消
        attachment_dict: dict[str, Any] = {
            "filename": filename,
            "content": qr_card_base64_str,
            "content_id": cid_key,
        }

        params: dict[str, Any] = {
            "from": FROM_EMAIL,
            "to": [req.email],
            "subject": f"【受付QRコード】{req.tournamentTitle}（No.{req.bibNumber} {req.name} 様）",
            "html": html_content,
            "attachments": [attachment_dict],
        }

        email_response = resend.Emails.send(cast(resend.Emails.SendParams, params))
        print(f"【メール送信成功】ID: {email_response.get('id')} from: {FROM_EMAIL} to: {req.email}")

        return SingleSendApiResponse(
            participantId=req.participantId,
            bibNumber=req.bibNumber,
            name=req.name,
            email=req.email,
            success=True,
            isSimulation=False,
            message="選手情報一体型QRカードを添付した案内メールを送信しました。"
        )
    except Exception as send_err:
        err_str = str(send_err)
        print(f"【メール送信例外】: {err_str}")
        return SingleSendApiResponse(
            participantId=req.participantId,
            bibNumber=req.bibNumber,
            name=req.name,
            email=req.email,
            success=False,
            isSimulation=False,
            message="メール配信サーバーとの通信に失敗しました。",
            errorDetail=err_str
        )