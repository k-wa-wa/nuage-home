import { useState } from "react";

export interface StartScreenProps {
  onStart: () => Promise<void>;
  onSkip: () => void;
}

/**
 * 初回アクセス時・未開始時のスタート画面（新しいページ）。
 * 余計な説明文を省き、洗練された「Start」と「許可をスキップ」のみを中央に配置する。
 */
export function StartScreen({ onStart, onSkip }: StartScreenProps) {
  const [starting, setStarting] = useState(false);

  const handleStartClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (starting) return;
    setStarting(true);
    onStart().catch((err) => {
      console.error("[StartScreen] onStart failed:", err);
      setStarting(false);
    });
  };

  const handleSkipClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSkip();
  };

  return (
    <section className="start-screen" aria-label="スタート画面">
      {/* アンビエントオーラ（有機的な光彩レイヤー） */}
      <div className="start-screen-aurora">
        <div className="start-screen-blob blob-1" />
        <div className="start-screen-blob blob-2" />
        <div className="start-screen-blob blob-3" />
      </div>

      <div className="start-screen-center">
        {/* スタートボタンの周囲を漂うハローリング */}
        <div className="start-screen-btn-wrapper">
          <div className="start-screen-btn-halo" aria-hidden="true" />
          <button
            type="button"
            className="start-screen-btn"
            onClick={handleStartClick}
            disabled={starting}
            id="start-session-button"
          >
            {starting ? (
              <span className="start-screen-btn-content loading">
                <span className="start-screen-spinner" aria-hidden="true" />
                <span>CONNECTING…</span>
              </span>
            ) : (
              <span className="start-screen-btn-content">
                <svg
                  className="start-screen-btn-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M10 8l6 4-6 4V8z" fill="currentColor" stroke="none" />
                </svg>
                <span>START</span>
              </span>
            )}
          </button>
        </div>

        {/* 許可をスキップ */}
        <button
          type="button"
          className="start-screen-skip"
          onClick={handleSkipClick}
          disabled={starting}
          id="skip-permission-button"
        >
          許可をスキップ
        </button>
      </div>
    </section>
  );
}
