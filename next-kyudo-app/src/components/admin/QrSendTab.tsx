/**
 * 【立順設定・選手個別QRコード送信管理コンポーネント】
 * 
 * 役割:
 * - 登録選手一覧をゼッケン番号順・立順で表示。
 * - 各選手へ個別に参加受付用QRコードと最新立順案内メールを送信。
 * - 送信前確認モーダルによる誤送信の抑止。
 * - 送信ステータス（未送信/送信済/失敗）および送信ログの可視化。
 * 
 * フールプルーフ設計:
 * - 404/通信エラー検知時にバックエンドの起動状態（ポート8000およびSwagger docs）を明示。
 * - メールアドレス未設定の選手は送信ボタンを非活性化。
 * - 送信処理中（sendingParticipantId）の二重送信防止。
 * 
 * フェイルセーフ設計:
 * - fetch タイムアウト（15秒）を設定し、通信不通時の無制限待機を防止。
 * - Firestore `entries/{id}` に `qrSentStatus`, `qrSentAt`, `qrSentError` を同期。
 */

"use client";

import React, { useState, useMemo } from "react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { Participant } from "@/types/participant";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Mail,
  QrCode,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Search,
  RotateCw,
  AlertCircle
} from "lucide-react";

interface QrSendTabProps {
  participants: Participant[];
  onRefresh?: () => void;
}

interface SingleSendApiResponse {
  participantId: string;
  bibNumber: number;
  name: string;
  email: string;
  success: boolean;
  message: string;
  errorDetail?: string | null;
}

