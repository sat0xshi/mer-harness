import { useRef, useState } from "react";
import { api } from "./api";
import { browserStorage } from "./localPrefs";
import {
  clearUserKey,
  maskKey,
  readUserKey,
  saveUserKey,
  userKeyHeaders,
  validUserKey,
} from "./userKey";

const messages = {
  "invalid-key": "キーが無効です",
  quota: "利用上限に達しています",
  billing: "支払い設定（クレジット）を確認してください",
  network: "通信できませんでした",
  error: "接続できませんでした",
};
export function UserKeyPanel() {
  const [saved, setSaved] = useState(() => readUserKey(browserStorage));
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");
  const [testing, setTesting] = useState(false);
  const inFlight = useRef(false);
  return (
    <section className="card settings">
      <h2>自分のGemini APIキー</h2>
      <p className="sub">キーはこの端末のブラウザにだけ保存されます。サーバーには保存しません。</p>
      {saved ? (
        <>
          <output aria-label="保存済みのAPIキー">{maskKey(saved)}</output>
          <div className="actions">
            <button
              disabled={testing}
              onClick={() => {
                if (clearUserKey(browserStorage)) {
                  setSaved(null);
                  setMessage("");
                } else setMessage("このブラウザでは削除できませんでした");
              }}
            >
              削除
            </button>
            <button
              disabled={testing}
              onClick={async () => {
                if (inFlight.current) return;
                inFlight.current = true;
                setTesting(true);
                setMessage("");
                try {
                  const result = await api<
                    { ok: true } | { ok: false; code: keyof typeof messages }
                  >("/ai/key-test", {
                    method: "POST",
                    headers: userKeyHeaders(browserStorage, "/ai/key-test", "POST"),
                  });
                  setMessage(
                    result.ok ? "接続できました" : messages[result.code] || messages.error,
                  );
                } catch {
                  setMessage(messages.network);
                } finally {
                  inFlight.current = false;
                  setTesting(false);
                }
              }}
            >
              {testing ? "接続中…" : "接続テスト"}
            </button>
          </div>
        </>
      ) : (
        <>
          <label>
            APIキー
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setMessage("");
              }}
            />
          </label>
          <button
            onClick={() => {
              const key = input.trim();
              if (!validUserKey(key)) {
                setMessage("APIキーの形式が正しくありません");
                return;
              }
              if (!saveUserKey(browserStorage, key)) {
                setMessage("このブラウザでは保存できませんでした");
                return;
              }
              setSaved(key);
              setInput("");
              setMessage("");
            }}
          >
            保存
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
