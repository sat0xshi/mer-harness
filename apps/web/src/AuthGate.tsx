import { type ReactNode, useEffect, useRef, useState } from "react";
import { api, json } from "./api";
import { t } from "./i18n/ja";

interface AuthConfig {
  mode: string;
  configured: boolean;
  clientId?: string;
  authenticated: boolean;
}
interface GoogleIdentity {
  initialize: (options: {
    client_id: string;
    callback: (result: { credential: string }) => void;
  }) => void;
  renderButton: (
    element: HTMLElement,
    options: { theme: string; size: string; locale: string },
  ) => void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } };
  }
}
export function AuthGate({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [error, setError] = useState("");
  const button = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const refresh = () => {
      void api<AuthConfig>("/auth/config")
        .then(setConfig)
        .catch((e) => setError(e.message));
    };
    refresh();
    window.addEventListener("auth-expired", refresh);
    return () => window.removeEventListener("auth-expired", refresh);
  }, []);
  useEffect(() => {
    if (!config?.configured || config.authenticated || config.mode !== "google" || !config.clientId)
      return;
    let active = true;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      if (!active || !button.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: config.clientId as string,
        callback: (result) => {
          void api("/auth/google", json({ credential: result.credential }))
            .then(() => setConfig({ ...config, authenticated: true }))
            .catch((e) => setError(e.message));
        },
      });
      window.google.accounts.id.renderButton(button.current, {
        theme: "outline",
        size: "large",
        locale: "ja",
      });
    };
    script.onerror = () => setError(t("googleLoadError"));
    document.head.appendChild(script);
    return () => {
      active = false;
      script.remove();
    };
  }, [config]);
  if (config?.authenticated) return <>{children}</>;
  return (
    <main>
      <section className="card empty">
        <div className="wordmark">Harness</div>
        <h1>{t("login")}</h1>
        <p>{t("loginHint")}</p>
        {error && <p role="alert">{error}</p>}
        {!config ? (
          <p>{t("checkingLogin")}</p>
        ) : !config.configured ? (
          <p>{t("authConfigurationRequired")}</p>
        ) : config.mode === "google" ? (
          <div ref={button} />
        ) : (
          <p>{t("accessLoginRequired")}</p>
        )}
        <button onClick={() => location.reload()}>{t("reload")}</button>
      </section>
    </main>
  );
}
export function LogoutButton() {
  return (
    <button
      onClick={async () => {
        await api("/auth/logout", json({}));
        location.reload();
      }}
    >
      {t("logout")}
    </button>
  );
}
