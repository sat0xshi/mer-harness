import { buildListing, combo, defaultPlatform, type Item, type Status } from "@mer/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatedNumber } from "./AnimatedNumber";
import { LogoutButton } from "./AuthGate";
import { api, defaults, json, type Settings, type State } from "./api";
import { Board } from "./Board";
import { CelebrationHost, celebrate } from "./celebrate";
import {
  activeDraftKey,
  draftStorage,
  isEmptyDraft,
  pickNextDraft,
  rememberDraft,
  resumedDraft,
  startDraft,
} from "./drafts";
import { t } from "./i18n/ja";
import { badges } from "./i18n/models";
import { ListingFlow, yen } from "./ListingFlow";
import {
  applyLocalPrefs,
  browserStorage,
  type LocalPrefs,
  readLocalPrefs,
  writeLocalPrefs,
} from "./localPrefs";
import { playSound, unlockAudio } from "./sound";
import { UserKeyPanel } from "./UserKeyPanel";

type Page = "home" | "board" | "achievements" | "settings";
export default function App() {
  const [state, setState] = useState<State | null>(null),
    [page, setPage] = useState<Page>("home"),
    [editing, setEditing] = useState<Item | null>(null),
    [settings, setSettings] = useState(defaults),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ask, setAsk] = useState(false),
    [undo, setUndo] = useState<{ item: Item; key: string } | null>(null);
  const [localPrefs, setLocalPrefs] = useState(() => readLocalPrefs(browserStorage));
  const effective = applyLocalPrefs(settings, localPrefs);
  function changeLocalPrefs(next: LocalPrefs) {
    const chosen = { ...next, soundAsked: true };
    writeLocalPrefs(browserStorage, chosen);
    setLocalPrefs(chosen);
    setAsk(false);
  }
  const [boardTab, setBoardTab] = useState<Status>("draft");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const lock = useRef(false),
    last = useRef<State | null>(null);
  const refresh = useCallback(async () => {
    const next = await api<State>("/state");
    if (!next.settings) {
      await api("/settings", json(defaults, "PUT"));
      next.settings = defaults;
    }
    if (!last.current) {
      setLocalPrefs(readLocalPrefs(browserStorage, next.settings));
      const resumed = resumedDraft(next.items);
      if (resumed) setEditing(rememberDraft(resumed));
    }
    setState(next);
    if (next.settings) setSettings(next.settings);
    if (last.current) {
      const previous = last.current.game;
      if (next.game.level > previous.level)
        celebrate("levelup", t("celebrateLevel", { v0: next.game.level }));
      for (const badge of next.game.unlocked)
        if (!previous.unlocked.includes(badge))
          celebrate("badge", t("celebrateBadge", { v0: badges.find((b) => b[0] === badge)?.[1] }));
      if (next.game.streak.current > previous.streak.current)
        celebrate(
          "streak",
          t("celebrateStreak", { v0: next.game.streak.current }),
          next.game.streak.current,
        );
      if (next.game.combo.count >= 2 && next.game.combo.count > previous.combo.count)
        celebrate("combo", `×${next.game.combo.multiplier} COMBO`, next.game.combo.count);
    }
    last.current = next;
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.fx = effective.fx;
  }, [settings.theme, effective.fx]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (editing) event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [editing]);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    unlockAudio();
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function preferences(next: Settings) {
    await api("/settings", json(next, "PUT"));
    setSettings(next);
  }
  async function newItem() {
    await run(async () => {
      const latest = await api<State>("/state");
      const item = await startDraft(latest.items, (id) =>
        api<Item>("/items", json({ id, category: "phone" })),
      );
      setEditing(item);
      await refresh();
    });
  }
  async function status(item: Item, to: Status, soldPrice?: number, shipped?: boolean) {
    await run(async () => {
      const result = await api<{ item: Item; key: string }>(
        `/items/${item.id}/status`,
        json({ version: item.version, status: to, soldPrice, shipped }),
      );
      setUndo({ item: result.item, key: result.key });
      if (to === "listed") celebrate("listed", t("celebrateListed"));
      if (to === "trading") celebrate("sold", t("celebrateSold"), soldPrice);
      if (shipped) celebrate("shipped", t("celebrateShipped"));
      await refresh();
    });
  }
  async function listed(item: Item) {
    const result = await api<{ item: Item; key: string }>(
      `/items/${item.id}/status`,
      json({ version: item.version, status: "listed" }),
    );
    setUndo({ item: result.item, key: result.key });
    celebrate("listed", t("celebrateListed"));
    draftStorage.removeItem(activeDraftKey);
    setEditing(null);
    setBoardTab("listed");
    setPage("board");
    await refresh();
  }
  const game = state
    ? { ...state.game, combo: combo(state.events, Math.max(now, Date.now())) }
    : undefined;
  const next =
    state?.items.find((i) => i.status === "to_ship") ||
    pickNextDraft(state?.items || []) ||
    state?.items.find((i) => i.status === "shelf");
  return (
    <>
      <header className="app-header">
        <a
          href="/"
          className="wordmark"
          onClick={(e) => {
            e.preventDefault();
            if (!editing) setPage("home");
          }}
        >
          H<span className="logo-buckle">a</span>rness
          <span className="brand-sub">{t("appName")}</span>
        </a>
        <div className="header-tools">
          <button
            aria-label={t("quietPlace")}
            aria-pressed={settings.quiet}
            onClick={() => run(() => preferences({ ...settings, quiet: !settings.quiet }))}
          >
            {settings.quiet ? t("quietEnabled") : t("quiet")}
          </button>
          <button
            aria-label={t("settings")}
            onClick={() => {
              if (!editing) setPage("settings");
            }}
          >
            ⚙
          </button>
        </div>
      </header>
      <div className="main-viewport">
        <main>
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => run(refresh)}>{t("reload")}</button>
            </div>
          )}
          {!state ? (
            <div className="card empty">
              <h1>{t("loadingCargo")}</h1>
              <p>{t("loadingHint")}</p>
            </div>
          ) : editing ? (
            <ListingFlow
              key={editing.id}
              initial={editing}
              aiEnabled={state.aiEnabled}
              listingAiEnabled={state.listingAiEnabled}
              onRefresh={refresh}
              onExit={() => {
                draftStorage.removeItem(activeDraftKey);
                setEditing(null);
              }}
              onListed={listed}
            />
          ) : (
            <>
              {page === "home" && game && (
                <>
                  <section className="welcome">
                    <div className="eyebrow">HARNESS THE HASSLE.</div>
                    <h1>
                      {t("welcomeFirst")}
                      <br />
                      {t("welcomeSecond")}
                    </h1>
                    <p className="sub">{t("welcomeHint")}</p>
                    <div className="strap-art" aria-hidden="true">
                      <span />
                      <i />
                    </div>
                  </section>
                  <section className="card level-card">
                    <div className="section-heading">
                      <strong className="level">
                        Lv.{game.level}{" "}
                        <small>
                          {game.level >= 30
                            ? t("rankRider")
                            : game.level >= 20
                              ? t("rankMaster")
                              : game.level >= 10
                                ? t("rankArtisan")
                                : game.level >= 5
                                  ? t("rankBelt")
                                  : t("rankApprentice")}
                        </small>
                      </strong>
                      <span className="streak">
                        {game.streak.current}
                        {t("daySuffix")}
                      </span>
                    </div>
                    <progress
                      className="xp"
                      value={game.current}
                      max={game.need}
                      aria-label={t("nextLevelXp")}
                    />
                    <div className="section-heading sub">
                      <span>
                        {game.current} / {game.need} XP
                      </span>
                      <span>
                        {t("untilNext")}
                        {game.need - game.current} XP
                      </span>
                    </div>
                  </section>
                  <section className="sales-card">
                    <span className="eyebrow">{t("salesRecord")}</span>
                    <strong className="sales">
                      <AnimatedNumber value={game.sales} settings={effective} format={yen} />
                    </strong>
                    <span className="sub">{t("salesHint")}</span>
                  </section>
                  <section className="next-section">
                    <div className="section-heading">
                      <h2>{t("todayNext")}</h2>
                      <span className="eyebrow">NEXT STEP</span>
                    </div>
                    <div className="card next-card">
                      <div className="next-icon">↗</div>
                      <div>
                        <h3>
                          {next?.title ||
                            (next && !isEmptyDraft(next) ? t("unnamed") : t("firstPhoto"))}
                        </h3>
                        <p className="sub">
                          {next?.status === "to_ship"
                            ? t("prepareShipping")
                            : next && !isEmptyDraft(next)
                              ? t("questionsRemaining", {
                                  v0:
                                    buildListing(next.category, next.answers, next.platform).total -
                                    buildListing(next.category, next.answers, next.platform)
                                      .answered,
                                })
                              : t("nextHint")}
                        </p>
                      </div>
                      <button
                        className="primary wide"
                        disabled={busy}
                        onClick={() => {
                          if (next?.status === "to_ship") {
                            setBoardTab("to_ship");
                            setPage("board");
                          } else if (next) setEditing(rememberDraft(next));
                          else void newItem();
                        }}
                      >
                        {next && !isEmptyDraft(next) ? t("continueArrow") : t("startListing")}
                      </button>
                    </div>
                  </section>
                  <div className="summary-chips">
                    {(["to_ship", "listed", "shelf"] as const).map((status, i) => (
                      <button
                        key={status}
                        onClick={() => {
                          setBoardTab(status);
                          setPage("board");
                        }}
                      >
                        {[t("statusToShip"), t("statusListed"), t("restingShelf")][i]}{" "}
                        <strong>
                          {state.items.filter((item) => item.status === status).length}
                        </strong>
                      </button>
                    ))}
                  </div>
                  <button
                    className="text-button wide"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api("/rest", json({}));
                        await refresh();
                        celebrate("buckle", t("celebrateRest"));
                      })
                    }
                  >
                    {t("takeRest")}
                  </button>
                </>
              )}
              {page === "board" && (
                <Board
                  items={state.items.filter((item) => !isEmptyDraft(item))}
                  onEdit={(item) => setEditing(rememberDraft(item))}
                  onStatus={status}
                  busy={busy}
                  initialTab={boardTab}
                />
              )}
              {page === "achievements" && game && (
                <>
                  <div className="eyebrow">YOUR GEAR</div>
                  <h1>{t("achievementsHeading")}</h1>
                  <section className="card achievement-hero">
                    <div className="level-ring">Lv.{game.level}</div>
                    <h2>
                      {t("untilNext")}
                      {game.need - game.current} XP
                    </h2>
                    <p>
                      {game.streak.current}
                      {t("bestDayPrefix")}
                      {game.streak.best}
                      {t("dayUnit")}
                    </p>
                    <p>
                      {t("restTickets")}
                      {game.streak.tickets}
                      {t("ticketLimit")}
                    </p>
                    <p>
                      {t("comboPrefix")}
                      {game.combo.multiplier}
                      {t("bestPrefix")}
                      {game.combo.best}
                      {t("comboUnit")}
                    </p>
                  </section>
                  <div className="section-heading">
                    <h2>{t("gear")}</h2>
                    <span>{game.unlocked.length}/10</span>
                  </div>
                  <div className="badge-grid">
                    {badges.map(([key, name, condition]) => (
                      <article
                        className={`card badge ${game.unlocked.includes(key) ? "earned" : ""}`}
                        key={key}
                      >
                        <span className="badge-icon">
                          {game.unlocked.includes(key) ? "✦" : "◇"}
                        </span>
                        <h3>{name}</h3>
                        <p>{condition}</p>
                      </article>
                    ))}
                  </div>
                  <section className="card">
                    <h2>{t("salesMilestones")}</h2>
                    <strong className="sales">
                      <AnimatedNumber value={game.sales} settings={effective} format={yen} />
                    </strong>
                    {[10000, 50000, 100000, 300000, 500000, 1000000].map((n) => (
                      <p key={n}>
                        {game.sales >= n ? "✓" : "○"} {yen(n)}
                      </p>
                    ))}
                  </section>
                </>
              )}
              {page === "settings" && (
                <SettingsPanel
                  settings={settings}
                  localPrefs={localPrefs}
                  onLocalChange={changeLocalPrefs}
                  busy={busy}
                  save={(next) => run(() => preferences(next))}
                />
              )}
            </>
          )}
        </main>
      </div>
      {!editing && (
        <nav className="tab-bar" aria-label={t("mainNavigation")}>
          <button
            aria-label={t("home")}
            className={page === "home" ? "active" : ""}
            onClick={() => setPage("home")}
          >
            <span>⌂</span>
            {t("home")}
          </button>
          <button
            aria-label={t("cargo")}
            className={page === "board" ? "active" : ""}
            onClick={() => setPage("board")}
          >
            <span>▤</span>
            {t("cargo")}
          </button>
          <button
            className="add-button"
            disabled={busy || !state}
            aria-label={t("newListing")}
            onClick={newItem}
          >
            ＋
          </button>
          <button
            aria-label={t("achievements")}
            className={page === "achievements" ? "active" : ""}
            onClick={() => setPage("achievements")}
          >
            <span>♧</span>
            {t("achievements")}
          </button>
        </nav>
      )}
      {undo && !editing && (
        <div className="undo" role="status">
          {t("statusUpdated")}
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api(
                  `/items/${undo.item.id}/status`,
                  json({ version: undo.item.version, status: undo.item.status, undo: undo.key }),
                );
                setUndo(null);
                await refresh();
              })
            }
          >
            {t("undo")}
          </button>
          <button aria-label={t("close")} onClick={() => setUndo(null)}>
            ×
          </button>
        </div>
      )}
      <CelebrationHost settings={effective} onAsk={() => setAsk(true)} />
      {ask && (
        <div className="sound-prompt" role="dialog" aria-labelledby="sound-question">
          <h3 id="sound-question">{t("soundPrompt")}</h3>
          <p className="sub">{t("soundPromptHint")}</p>
          <div className="actions">
            <button
              onClick={() =>
                run(async () => {
                  changeLocalPrefs({ ...localPrefs, sound: false });
                  setAsk(false);
                })
              }
            >
              {t("soundDecline")}
            </button>
            <button
              className="primary"
              onClick={() =>
                run(async () => {
                  const prefs = { ...localPrefs, sound: true, soundAsked: true };
                  changeLocalPrefs(prefs);
                  const next = applyLocalPrefs(settings, prefs);
                  setAsk(false);
                  playSound("pikon", next);
                })
              }
            >
              {t("soundEnable")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
function SettingsPanel({
  settings,
  localPrefs,
  onLocalChange,
  busy,
  save,
}: {
  settings: Settings;
  localPrefs: LocalPrefs;
  onLocalChange: (prefs: LocalPrefs) => void;
  busy: boolean;
  save: (next: Settings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  return (
    <>
      <div className="eyebrow">MAKE IT YOURS</div>
      <h1>{t("settingsHeading")}</h1>
      <section className="card settings">
        <LogoutButton />
        <h2>{t("soundFeedback")}</h2>
        <fieldset>
          <legend>演出の強さ</legend>
          <div className="effects-options">
            {(
              [
                ["none", "なし"],
                ["normal", "ふつう"],
                ["flashy", "派手"],
              ] as const
            ).map(([effects, label]) => (
              <label className="check" key={effects}>
                <input
                  type="radio"
                  name="effects"
                  checked={localPrefs.effects === effects}
                  onChange={() => onLocalChange({ ...localPrefs, effects })}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {(
          [
            ["sound", "サウンド"],
            ["vibration", "バイブ"],
          ] as const
        ).map(([key, label]) => (
          <div className="preference-toggle" key={key}>
            <span id={`pref-${key}`}>{label}</span>
            <button
              className="switch"
              role="switch"
              aria-labelledby={`pref-${key}`}
              aria-checked={localPrefs[key]}
              onClick={() => {
                unlockAudio();
                onLocalChange({ ...localPrefs, [key]: !localPrefs[key] });
              }}
            >
              {localPrefs[key] ? "ON" : "OFF"}
            </button>
          </div>
        ))}
        {(
          [
            ["night", t("nightMute")],
            ["soft", t("softSound")],
          ] as const
        ).map(([key, label]) => (
          <label className="check" key={key}>
            <input
              type="checkbox"
              checked={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
        <label>
          {t("volume")}
          {Math.round(draft.volume * 100)}%
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={draft.volume}
            onChange={(e) => setDraft({ ...draft, volume: Number(e.target.value) })}
          />
        </label>
        <button
          onClick={() => {
            unlockAudio();
            playSound("pikon", { ...draft, sound: true, night: false, quiet: false });
          }}
        >
          {t("testSound")}
        </button>
        <label>
          {t("hapticStrength")}
          <select
            value={draft.hapticScale}
            onChange={(e) => setDraft({ ...draft, hapticScale: Number(e.target.value) })}
          >
            <option value="0.6">{t("weak")}</option>
            <option value="1">{t("standard")}</option>
            <option value="1.4">{t("strong")}</option>
          </select>
        </label>
        <label>
          {t("theme")}
          <select
            value={draft.theme}
            onChange={(e) => setDraft({ ...draft, theme: e.target.value as Settings["theme"] })}
          >
            <option value="system">{t("themeSystem")}</option>
            <option value="light">{t("themeLight")}</option>
            <option value="dark">{t("themeDark")}</option>
          </select>
        </label>
      </section>
      <section className="card">
        <h2>{t("priceCalculation")}</h2>
        <label>
          {t("feeRate")}
          <output>{defaultPlatform.feeRate}%</output>
        </label>
        <p className="sub">
          {t("dayStartPrefix")}
          {draft.zone}
          {t("dayStartSuffix")}
        </p>
      </section>
      <button className="primary wide" disabled={busy} onClick={() => save(draft)}>
        {t("saveSettings")}
      </button>
      <UserKeyPanel />
      <section className="about">
        <h2>{t("appName")}</h2>
        <p>{t("disclaimer")}</p>
        <p>{t("dataStorage")}</p>
        <p>{t("aiOptional")}</p>
        <small>MIT · © 2026 sat0xshi</small>
      </section>
    </>
  );
}
