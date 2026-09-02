import os
import resend
import logging
from pydantic import BaseModel, EmailStr
from dotenv import load_dotenv

# 【フェイルセーフ】明示的に .env ファイルの環境変数を読み込む
load_dotenv()

logger = logging.getLogger("kyudo-api")

# 環境変数からAPIキーを取得し設定
resend.api_key = os.getenv("RESEND_API_KEY", "")

class EmailPayload(BaseModel):
    to_email: EmailStr
    representative_name: str
    player_names: list[str]
    total_fee: int

def send_entry_confirmation_email(payload: EmailPayload) -> tuple[bool, str]:
    """
    【フェイルセーフ ＆ フールプルーフ】
    Resend APIを使用した大会エントリー完了メール送信サービス。
    APIキーの有効性を確認し、例外発生時には具体的なエラーメッセージを返却する。
    """
    if not resend.api_key or resend.api_key.startswith("re_dummy"):
        error_msg = "Resend APIキーが設定されていないか、無効なプレースホルダー値です。"
        logger.error(f"【メール送信設定エラー】{error_msg}")
        return False, error_msg

    sender_email = "info@mentaikotrophy-hq.com"
    subject = "【第5回めんたいこ杯争奪弓道大会】仮エントリー受付完了のお知らせ"

    players_list_html = "".join([f"<li>{name} 様</li>" for name in payload.player_names])
    
    html_content = f"""
    <div style="font-family: sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
      <h2 style="color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">仮エントリー受付完了</h2>
      <p><strong>{payload.representative_name} 様</strong></p>
      <p>第5回めんたいこ杯争奪弓道大会への参加申し込み（仮エントリー）を受け付けました。</p>
      
      <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 15px 0;">
        <p style="margin: 0 0 10px 0;"><strong>登録選手一覧:</strong></p>
        <ul style="margin: 0; padding-left: 20px;">
          {players_list_html}
        </ul>
        <p style="margin: 15px 0 0 0;"><strong>お支払い合計金額:</strong> <span style="color: #dc2626; font-size: 16px; font-weight: bold;">{payload.total_fee:,} 円</span></p>
      </div>

      <div style="background-color: #fef3c7; padding: 15px; border-radius: 6px; border: 1px solid #fcd34d; margin: 15px 0;">
        <p style="margin: 0; font-weight: bold; color: #92400e;">PayPay事前送金のお願い</p>
        <p style="margin: 5px 0 0 0; font-size: 13px; color: #78350f;">
          代表者様のお名前（{payload.representative_name}）をメッセージ欄に記載の上、PayPay ID (<strong>hayapaaaay</strong>) 宛にご送金ください。送金確認をもって正式受付となります。
        </p>
      </div>

      <p style="font-size: 12px; color: #64748b; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">
        第5回めんたいこ杯争奪弓道大会 運営事務局<br>
        お問い合わせ: info@mentaikotrophy-hq.com
      </p>
    </div>
    """

    params: resend.Emails.SendParams = {
        "from": sender_email,
        "to": [payload.to_email],
        "subject": subject,
        "html": html_content,
    }

    try:
        response = resend.Emails.send(params)
        logger.info(f"【メール送信成功】宛先={payload.to_email}, ID={response.get('id')}")
        return True, ""
    except Exception as e:
        error_msg = str(e)
        logger.error(f"【メール送信失敗】宛先={payload.to_email}, Error={error_msg}", exc_info=True)
        return False, error_msg