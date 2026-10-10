/**
 * 【Web Audio API 音声フィードバックユーティリティ】
 *
 * 役割:
 * - QRスキャン成功時およびエラー・警告発生時にブラウザ内蔵のシンセサイザー音（オシレーター）を即時鳴動。
 * - 外部音声ファイル（MP3/WAV等）のネットワークフェッチを排除し、完全オフライン・ゼロレイテンシーで発音。
 *
 * フールプルーフ設計（操作ミス・不正入力の入口遮断）:
 * - ブラウザの自動再生ポリシー（User Gesture制約）により再生がブロックされた場合でも、
 *   例外を内部で捕捉して握りつぶし、画面の操作フローやスキャン処理の継続を阻害しない。
 * - 多重呼び出しや連打が発生した場合でも、個別のオシレーターノードを独立生成して衝突を防止。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - AudioContext 非対応ブラウザ、プライベートブラウズモード、端末スピーカー未接続環境下でも
 *   null安全性を確保し、アプリケーション全体がクラッシュせず静かに縮退動作。
 */

let audioContextInstance: AudioContext | null = null;

/**
 * AudioContext インスタンスの安全取得およびサスペンド状態復帰関数
 *
 * 判断基準:
 * 1. サーバーサイドレンダリング（SSR / window未定義）時は即座に null を返却。
 * 2. ブラウザ標準 AudioContext または WebKit 接頭辞付きコンストラクタからシングルトン生成。
 * 3. ユーザー操作前の制限で suspended 状態にある場合は非同期で resume() を試行。
 */
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!audioContextInstance) {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (AudioCtx) {
      audioContextInstance = new AudioCtx();
    }
  }

  if (audioContextInstance && audioContextInstance.state === 'suspended') {
    audioContextInstance.resume().catch((resumeErr) => {
      console.warn('【Audio警告】AudioContextの再開に失敗しました:', resumeErr);
    });
  }

  return audioContextInstance;
}

/**
 * 【受付成功音】高音の軽快な2連ピピッ音
 *
 * 音響設計:
 * - 1音目: 1760Hz (A6) / 正弦波 (sine) / 持続時間 80ms
 * - 2音目: 2637Hz (E7) / 正弦波 (sine) / 持続時間 120ms
 * - 指数関数的減衰（exponentialRampToValueAtTime）によるノイズ低減
 */
export function playSuccessSound(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) {
      return;
    }

    const now = ctx.currentTime;

    // 1音目: 1760Hz
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1760, now);
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.08);

    // 2音目: 2637Hz
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(2637, now + 0.1);
    gain2.gain.setValueAtTime(0.18, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.22);
  } catch (error: unknown) {
    console.warn(
      '【Audioフェイルセーフ】成功音の生成・出力をスキップしました:',
      error,
    );
  }
}

/**
 * 【エラー・重複警告音】低音のブー音
 *
 * 音響設計:
 * - 周波数: 220Hz (A3) / のこぎり波 (sawtooth) / 持続時間 350ms
 * - 鋭い倍音を含む音色で視覚だけでなく聴覚からも操作ミス・重複を即時認識
 */
export function playErrorSound(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) {
      return;
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
  } catch (error: unknown) {
    console.warn(
      '【Audioフェイルセーフ】エラー警告音の生成・出力をスキップしました:',
      error,
    );
  }
}
