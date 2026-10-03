import { effectConfig, type gameSummary, type Item } from "@mer/core";
import type { CSSProperties } from "react";
import type { Settings } from "./api";
import { effectProfile } from "./confetti";
import { t } from "./i18n/ja";
import { yen } from "./ListingFlow";

type Game = ReturnType<typeof gameSummary>;
export function ListingStreak({ streak }: { streak: Game["listingStreak"] }) {
  return (
    <div className="listing-streak">
      <strong>{t("listingStreak", { v0: streak.current })}</strong>
      <small>{t("listingStreakBest", { v0: streak.best })}</small>
      {!streak.listedToday && streak.current > 0 && <p className="sub">{t("listingStreakHint")}</p>}
    </div>
  );
}
export function QuestCard({ quests }: { quests: Game["quests"] }) {
  return (
    <section className="card game-card">
      <h2>{t("dailyQuests")}</h2>
      {quests.map((quest) => (
        <div className="quest-row" key={quest.id}>
          <div className="section-heading">
            <strong>
              {quest.done ? "✓ " : ""}
              {t(quest.label)}
            </strong>
            <small>{t("questReward", { v0: quest.rewardXp })}</small>
          </div>
          <progress max={quest.target} value={quest.progress} aria-label={t(quest.label)} />
          <small>
            {quest.progress} / {quest.target}
          </small>
        </div>
      ))}
    </section>
  );
}
const weeklyFields = [
  ["sales", "weeklySales"],
  ["soldCount", "weeklySoldCount"],
  ["cleared", "weeklyCleared"],
  ["listedCount", "weeklyListedCount"],
  ["priceDrops", "weeklyPriceDrops"],
  ["retakes", "weeklyRetakes"],
  ["bossesDefeated", "weeklyBossesDefeated"],
  ["xp", "weeklyXp"],
] as const;
export function WeeklyCard({
  weekly,
  compact = false,
}: {
  weekly: Game["weekly"];
  compact?: boolean;
}) {
  return (
    <section className="card game-card">
      <h2>{t("weeklyHeading")}</h2>
      <p className="sub">{t("weeklyComparison")}</p>
      <dl className="weekly-grid">
        {weeklyFields
          .filter(([key]) => !compact || ["sales", "listedCount", "cleared", "xp"].includes(key))
          .map(([key, label]) => {
            const value = weekly.current[key],
              delta = value - weekly.previous[key];
            const format = key === "sales" ? yen : (n: number) => n.toLocaleString("ja-JP");
            return (
              <div key={key}>
                <dt>{t(label)}</dt>
                <dd>
                  <strong>{format(value)}</strong>
                  <small>
                    {delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} {format(Math.abs(delta))}
                  </small>
                </dd>
              </div>
            );
          })}
      </dl>
    </section>
  );
}
export interface BossHit {
  itemId: string;
  damage: number;
  key: string;
}
export function BossCards({
  bosses,
  items,
  onEdit,
  settings,
  hit,
}: {
  bosses: Game["bosses"];
  items: Item[];
  onEdit?: (item: Item) => void;
  settings: Settings;
  hit: BossHit | null;
}) {
  const enabled = settings.fx === t("fxNormal") || settings.fx === t("fxVivid");
  return (
    <>
      {bosses
        .filter((boss) => !boss.defeated)
        .map((boss) => {
          const attack = hit?.itemId === boss.itemId && enabled ? hit : null;
          const open = () => {
            const item = items.find((item) => item.id === boss.itemId);
            if (item) onEdit?.(item);
          };
          return (
            <section className="card game-card boss-card" key={boss.itemId}>
              <div className="section-heading">
                <h2>{t("bossHeading")}</h2>
                <span>Lv.{boss.level}</span>
              </div>
              <strong>{boss.name}</strong>
              <p className="sub">{t("bossAge", { v0: boss.daysListed })}</p>
              <div
                key={attack?.key ?? "idle"}
                className={`boss-health ${attack ? "boss-hit" : ""}`}
                style={
                  {
                    "--hit-duration": `${effectConfig.hitDurationMs}ms`,
                    "--shake-distance": `${effectProfile("quest", settings.fx).shakePx}px`,
                  } as CSSProperties
                }
              >
                <progress max={boss.maxHp} value={boss.hp} aria-label={t("bossHp")} />
                <small>
                  {boss.hp} / {boss.maxHp} HP
                </small>
                {attack && (
                  <strong className="damage-pop" aria-live="polite">
                    {t("bossDamage", { v0: attack.damage })}
                  </strong>
                )}
              </div>
              {onEdit && (
                <div className="actions">
                  <button onClick={open}>{t("bossPriceAttack")}</button>
                  <button onClick={open}>{t("bossPhotoAttack")}</button>
                </div>
              )}
            </section>
          );
        })}
    </>
  );
}
