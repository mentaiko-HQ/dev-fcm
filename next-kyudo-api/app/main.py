from fastapi import FastAPI, HTTPException, status, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
import logging
import typing
import csv
import io

# 構造化ログ設定（フェイルセーフ: システムエラー時の追跡ログ）
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(filename)s:%(lineno)d - %(message)s"
)
logger = logging.getLogger("kyudo-api")

app = FastAPI(
    title="第5回めんたいこ杯争奪弓道大会 API",
    description="個人戦専用（1立目:一手, 2立目:一手, 3立目:四ツ矢 / 計8射）のスコア・立順・CSV解析API",
    version="4.0.0"
)

# CORS設定
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
            "message": "システム内部で予期せぬエラーが発生しました。"
        }
    )

# フールプルーフ: 所作・役員役割の許容値定義（「運営」を含む7種類）
VALID_SHOSA = ["肌脱ぎ", "襷掛け"]
VALID_ROLES = ["進行", "的前", "招集", "記録", "カメラマン", "運営", "無し"]

class ParticipantModel(BaseModel):
    bibNumber: int = Field(..., ge=1, le=9999, description="ゼッケン番号（1以上の整数）")
    name: str = Field(..., min_length=1, description="名前")
    nameKana: str = Field(..., min_length=1, description="よみがな")
    organization: str = Field(default="", description="所属団体名")
    shosa: str = Field(default="肌脱ぎ", description="所作（肌脱ぎ / 襷掛け）")
    staffRole: str = Field(default="無し", description="大会役員役割（進行, 的前, 招集, 記録, カメラマン, 運営, 無し）")
    standGroup: int = Field(..., ge=1, le=99, description="立ちグループ（二桁の数字: 01〜99）")
    standOrder: int = Field(..., ge=1, le=5, description="立順（1から5までの数字）")
    qualificationStatus: str = Field(default="ACTIVE", description="ACTIVE, ABSENT, WITHDRAWN, DISQUALIFIED")

    @field_validator("shosa")
    @classmethod
    def validate_shosa(cls, value: str) -> str:
        if value not in VALID_SHOSA:
            raise ValueError(f"無効な所作です: {value}。許容値: {VALID_SHOSA}")
        return value

    @field_validator("staffRole")
    @classmethod
    def validate_staff_role(cls, value: str) -> str:
        if value not in VALID_ROLES:
            raise ValueError(f"無効な役員役割です: {value}。許容値: {VALID_ROLES}")
        return value

class StandValidationRequest(BaseModel):
    stand_index: int = Field(..., ge=1, le=3, description="立の番号（1: 一手, 2: 一手, 3: 四ツ矢）")
    scores: typing.List[int] = Field(..., description="的中配列 (1: 〇, 0: ✕)")

    @field_validator("scores")
    @classmethod
    def validate_scores_values(cls, scores: typing.List[int]) -> typing.List[int]:
        for s in scores:
            if s not in [0, 1]:
                raise ValueError("スコア値は 0（✕）または 1（〇）のみ有効です。")
        return scores

@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check() -> typing.Dict[str, str]:
    return {
        "status": "healthy",
        "tournament": "第5回めんたいこ杯争奪弓道大会",
        "format": "個人戦専用 (第1立:一手2射, 第2立:一手2射, 第3立:四ツ矢4射 / 全8射)"
    }

@app.post("/api/v1/import/parse-csv", status_code=status.HTTP_200_OK)
async def parse_csv_file(file: UploadFile = File(...)) -> typing.Dict[str, typing.Any]:
    """
    CSVファイルを解析し、新スキーマ（ゼッケン, 名前, よみがな, 所属, 所作, 役員, 立グループ, 立順）のバリデーションを実行（フールプルーフ）
    """
    try:
        content = await file.read()
        text = ""
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            try:
                text = content.decode("cp932")
            except UnicodeDecodeError:
                text = content.decode("utf-8", errors="replace")

        reader = csv.DictReader(io.StringIO(text))
        rows: typing.List[typing.Dict[str, typing.Any]] = []
        errors: typing.List[typing.Dict[str, typing.Any]] = []

        for idx, row in enumerate(reader, start=1):
            try:
                bib_raw = row.get("ゼッケン番号") or row.get("ゼッケン") or row.get("bibNumber") or ""
                name = row.get("名前") or row.get("氏名") or row.get("name") or ""
                kana = row.get("よみがな") or row.get("フリガナ") or row.get("nameKana") or ""
                org = row.get("所属団体名") or row.get("所属") or row.get("organization") or ""
                shosa = row.get("所作") or row.get("shosa") or "肌脱ぎ"
                role = row.get("大会役員役割") or row.get("役員") or row.get("staffRole") or "無し"
                group_raw = row.get("立ちグループ") or row.get("立グループ") or row.get("standGroup") or ""
                order_raw = row.get("立順") or row.get("射順") or row.get("standOrder") or ""

                if not bib_raw or not name:
                    raise ValueError("ゼッケン番号または名前が空欄です。")

                validated = ParticipantModel(
                    bibNumber=int(bib_raw.strip()),
                    name=name.strip(),
                    nameKana=kana.strip() or name.strip(),
                    organization=org.strip(),
                    shosa=shosa.strip() if shosa.strip() in VALID_SHOSA else "肌脱ぎ",
                    staffRole=role.strip() if role.strip() in VALID_ROLES else "無し",
                    standGroup=int(group_raw.strip()) if group_raw.strip() else 1,
                    standOrder=int(order_raw.strip()) if order_raw.strip() else 1,
                    qualificationStatus="ACTIVE"
                )
                rows.append(validated.model_dump())
            except Exception as row_err:
                errors.append({
                    "line": idx,
                    "rawData": row,
                    "error": str(row_err)
                })

        logger.info(f"CSV解析完了: 成功 {len(rows)} 件, エラー {len(errors)} 件")

        return {
            "success": True,
            "totalParsed": len(rows),
            "errorCount": len(errors),
            "rows": rows,
            "errors": errors
        }
    except Exception as e:
        logger.error(f"【エラーログ】CSV解析失敗: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"CSVファイルの読み込みに失敗しました: {str(e)}"
        )

@app.post("/api/v1/rules/verify-stand", status_code=status.HTTP_200_OK)
async def verify_stand_score(payload: StandValidationRequest) -> typing.Dict[str, typing.Any]:
    """
    立ごとの規定射数（第1立:2, 第2立:2, 第3立:4）に適合しているか検証（フールプルーフ）
    """
    expected_limit = 4 if payload.stand_index == 3 else 2
    actual_length = len(payload.scores)

    if actual_length > expected_limit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"第{payload.stand_index}立の規定射数は {expected_limit} 射ですが、{actual_length} 射送信されました。"
        )

    return {
        "success": True,
        "stand_index": payload.stand_index,
        "expected_limit": expected_limit,
        "actual_shots": actual_length,
        "hits": sum(payload.scores),
        "is_completed": actual_length == expected_limit
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)