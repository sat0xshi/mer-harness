import {
  buildListing,
  type Category,
  charCount,
  copyBoosters,
  formatCurrency,
  getPlatform,
  type Item,
  netProceeds,
  prices,
} from "@mer/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { CropEditor } from "./CropEditor";
import { celebrate } from "./celebrate";
import { draftStorage } from "./drafts";
import { flowAutosave, releaseAutosave } from "./flowAutosave";
import { t } from "./i18n/ja";
import { categories, platformQuestions } from "./i18n/models";
import { screenshotJpeg } from "./image";
import { isCustomText, listingText } from "./listingText";
import { unlockAudio } from "./sound";
export const yen = formatCurrency;
export function ListingFlow({
  initial,
  aiEnabled,
  listingAiEnabled,
  onRefresh,
  onExit,
  onListed,
}: {
  initial: Item;
  aiEnabled: boolean;
  listingAiEnabled: boolean;
  onRefresh: () => Promise<void>;
  onExit: () => void;
  onListed: (item: Item) => Promise<void>;
}) {
  const draftKey = `harness:listing-ai:${initial.id}`;
  const [draftSource, setDraftSource] = useState(
    () => draftStorage.getItem(draftKey) || "template",
  );
  const [draftNotice, setDraftNotice] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  const draftInFlight = useRef(false);
  const [queue] = useState(() => flowAutosave(initial));
  const [item, setView] = useState(queue.item),
    [saveError, setSaveError] = useState(queue.error),
    [step, setStep] = useState(0),
    [q, setQ] = useState(0),
    [files, setFiles] = useState<File[]>([]),
    [actionBusy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [compPrice, setCompPrice] = useState(""),
    [compSold, setCompSold] = useState(true),
    [copied, setCopied] = useState<string[]>([]),
    [ai, setAi] = useState<Record<string, unknown> | null>(null);
  const busy = actionBusy || draftBusy;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);
  const setItem = (update: Item | ((item: Item) => Item)) => queue.edit(update);
  useEffect(() => {
    const update = () => {
      setView(queue.item);
      setSaveError(queue.error);
    };
    const unsubscribe = queue.subscribe(update);
    update();
    queue.schedule();
    const flush = () => {
      void queue.flush(false, true).catch(() => {});
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", flush);
      void queue
        .flush(false, true)
        .catch(() => {})
        .finally(() => {
          if (!queue.observed) releaseAutosave(queue);
        });
    };
  }, [queue]);
  const lock = useRef(false),
    photoId = useRef(crypto.randomUUID());
  const platform = getPlatform(item.platform);
  const yen = (n: number) => formatCurrency(n, platform);
  const listing = {
      ...buildListing(item.category, item.answers, item.platform),
      ...listingText(item),
    },
    cards = platformQuestions(item.category, item.platform),
    question = cards[Math.min(q, cards.length - 1)],
    suggestions = prices(item.comps, platform);
  // Derive locally too so chips stay current after edits and before the first draft.
  const boosters = copyBoosters(item.category, item.answers);
  const generateDraft = useCallback(async () => {
    if (draftInFlight.current || lock.current) return;
    draftInFlight.current = true;
    draftStorage.setItem(draftKey, draftSource);
    setDraftBusy(true);
    setDraftNotice("");
    setError("");
    try {
      const saved = await queue.flush();
      const result = await api<{
        source: "ai" | "template";
        suggestion: {
          category: Category;
          brand: string;
          model: string;
          color: string;
          flaws: string;
          title: string;
          description: string;
        };
      }>("/ai/listing", { method: "POST", body: JSON.stringify({ id: saved.id }) });
      queue.edit(
        (current) => {
          const answers = { ...current.answers };
          const hasAnswers = Object.values(answers).some((value) => value.trim());
          if (result.source === "ai") {
            for (const key of ["brand", "model", "color", "flaws"] as const) {
              if (!answers[key]?.trim()) answers[key] = result.suggestion[key];
            }
          }
          return {
            ...current,
            answers,
            category:
              result.source === "ai" && !hasAnswers ? result.suggestion.category : current.category,
            title: result.suggestion.title,
            description: result.suggestion.description,
          };
        },
        { preserveText: true },
      );
      setDraftSource(result.source);
      draftStorage.setItem(draftKey, result.source);
      if (result.source === "template") setDraftNotice(t("aiDraftFallback"));
      setCopied([]);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      draftInFlight.current = false;
      setDraftBusy(false);
    }
  }, [queue, draftKey, draftSource]);
  useEffect(() => {
    if (
      step === 3 &&
      !busy &&
      item.photos.length &&
      !isCustomText(item) &&
      !draftStorage.getItem(draftKey)
    )
      void generateDraft();
  }, [step, busy, item, draftKey, generateDraft]);
  async function action(fn: () => Promise<void>) {
    if (lock.current || draftInFlight.current) return;
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
  async function save(finish = false) {
    const saved = await queue.flush(finish);
    await onRefresh();
    return saved;
  }
  async function next() {
    await action(async () => {
      await save(step === 1);
      setStep(Math.min(3, step + 1));
    });
  }
  async function aiCall(kind: "photo" | "prices", blob: Blob) {
    await action(async () => {
      const r = await api<{ suggestion: Record<string, unknown> }>(`/ai/${kind}`, {
        method: "POST",
        body: blob,
      });
      setAi(r.suggestion);
    });
  }
  async function copy(name: string, value: string) {
    await action(async () => {
      await navigator.clipboard.writeText(value);
      setCopied((c) => [...c, name]);
      celebrate("copy", t("copied"));
    });
  }
  async function savePhotos() {
    await action(async () => {
      const photoFiles = await Promise.all(
        item.photos.map(async (p, i) => {
          const response = await fetch(`/api/photos/${p.id}`);
          if (!response.ok) throw Error(t("photoFetchError"));
          return new File([await response.blob()], `harness-${i + 1}.jpg`, { type: "image/jpeg" });
        }),
      );
      if (navigator.canShare?.({ files: photoFiles })) {
        try {
          await navigator.share({ files: photoFiles, title: listing.title });
          return;
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
        }
      }
      for (const file of photoFiles) {
        const url = URL.createObjectURL(file),
          a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
      celebrate("copy", t("photosSaved"));
    });
  }
  const update = (key: string, value: string) =>
    setItem((item) => ({ ...item, answers: { ...item.answers, [key]: value } }));
  return (
    <div className="flow">
      <div className="section-heading">
        <button
          className="text-button"
          disabled={busy}
          onClick={() =>
            action(async () => {
              await save();
              onExit();
            })
          }
        >
          {t("saveAndReturn")}
        </button>
        <span className="sub">{t("listingPreparation")}</span>
      </div>
      <div className="steps">
        {[t("photoStep"), t("questionStep"), t("priceStep"), t("copyStep")].map((label, i) => (
          <button
            key={label}
            disabled={busy}
            className={step === i ? "active" : ""}
            onClick={() =>
              action(async () => {
                await save();
                setStep(i);
              })
            }
          >
            <span>{i + 1}</span>
            {label}
          </button>
        ))}
      </div>
      {saveError && (
        <div className="error" role="alert">
          {t("autosaveFailed")} {saveError}
          <button
            disabled={busy}
            onClick={() =>
              action(async () => {
                await save();
              })
            }
          >
            {t("retrySave")}
          </button>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError("")}>{t("close")}</button>
        </div>
      )}
      {step === 0 && (
        <>
          <h1>{t("photoHeading")}</h1>
          <p className="sub">
            {t("photoHint")}
            <br />
            {t("photoPrivacy")}
          </p>
          <label>
            {t("category")}
            <select
              value={item.category}
              onChange={(e) => {
                setItem((item) => ({ ...item, category: e.target.value as Category }));
                setQ(0);
              }}
            >
              {Object.entries(categories).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {files.length ? (
            <CropEditor
              key={photoId.current}
              file={files[0]}
              onCancel={() => {
                photoId.current = crypto.randomUUID();
                setFiles(files.slice(1));
              }}
              onSave={async (blob) => {
                await api(`/items/${item.id}/photos/${photoId.current}`, {
                  method: "POST",
                  body: blob,
                });
                photoId.current = crypto.randomUUID();
                const state = await api<{ items: Item[] }>("/state");
                const updated = state.items.find((i) => i.id === item.id);
                if (updated) queue.photos(updated.photos, updated.updated_at);
                setFiles(files.slice(1));
                await onRefresh();
                celebrate("photo", t("photoComplete"));
              }}
            />
          ) : (
            <label className="capture">
              <span className="camera-icon">＋</span>
              <strong>{t("takePhoto")}</strong>
              <span>{t("photoSizeHint")}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                disabled={item.photos.length >= 10}
                onChange={(e) => {
                  const chosen = [...(e.target.files || [])];
                  if (chosen.length + item.photos.length > 10) setError(t("photoLimit"));
                  setFiles(chosen.slice(0, 10 - item.photos.length));
                  e.target.value = "";
                }}
              />
            </label>
          )}
          <div className="photo-grid">
            {item.photos.map((p, i) => (
              <div key={p.id}>
                <img src={`/api/photos/${p.id}`} alt={t("productPhoto", { v0: i + 1 })} />
                <button
                  aria-label={t("deletePhoto", { v0: i + 1 })}
                  onClick={() =>
                    action(async () => {
                      await api(`/items/${item.id}/photos/${p.id}`, { method: "DELETE" });
                      queue.photos(queue.item.photos.filter((x) => x.id !== p.id));
                      await onRefresh();
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <p className="sub">
            {item.photos.length}
            {t("photoCountSuffix")}
          </p>
          {aiEnabled && !listingAiEnabled && item.photos.length > 0 && (
            <button
              className="ai-button"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  const r = await fetch(`/api/photos/${item.photos[0].id}`);
                  if (!r.ok) throw Error(t("photoFetchError"));
                  const result = await api<{ suggestion: Record<string, unknown> }>("/ai/photo", {
                    method: "POST",
                    body: await r.blob(),
                  });
                  setAi(result.suggestion);
                })
              }
            >
              {t("photoAi")}
            </button>
          )}
          <button className="primary wide" disabled={busy || !!files.length} onClick={next}>
            {t("toQuestions")}
          </button>
        </>
      )}
      {step === 1 && (
        <>
          <div className="growing card">
            <div className="section-heading">
              <span className="eyebrow">GROWING LISTING</span>
              <span>
                {listing.answered}/{listing.total}
              </span>
            </div>
            <progress
              value={listing.answered}
              max={listing.total}
              aria-label={t("answerProgress")}
            />
            <h2>{listing.title || t("growingListing")}</h2>
            <div className="preview-lines">
              {cards.map((card) => (
                <p key={card.key} className={item.answers[card.key] ? "answered" : "placeholder"}>
                  {item.answers[card.key]
                    ? `✓ ${item.answers[card.key]}`
                    : t("questionLater", { v0: card.label })}
                </p>
              ))}
            </div>
            <small>
              {t("titleLabel")}
              {Array.from(listing.title).length}/{platform.limits.title}
              {t("descriptionCountPrefix")} {Array.from(listing.description).length}/
              {platform.limits.description}
              {t("characterUnit")}
            </small>
          </div>
          <section className="card question">
            <div className="eyebrow">
              QUESTION {q + 1} / {cards.length}
            </div>
            <h2>{question.label}</h2>
            {question.hint && <p className="sub">{question.hint}</p>}
            {question.options ? (
              <fieldset>
                <legend className="sr-only">{question.label}</legend>
                {question.options.map((option) => (
                  <label
                    className={`option ${item.answers[question.key] === option ? "selected" : ""}`}
                    key={option}
                  >
                    <input
                      type="radio"
                      name={question.key}
                      value={option}
                      checked={item.answers[question.key] === option}
                      onChange={() => update(question.key, option)}
                    />
                    {option}
                  </label>
                ))}
              </fieldset>
            ) : (
              <input
                aria-label={question.label}
                maxLength={500}
                placeholder={t("verifiedOnly")}
                value={item.answers[question.key] || ""}
                onChange={(e) => update(question.key, e.target.value)}
              />
            )}
            <div className="actions">
              <button disabled={q === 0 || busy} onClick={() => setQ(q - 1)}>
                {t("backArrow")}
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    const answered = !!item.answers[question.key]?.trim();
                    await save(q === cards.length - 1);
                    if (answered) celebrate("answer", t("answerCelebration"));
                    if (q < cards.length - 1) setQ(q + 1);
                    else setStep(2);
                  })
                }
              >
                {item.answers[question.key] ? t("answerNext") : t("answerLater")}
              </button>
            </div>
          </section>
          <details className="card">
            <summary>{t("notesHeading")}</summary>
            <textarea
              maxLength={500}
              value={item.answers.notes || ""}
              onChange={(e) => update("notes", e.target.value)}
              aria-label={t("notesLabel")}
            />
          </details>
          <button className="text-button wide" disabled={busy} onClick={next}>
            {t("toPrice")}
          </button>
        </>
      )}
      {step === 2 && (
        <>
          <h1>{t("priceHeading")}</h1>
          <p className="sub">{platform.searchHint}</p>
          <a
            className="external"
            href={platform.soldSearchUrl(listing.title || item.answers.model || "")}
            target="_blank"
            rel="noreferrer"
          >
            {platform.searchLabel}
          </a>
          <section className="card">
            <h2>{t("comparables")}</h2>
            <div className="two">
              <label>
                {t("pricePrefix")}
                {platform.currencyLabel}）
                <input
                  inputMode="numeric"
                  type="number"
                  min="1"
                  max={platform.limits.maxPrice}
                  value={compPrice}
                  onChange={(e) => setCompPrice(e.target.value)}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={compSold}
                  onChange={(e) => setCompSold(e.target.checked)}
                />
                {t("soldOut")}
              </label>
            </div>
            <button
              className="wide"
              disabled={
                !Number(compPrice) ||
                Number(compPrice) > platform.limits.maxPrice ||
                item.comps.length >= 100
              }
              onClick={() => {
                setItem((item) => ({
                  ...item,
                  comps: [...item.comps, { price: Math.round(Number(compPrice)), sold: compSold }],
                }));
                setCompPrice("");
              }}
            >
              {t("addComparable")}
            </button>
            <ul className="comps">
              {item.comps.map((comp, i) => (
                <li key={i}>
                  <span>
                    {yen(comp.price)}{" "}
                    <small>{comp.sold ? t("soldOut") : t("unsoldComparable")}</small>
                  </span>
                  <button
                    aria-label={t("deleteComparable", { v0: i + 1 })}
                    onClick={() =>
                      setItem((item) => ({ ...item, comps: item.comps.filter((_, n) => n !== i) }))
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            {aiEnabled && (
              <label className="ai-button file-button">
                {t("screenshotAi")}
                <input
                  type="file"
                  accept="image/*"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void screenshotJpeg(file)
                        .then((blob) => aiCall("prices", blob))
                        .catch((e) => setError(e.message));
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            {aiEnabled && (
              <textarea
                className="paste"
                aria-label={t("pasteScreenshot")}
                onPaste={(e) => {
                  const file = [...e.clipboardData.items]
                    .find((i) => i.type.startsWith("image/"))
                    ?.getAsFile();
                  if (file) {
                    e.preventDefault();
                    void screenshotJpeg(file)
                      .then((blob) => aiCall("prices", blob))
                      .catch((e) => setError(e.message));
                  }
                }}
                placeholder={t("pasteScreenshotHint")}
              />
            )}
          </section>
          {suggestions ? (
            <>
              <div className="range-band">
                <span>{yen(suggestions.min)}</span>
                <i />
                <span>{yen(suggestions.max)}</span>
              </div>
              <div className="price-ladder">
                {(
                  [
                    [t("priceQuick"), suggestions.low, "−6%"],
                    [t("priceRecommended"), suggestions.recommended, t("median")],
                    [t("priceHigh"), suggestions.high, "＋7%"],
                  ] as const
                ).map(([label, price, caption]) => (
                  <button
                    key={label}
                    className={item.price === price ? "selected" : ""}
                    onClick={() => setItem((item) => ({ ...item, price }))}
                  >
                    <span>
                      {label}
                      <small>{caption}</small>
                    </span>
                    <strong>{yen(price)}</strong>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="sub">{t("comparablesHint")}</p>
          )}
          <section className="card">
            <label>
              {t("listingPricePrefix")}
              {platform.currencyLabel}）
              <input
                type="number"
                inputMode="numeric"
                min={platform.limits.minPrice}
                max={platform.limits.maxPrice}
                value={item.price || ""}
                onChange={(e) => setItem((item) => ({ ...item, price: Number(e.target.value) }))}
              />
            </label>
            <label>
              {t("shippingEstimate")}
              <select
                value=""
                onChange={(e) => setItem((item) => ({ ...item, shipping: Number(e.target.value) }))}
              >
                <option value="" disabled>
                  {t("shippingDisclaimer")}
                </option>
                {platform.shippingTable.map((s) => (
                  <option key={s.name} value={s.cost}>
                    {s.name} · {yen(s.cost)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("shippingTotal", { currency: platform.currencyLabel })}
              <input
                type="number"
                min="0"
                max="100000"
                value={item.shipping}
                onChange={(e) => setItem((item) => ({ ...item, shipping: Number(e.target.value) }))}
              />
            </label>
            <div className="net">
              <span>
                {t("estimatedNet")}
                <small>
                  {t("feePrefix")}
                  {platform.feeRate}
                  {t("shippingPrefix")}
                  {yen(item.shipping)}
                  {t("netSuffix")}
                </small>
              </span>
              <strong>{yen(netProceeds(item.price, platform.feeRate, item.shipping))}</strong>
            </div>
          </section>
          <button
            className="primary wide"
            disabled={busy || item.price < platform.limits.minPrice}
            onClick={next}
          >
            {t("choosePrice")}
          </button>
        </>
      )}
      {step === 3 && (
        <>
          <div className="eyebrow">READY TO GO</div>
          <h1>{t("copyHeading")}</h1>
          <p className="sub">{platform.listingHint}</p>
          <div className="section-heading">
            <small>{t(draftSource === "ai" ? "aiDraftSource" : "templateDraftSource")}</small>
            <button disabled={busy || draftBusy} onClick={() => void generateDraft()}>
              {t("aiDraft")}
            </button>
          </div>
          {boosters.length > 0 && (
            <div className="copy-boosters">
              <small>{t("copyBoosters")}</small>
              {boosters.map(({ key, label }) => (
                <button
                  key={key}
                  disabled={busy}
                  onClick={() => {
                    const index = cards.findIndex((card) => card.key === key);
                    if (index >= 0) {
                      setQ(index);
                      setStep(1);
                    }
                  }}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          )}
          {draftNotice && <p role="status">{draftNotice}</p>}
          {platform.copyFields.map(({ key, label }, i) => {
            const value = key === "price" ? String(item.price) : listing[key];
            return (
              <section className="card copy-row" key={label}>
                <div className="section-heading">
                  <h2>
                    <span className="step-number">{i + 1}</span>
                    {label}
                  </h2>
                  <button disabled={busy} onClick={() => copy(label, value)}>
                    {copied.includes(label) ? t("copyDone") : t("copyStep")}
                  </button>
                </div>
                {key === "price" ? (
                  <pre>{value || t("missingInput")}</pre>
                ) : (
                  <label htmlFor={`listing-${key}`}>
                    <span className="sub">
                      {t("listingCharCount", {
                        count: charCount(value),
                        limit: platform.limits[key],
                      })}
                    </span>
                    {key === "title" ? (
                      <input
                        id={`listing-${key}`}
                        aria-label={label}
                        value={value}
                        maxLength={platform.limits.title}
                        disabled={draftBusy}
                        onChange={(e) => {
                          const title = e.target.value;
                          setItem((item) => ({ ...item, title }));
                          setCopied([]);
                        }}
                      />
                    ) : (
                      <textarea
                        id={`listing-${key}`}
                        aria-label={label}
                        value={value}
                        maxLength={platform.limits.description}
                        rows={12}
                        disabled={draftBusy}
                        onChange={(e) => {
                          const description = e.target.value;
                          setItem((item) => ({ ...item, description }));
                          setCopied([]);
                        }}
                      />
                    )}
                  </label>
                )}
              </section>
            );
          })}
          <section className="card">
            <h2>
              <span className="step-number">4</span>
              {t("photosToDevice")}
            </h2>
            <div className="photo-grid">
              {item.photos.map((p, i) => (
                <a href={`/api/photos/${p.id}`} download={`harness-${i + 1}.jpg`} key={p.id}>
                  <img src={`/api/photos/${p.id}`} alt={t("downloadPhoto", { v0: i + 1 })} />
                </a>
              ))}
            </div>
            <button className="wide" disabled={busy || !item.photos.length} onClick={savePhotos}>
              {t("savePhotos")}
            </button>
            <small>{t("savePhotosHint")}</small>
          </section>
          <button
            className="wide"
            onClick={() => copy("all", platform.formatCopy({ ...listing, price: item.price }))}
          >
            {t("copyAll")}
          </button>
          <a className="external" href={platform.sellUrl} target="_blank" rel="noreferrer">
            {platform.openLabel}
          </a>
          <button
            className="primary wide"
            disabled={
              busy ||
              draftBusy ||
              !listing.title ||
              !item.photos.length ||
              item.price < platform.limits.minPrice
            }
            onClick={() =>
              action(async () => {
                const saved = await save(true);
                await onListed(saved);
              })
            }
          >
            {t("listed")}
          </button>
        </>
      )}
      {ai && (
        <div className="modal-backdrop">
          <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="ai-title">
            <h2 id="ai-title">{t("aiHeading")}</h2>
            <p className="sub">{t("aiReviewHint")}</p>
            {Object.entries(ai).map(([key, value]) => (
              <label key={key} htmlFor={`ai-${key}`}>
                {(
                  {
                    category: t("category"),
                    brand: t("brandLabel"),
                    model: t("modelLabel"),
                    color: t("colorLabel"),
                    flaws: t("flawsLabel"),
                    prices: t("extractedPrices"),
                  } as Record<string, string>
                )[key] || key}
                {key === "category" ? (
                  <select
                    id={`ai-${key}`}
                    value={String(value)}
                    onChange={(e) => setAi({ ...ai, category: e.target.value })}
                  >
                    {Object.entries(categories).map(([k, v]) => (
                      <option value={k} key={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`ai-${key}`}
                    value={Array.isArray(value) ? value.join(", ") : String(value)}
                    onChange={(e) =>
                      setAi({
                        ...ai,
                        [key]:
                          key === "prices"
                            ? e.target.value.split(",").map((v) => Number(v.trim()))
                            : e.target.value,
                      })
                    }
                  />
                )}
              </label>
            ))}
            <div className="actions">
              <button onClick={() => setAi(null)}>{t("declineAi")}</button>
              <button
                className="primary"
                onClick={() => {
                  if (Array.isArray(ai.prices)) {
                    const extracted = ai.prices;
                    setItem((item) => ({
                      ...item,
                      comps: [
                        ...item.comps,
                        ...extracted
                          .filter(
                            (p) =>
                              Number.isInteger(p) &&
                              Number(p) >= platform.limits.minPrice &&
                              Number(p) <= platform.limits.maxPrice,
                          )
                          .map((p) => ({ price: Number(p), sold: true })),
                      ].slice(0, 100),
                    }));
                  } else {
                    const { category, ...answers } = ai;
                    setItem((item) => ({
                      ...item,
                      category: category as Category,
                      answers: {
                        ...item.answers,
                        ...Object.fromEntries(
                          Object.entries(answers).map(([k, v]) => [k, String(v)]),
                        ),
                      },
                    }));
                    setQ(0);
                  }
                  setAi(null);
                }}
              >
                {t("acceptAi")}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
