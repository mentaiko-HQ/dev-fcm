/**
 * 【QRコード / バーコード USBスキャナー入力解析・自動救済デコーダー】
 *
 * 役割:
 * - US配列固定のハードウェアスキャナーが日本語JIS Windowsに入力された際の記号破損を自動修復。
 * - 全角文字（IMEオン時）の半角ASCII正規化。
 * - JSON構文破壊時における多層正規表現（Regex）によるBIB（ゼッケン）・ID・選手氏名の強制救済抽出。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - 役員PCのIME状態（全角/半角）やスキャナーのキーボード言語設定に関わらず、入力を自動判別・正規化。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - 記号が完全に破壊されてJSON.parseがクラッシュした場合でも、
 *   ①正規表現BIB抽出 -> ②正規表現ID抽出 -> ③正規表現氏名抽出 -> ④単一数値照合
 *   の4重フォールバックにより、照合成功率を最大化。
 */

import { Participant } from '@/types';

export interface QrDecodeResult {
  matchedParticipant: Participant | null;
  extractionMethod:
    | 'JSON_ID'
    | 'JSON_BIB'
    | 'REGEX_BIB'
    | 'REGEX_ID'
    | 'REGEX_NAME'
    | 'DIRECT_ID'
    | 'DIRECT_BIB'
    | 'FAILED';
  extractedValue: string | number | null;
  rawInput: string;
  normalizedInput: string;
  debugMessage: string;
}

/**
 * 全角英数・全角記号を半角ASCIIへ変換するサニタイズ関数
 */
export function normalizeFullWidthToAscii(str: string): string {
  return str
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/ /g, ' ')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/｛/g, '{')
    .replace(/｝/g, '}')
    .replace(/：/g, ':')
    .replace(/；/g, ';')
    .replace(/＊/g, '*')
    .replace(/＋/g, '+')
    .replace(/＝/g, '=');
}

/**
 * USキーボードスキャナーがJIS配列Windowsに入力された際の記号化け逆変換関数
 *
 * 入力例:
 * *id*+*,*PLAYER=12**BIB+12,:name*+*joker3*,*org*+*A*,s1*g+1,*s1o*+3,*s2g*+20,*s2o*+3{
 * 復元後:
 * {"id":"PLAYER_12","BIB":12,"name":"joker3","org":"A","s1g":1,"s1o":3,"s2g":20,"s2o":3}
 */
