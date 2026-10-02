import { formatCurrency, getPlatform, type Item, type Status } from "@mer/core";
import { useRef, useState } from "react";
import { t } from "./i18n/ja";
import { statuses } from "./i18n/models";

export function Board({
  items,
  onEdit,
  onStatus,
  busy,
  initialTab = "draft",
}: {
  items: Item[];
  onEdit: (item: Item) => void;
  onStatus: (item: Item, status: Status, soldPrice?: number, shipped?: boolean) => Promise<void>;
  busy: boolean;
  initialTab?: Status;
}) {
  const [tab, setTab] = useState<Status>(initialTab),
    [menu, setMenu] = useState<Item | null>(null),
    [sale, setSale] = useState<Item | null>(null),
    [price, setPrice] = useState(0),
    hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const next: Record<Status, [string, Status]> = {
    draft: [t("continueListing"), "draft"],
    listed: [t("sold"), "trading"],
    trading: [t("moveToShip"), "to_ship"],
    to_ship: [t("shipped"), "to_ship"],
    done: [t("viewDetails"), "done"],
    shelf: [t("relist"), "shelf"],
  };
  const cancel = () => clearTimeout(hold.current);
  return (
    <>
      <div className="eyebrow">YOUR CARGO</div>
      <h1>{t("cargo")}</h1>
      <p className="sub">{t("boardHint")}</p>
      <div className="stock-tabs" role="tablist" aria-label={t("stockStatus")}>
        {Object.entries(statuses).map(([key, label]) => (
          <button
            role="tab"
            aria-selected={tab === key}
            key={key}
            className={tab === key ? "selected" : ""}
            onClick={() => setTab(key as Status)}
          >
            {label}
            <span>{items.filter((i) => i.status === key).length}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={statuses[tab]}>
        {items
          .filter((i) => i.status === tab)
          .map((item) => (
            <article
              className="card stock-card"
              key={item.id}
              onPointerDown={() => {
                hold.current = setTimeout(() => setMenu(item), 650);
              }}
              onPointerUp={cancel}
              onPointerLeave={cancel}
              onPointerCancel={cancel}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu(item);
              }}
            >
              <div className="stock-top">
                {item.photos[0] ? (
                  <img src={`/api/photos/${item.photos[0].id}`} alt="" />
                ) : (
                  <div className="photo-placeholder">□</div>
                )}
                <div>
                  <h2>{item.title || t("unnamed")}</h2>
                  <strong className="num">
                    {item.price
                      ? formatCurrency(item.price, getPlatform(item.platform))
                      : t("pricePending")}
                  </strong>
                  <p className="sub">
                    {statuses[item.status]}
                    {item.listed_at &&
                      t("listedDays", { v0: Math.floor((Date.now() - item.listed_at) / 86400000) })}
                    {item.shipped_at && t("shippedSuffix")}
                  </p>
                </div>
                <button
                  className="menu-button"
                  aria-label={t("statusMenu", { v0: item.title || t("cargo") })}
                  onClick={() => setMenu(item)}
                >
                  ⋯
                </button>
              </div>
              {item.status === "listed" &&
                item.listed_at &&
                Date.now() - item.listed_at >= 14 * 86400000 && (
                  <p className="shelf-note">{t("shelfSuggestion")}</p>
                )}
              <button
                className="primary wide"
                disabled={busy}
                onClick={() => {
                  if (["draft", "shelf", "done"].includes(item.status)) {
                    onEdit(item);
                    return;
                  }
                  if (item.status === "listed") {
                    setSale(item);
                    setPrice(item.price);
                    return;
                  }
                  void onStatus(
                    item,
                    item.shipped_at ? "done" : next[item.status][1],
                    undefined,
                    item.status === "to_ship" && !item.shipped_at,
                  );
                }}
              >
                {item.status === "to_ship" && item.shipped_at
                  ? t("completed")
                  : next[item.status][0]}
              </button>
            </article>
          ))}
        {!items.some((i) => i.status === tab) && (
          <div className="empty card">
            <div className="empty-buckle">□</div>
            <h2>{t("emptyBoard")}</h2>
            <p className="sub">{t("emptyBoardHint")}</p>
          </div>
        )}
      </div>
      {menu && (
        <div className="modal-backdrop">
          <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="status-title">
            <h2 id="status-title">{t("changeStatus")}</h2>
            <p className="sub">
              {getPlatform(menu.platform).name}
              {t("marketplaceStatusSuffix")}
            </p>
            <div className="status-options">
              {Object.entries(statuses).map(([key, label]) => (
                <button
                  key={key}
                  disabled={busy || menu.status === key}
                  onClick={async () => {
                    if (key === "trading") {
                      setSale(menu);
                      setPrice(menu.price);
                      setMenu(null);
                      return;
                    }
                    await onStatus(menu, key as Status);
                    setMenu(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button className="wide" onClick={() => setMenu(null)}>
              {t("close")}
            </button>
          </section>
        </div>
      )}
      {sale && (
        <div className="modal-backdrop">
          <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="sale-title">
            <h2 id="sale-title">{t("salePrompt")}</h2>
            <label>
              {t("salePricePrefix")}
              {getPlatform(sale.platform).currencyLabel}）
              <input
                type="number"
                min={getPlatform(sale.platform).limits.minPrice}
                max={getPlatform(sale.platform).limits.maxPrice}
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
              />
            </label>
            <p className="sub">{t("salesRecordHint")}</p>
            <div className="actions">
              <button onClick={() => setSale(null)}>{t("back")}</button>
              <button
                className="primary"
                disabled={
                  busy ||
                  price < getPlatform(sale.platform).limits.minPrice ||
                  price > getPlatform(sale.platform).limits.maxPrice
                }
                onClick={async () => {
                  await onStatus(sale, "trading", price);
                  setSale(null);
                }}
              >
                {t("sold")}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