export function QrSendTab({ participants, onRefresh }: QrSendTabProps) {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "UNSENT" | "SENT" | "FAILED">("ALL");
  const [sendingParticipantId, setSendingParticipantId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<Participant | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  const resolveEmail = (p: Participant): string => {
    return p.representativeEmail ? p.representativeEmail.trim() : "";
  };

  const filteredParticipants = useMemo(() => {
    return participants.filter((p) => {
      const email = resolveEmail(p);
      const matchesSearch =
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(p.bibNumber).includes(searchQuery) ||
        p.organization.toLowerCase().includes(searchQuery.toLowerCase()) ||
        email.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      const currentStatus = p.qrSentStatus || "UNSENT";
      if (statusFilter === "ALL") return true;
      return currentStatus === statusFilter;
    });
  }, [participants, searchQuery, statusFilter]);

  const handleExecuteSend = async () => {
    if (!confirmTarget) return;

    const target = confirmTarget;
    const email = resolveEmail(target);

    if (!email) {
      setErrorMessage("送信先メールアドレスが設定されていません。");
      setConfirmTarget(null);
      return;
    }

    setSendingParticipantId(target.id);
    setErrorMessage("");
    setSuccessMessage("");

    const a1 = target.standAssignments?.[1] || { standGroup: 1, standOrder: 1 };
    const a2 = target.standAssignments?.[2] || { standGroup: 1, standOrder: 1 };

    // フェイルセーフ: 15秒タイムアウトAbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch("http://127.0.0.1:8000/api/v1/email/send-qr-single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tournamentTitle: "第5回めんたいこ杯争奪弓道大会",
          participantId: target.id,
          bibNumber: target.bibNumber,
          name: target.name,
          email: email,
          organization: target.organization || "無所属",
          stand1Group: a1.standGroup,
          stand1Order: a1.standOrder,
          stand2Group: a2.standGroup,
          stand2Order: a2.standOrder,
          checkinPayload: `https://kyudo-tournament.app/checkin?pid=${target.id}&bib=${target.bibNumber}`,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            "APIエラー (404 Not Found): バックエンドに /api/v1/email/send-qr-single が存在しません。FastAPIサーバーが最新コードで再起動されているか確認してください。"
          );
        }
        throw new Error(`API通信エラー: HTTP ${response.status} ${response.statusText}`);
      }

      const result: SingleSendApiResponse = await response.json();

      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const firestoreInstance = db;
        if (firestoreInstance) {
          const participantRef = doc(firestoreInstance, "entries", target.id);
          if (result.success) {
            await updateDoc(participantRef, {
              qrSentStatus: "SENT",
              qrSentAt: serverTimestamp(),
              qrSentError: null,
            });
            setSuccessMessage(`No.${target.bibNumber} ${target.name} 選手宛にQRコードメールを送信しました。`);
          } else {
            await updateDoc(participantRef, {
              qrSentStatus: "FAILED",
              qrSentError: result.errorDetail || result.message,
            });
            setErrorMessage(`送信失敗 (No.${target.bibNumber} ${target.name}): ${result.errorDetail || result.message}`);
          }
        }
      }

      if (onRefresh) {
        onRefresh();
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      console.error("【個別QRメール送信例外】詳細ログ:", err);

      let detail = "メール送信中に通信例外が発生しました。";
      if (err instanceof Error) {
        detail = err.name === "AbortError" ? "API接続がタイムアウトしました（15秒超過）。" : err.message;
      }
      setErrorMessage(detail);

      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const firestoreInstance = db;
        if (firestoreInstance) {
          const participantRef = doc(firestoreInstance, "entries", target.id);
          await updateDoc(participantRef, {
            qrSentStatus: "FAILED",
            qrSentError: detail,
          });
        }
      }
    } finally {
      setSendingParticipantId(null);
      setConfirmTarget(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* 画面説明・フィルターカード */}
      <Card className="border-slate-200 shadow-2xs bg-white">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-slate-800" />
              <CardTitle className="text-base font-bold text-slate-900">
                選手個別QRコード送信管理
              </CardTitle>
            </div>
            <Badge variant="outline" className="font-mono text-xs text-slate-700">
              対象選手: {participants.length} 名
            </Badge>
          </div>
          <CardDescription className="text-xs text-slate-500">
            立順変更や受付準備の進捗に合わせて、各選手へ個別に参加受付用QRコードと最新立順案内を送信します。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-100">
            <div className="flex items-center gap-2 flex-1 max-w-sm">
              <div className="relative w-full">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="選手名・ゼッケン・所属・メールで検索..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 text-slate-900"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-600">表示絞込:</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "ALL" | "UNSENT" | "SENT" | "FAILED")}
                className="text-xs border border-slate-300 rounded-md px-2.5 py-1.5 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="ALL">全選手を表示</option>
                <option value="UNSENT">未送信のみ</option>
                <option value="SENT">送信済のみ</option>
                <option value="FAILED">送信失敗のみ</option>
              </select>
            </div>
          </div>

          {successMessage && (
            <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-800 font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{successMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-start gap-2 p-2.5 bg-red-50 border border-red-200 rounded-md text-xs text-red-800 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 選手一覧テーブル */}
      <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
              <tr>
                <th className="p-3 w-16 text-center font-mono">ゼッケン</th>
                <th className="p-3">選手氏名 / 所属</th>
                <th className="p-3">第1立 (午前一手)</th>
                <th className="p-3">第2立 (午後一手)</th>
                <th className="p-3">送信先メールアドレス</th>
                <th className="p-3 text-center">送信状態</th>
                <th className="p-3 text-right">個別送信操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredParticipants.length > 0 ? (
                filteredParticipants.map((p) => {
                  const email = resolveEmail(p);
                  const hasEmail = Boolean(email);
                  const a1 = p.standAssignments?.[1] || { standGroup: 1, standOrder: 1 };
                  const a2 = p.standAssignments?.[2] || { standGroup: 1, standOrder: 1 };
                  const qrStatus = p.qrSentStatus || "UNSENT";
                  const isCurrentSending = sendingParticipantId === p.id;
                  const isAnySending = sendingParticipantId !== null;

                  return (
                    <tr
                      key={p.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        !hasEmail ? "bg-slate-50/40 text-slate-400" : ""
                      }`}
                    >
                      <td className="p-3 text-center font-mono font-bold text-slate-900">
                        No.{p.bibNumber}
                      </td>
                      <td className="p-3">
                        <div className="font-bold text-slate-900">{p.name}</div>
                        <div className="text-[10px] text-slate-500">{p.organization || "無所属"}</div>
                      </td>
                      <td className="p-3 font-mono">
                        第{a1.standGroup}立 - <span className="font-bold text-slate-900">{a1.standOrder}番</span>
                      </td>
                      <td className="p-3 font-mono">
                        第{a2.standGroup}立 - <span className="font-bold text-slate-900">{a2.standOrder}番</span>
                      </td>
                      <td className="p-3">
                        {hasEmail ? (
                          <span className="font-mono text-slate-700">{email}</span>
                        ) : (
                          <span className="text-red-500 font-medium text-[11px] flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> 未登録
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        {qrStatus === "SENT" ? (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px] font-bold">
                            <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" /> 送信済
                          </Badge>
                        ) : qrStatus === "FAILED" ? (
                          <Badge className="bg-red-100 text-red-800 border-red-200 text-[10px] font-bold" title={p.qrSentError || ""}>
                            <XCircle className="w-3 h-3 mr-1 text-red-600" /> 失敗
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-slate-500 border-slate-200 text-[10px]">
                            未送信
                          </Badge>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          type="button"
                          size="sm"
                          disabled={!hasEmail || isAnySending}
                          onClick={() => setConfirmTarget(p)}
                          className={`h-7 px-2.5 text-[11px] font-bold transition-all ${
                            qrStatus === "SENT"
                              ? "bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300"
                              : "bg-slate-900 hover:bg-slate-800 text-white"
                          }`}
                        >
                          {isCurrentSending ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin mr-1" />
                              送信中
                            </>
                          ) : qrStatus === "SENT" ? (
                            <>
                              <RotateCw className="w-3.5 h-3.5 mr-1 text-slate-600" />
                              再送信
                            </>
                          ) : (
                            <>
                              <Mail className="w-3 h-3 mr-1" />
                              QR送信
                            </>
                          )}
                        </Button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-xs text-slate-400">
                    該当する選手データが存在しません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 個別送信確認モーダル */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 max-w-md w-full p-5 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-slate-100 rounded-lg text-slate-800">
                <Mail className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {confirmTarget.qrSentStatus === "SENT" ? "受付QRコードの再送信確認" : "受付QRコードの送信確認"}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  以下の選手宛てに、受付用QRコードと最新立順情報を記載した案内メールを送信します。
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between items-center text-slate-700 pb-1 border-b border-slate-200">
                <span>対象選手:</span>
                <span className="font-bold text-slate-900 text-sm">
                  No.{confirmTarget.bibNumber} {confirmTarget.name}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-700 pb-1 border-b border-slate-200">
                <span>所属団体:</span>
                <span className="font-medium text-slate-800">{confirmTarget.organization || "無所属"}</span>
              </div>
              <div className="flex justify-between items-center text-slate-700 pb-1 border-b border-slate-200">
                <span>送信先アドレス:</span>
                <span className="font-mono font-bold text-slate-900">{resolveEmail(confirmTarget)}</span>
              </div>
              <div className="flex justify-between items-center text-slate-700">
                <span>最新立順:</span>
                <span className="font-mono text-[11px] text-slate-800">
                  第1立: 第{confirmTarget.standAssignments?.[1]?.standGroup || 1}立-{confirmTarget.standAssignments?.[1]?.standOrder || 1}番 /
                  第2立: 第{confirmTarget.standAssignments?.[2]?.standGroup || 1}立-{confirmTarget.standAssignments?.[2]?.standOrder || 1}番
                </span>
              </div>
            </div>

            {confirmTarget.qrSentStatus === "SENT" && (
              <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-md text-[11px] text-amber-900 font-medium">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600 mt-0.5" />
                <span>
                  本選手には既にQRコードが送信されています。立順変更に伴う差し替え再送信であることをご確認の上、送信を実行してください。
                </span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={sendingParticipantId !== null}
                onClick={() => setConfirmTarget(null)}
                className="text-xs border-slate-300 text-slate-700"
              >
                キャンセル
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={sendingParticipantId !== null}
                onClick={handleExecuteSend}
                className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-4"
              >
                {sendingParticipantId !== null ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    送信中...
                  </>
                ) : (
                  "メール送信を実行"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}