export function decodeUsScannerKeyDisplacement(str: string): string {
  let decoded = str.trim();

  // 末尾の { は US配列の } が JIS配列で解釈されたもの
  if (decoded.endsWith('{')) {
    decoded = decoded.slice(0, -1) + '}';
  }

  // 先頭に { が欠落している場合の補完
  if (
    !decoded.startsWith('{') &&
    (decoded.includes('id') ||
      decoded.includes('BIB') ||
      decoded.includes('bib'))
  ) {
    decoded = '{' + decoded;
  }

  // 記号置換
  decoded = decoded
    // * -> "
    .replace(/\*/g, '"')
    // + -> :
    .replace(/\+/g, ':')
    // Shift抜けの :name -> ,"name
    .replace(/,:name/g, ',"name')
    .replace(/^:name/g, '"name')
    // ID内の PLAYER=12 -> PLAYER_12
    .replace(/PLAYER=/g, 'PLAYER_')
    // キーと値の境界にある連続クォートの補正
    .replace(/""/g, '","')
    .replace(/":,/g, '":')
    .replace(/,:/g, ',"');

  return decoded;
}

/**
 * 多層救済解析エンジン本体
 */
export function decodeAndMatchParticipant(
  rawInput: string,
  participants: Participant[],
): QrDecodeResult {
  const cleanRaw = rawInput.trim();
  if (!cleanRaw) {
    return {
      matchedParticipant: null,
      extractionMethod: 'FAILED',
      extractedValue: null,
      rawInput: '',
      normalizedInput: '',
      debugMessage: '入力データが空です。',
    };
  }

  // 1. 全角→半角変換
  const asciiText = normalizeFullWidthToAscii(cleanRaw);
  // 2. US→JIS記号化け補正
  const decodedText = decodeUsScannerKeyDisplacement(asciiText);

  // 【階層 1: 復元後文字列の JSON パース】
  try {
    const parsed = JSON.parse(decodedText);
    if (parsed.id) {
      const targetId = String(parsed.id).trim();
      const found = participants.find((p) => p.id === targetId);
      if (found) {
        return {
          matchedParticipant: found,
          extractionMethod: 'JSON_ID',
          extractedValue: targetId,
          rawInput: cleanRaw,
          normalizedInput: decodedText,
          debugMessage: `JSON復元成功 (ID: ${targetId})`,
        };
      }
    }
    if (parsed.bib || parsed.BIB) {
      const targetBib = Number(parsed.bib ?? parsed.BIB);
      const found = participants.find((p) => p.bibNumber === targetBib);
      if (found) {
        return {
          matchedParticipant: found,
          extractionMethod: 'JSON_BIB',
          extractedValue: targetBib,
          rawInput: cleanRaw,
          normalizedInput: decodedText,
          debugMessage: `JSON復元成功 (ゼッケン: No.${targetBib})`,
        };
      }
    }
  } catch {
    // JSONパース例外は無視してフェイルセーフ層へ移行
  }

  // 【階層 2: 正規表現による BIB (ゼッケン番号) 強制救済抽出】
  // 例: "**BIB+12,", "*BIB:12", "bib=12", "BIB+12"
  const bibRegex = /(?:bib|BIB)[^0-9]{1,6}(\d+)/i;
  const bibMatch =
    decodedText.match(bibRegex) ||
    asciiText.match(bibRegex) ||
    cleanRaw.match(bibRegex);
  if (bibMatch && bibMatch[1]) {
    const extractedBib = Number(bibMatch[1]);
    const found = participants.find((p) => p.bibNumber === extractedBib);
    if (found) {
      return {
        matchedParticipant: found,
        extractionMethod: 'REGEX_BIB',
        extractedValue: extractedBib,
        rawInput: cleanRaw,
        normalizedInput: decodedText,
        debugMessage: `正規表現によりゼッケン番号 No.${extractedBib} を救済照合`,
      };
    }
  }

  // 【階層 3: 正規表現による id (ドキュメントID) 強制救済抽出】
  // 例: "*id*+*,*PLAYER=12*", "id:PLAYER_12"
  const idRegex = /(?:id|ID)[^a-zA-Z0-9_-]{1,8}([a-zA-Z0-9_=-]+)/i;
  const idMatch =
    decodedText.match(idRegex) ||
    asciiText.match(idRegex) ||
    cleanRaw.match(idRegex);
  if (idMatch && idMatch[1]) {
    let extractedId = idMatch[1].trim();
    // USキーズレの = を _ に復元
    extractedId = extractedId.replace(/=/g, '_').replace(/[*+"]/g, '');
    const found = participants.find((p) => p.id === extractedId);
    if (found) {
      return {
        matchedParticipant: found,
        extractionMethod: 'REGEX_ID',
        extractedValue: extractedId,
        rawInput: cleanRaw,
        normalizedInput: decodedText,
        debugMessage: `正規表現により選手ID [${extractedId}] を救済照合`,
      };
    }
  }

  // 【階層 4: 正規表現による name (選手氏名) 強制救済抽出】
  // 例: ":name*+*joker3*"
  const nameRegex =
    /name[^a-zA-Z0-9\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]{1,6}([^,*+{}"]+)/i;
  const nameMatch =
    decodedText.match(nameRegex) ||
    asciiText.match(nameRegex) ||
    cleanRaw.match(nameRegex);
  if (nameMatch && nameMatch[1]) {
    const extractedName = nameMatch[1].trim().replace(/[*+"]/g, '');
    const found = participants.find((p) => p.name === extractedName);
    if (found) {
      return {
        matchedParticipant: found,
        extractionMethod: 'REGEX_NAME',
        extractedValue: extractedName,
        rawInput: cleanRaw,
        normalizedInput: decodedText,
        debugMessage: `正規表現により選手名 [${extractedName}] を救済照合`,
      };
    }
  }

  // 【階層 5: 単一の数字のみ（バーコードリーダー・テンキー直接入力）】
  const numericVal = Number(asciiText);
  if (!isNaN(numericVal) && numericVal > 0) {
    const found = participants.find((p) => p.bibNumber === numericVal);
    if (found) {
      return {
        matchedParticipant: found,
        extractionMethod: 'DIRECT_BIB',
        extractedValue: numericVal,
        rawInput: cleanRaw,
        normalizedInput: asciiText,
        debugMessage: `ゼッケン番号直接入力 (No.${numericVal})`,
      };
    }
  }

  // 【階層 6: Firestore ID の直接一致】
  const foundById = participants.find((p) => p.id === asciiText);
  if (foundById) {
    return {
      matchedParticipant: foundById,
      extractionMethod: 'DIRECT_ID',
      extractedValue: asciiText,
      rawInput: cleanRaw,
      normalizedInput: asciiText,
      debugMessage: `ドキュメントID直接一致 (${asciiText})`,
    };
  }

  return {
    matchedParticipant: null,
    extractionMethod: 'FAILED',
    extractedValue: null,
    rawInput: cleanRaw,
    normalizedInput: decodedText,
    debugMessage: `照合失敗 (登録選手数: ${participants.length}名中、一致なし)`,
  };
}
