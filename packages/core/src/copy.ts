import { type Answers, type Category, questions } from "./listing";

const shippingServices =
  /(?:らくらく|ゆうゆう|エコ)?メルカリ便|(?:らくらく|ゆうゆう)?mercari便|匿名配送[（(](?:ヤマト|日本郵便)[）)]/gi;

export function neutralShipping(value: string) {
  return value.trim().replace(shippingServices, "匿名配送（追跡あり）");
}

export function tidyCopy(text: string) {
  return text
    .replace(/【[\s・、,|｜/／-]*】|\([\s・、,|｜/／-]*\)|（[\s・、,|｜/／-]*）/g, "")
    .split("\n")
    .map((line) =>
      line
        .replace(/^[\s・、,|｜/／-]+|[\s・、,|｜/／-]+$/g, "")
        .replace(/(?:[\t ]*[・、,|｜/／-][\t ]*){2,}/g, " ")
        .replace(/[\t ]+/g, " "),
    )
    .join("\n")
    .trim();
}

export function sanitizeServiceNames(text: string) {
  const sanitized = text
    .replace(shippingServices, "匿名配送（追跡あり）")
    .replace(/メルカリ|mercari/gi, "");
  // Preserve authored bullets and spacing unless a service name was changed.
  return sanitized === text
    ? text
    : sanitized
        .split("\n")
        .map((line) => {
          const bullet = line.trimStart().startsWith("・");
          const clean = tidyCopy(line);
          return bullet && clean ? `・${clean}` : clean;
        })
        .join("\n")
        .trim();
}

const banned = [
  {
    id: "no-returns",
    pattern:
      /ノー[\s・･ー-]*クレーム(?:[\s・･/／-]*ノー[\s・･ー-]*リターン)?|ノー[\s・･ー-]*リターン|返品不可|\bNC\s*[/／・-]?\s*NR\b|\b3N\b|クレーム(?:は)?一切受け付けません/gi,
  },
  {
    id: "restrictive-rules",
    pattern:
      /プロフ必読|即購入禁止|コメント必須|(?:お)?値下げ(?:交渉)?(?:は|を)?(?:一切)?(?:禁止|不可|お断り(?:します|です)?|受け付けません)/g,
  },
  {
    id: "hype",
    pattern:
      /激安|最安値|早い者勝ち|大人気|(?<![\p{Script=Han}a-zA-Z])神(?:アイテム|コスパ|商品|価格)|(?<![\p{L}\p{N}])神(?=です|[^\p{L}\p{N}]|$)|限定価格|今だけ限定/gu,
  },
];

// Descriptions lose the offending sentence; titles keep the useful product words.
export function removeBannedPhrases(text: string, kind: "title" | "description") {
  const removed = new Set<string>();
  const clean = (part: string) => {
    let result = part;
    for (const { id, pattern } of banned) {
      result = result.replace(pattern, () => {
        removed.add(id);
        return "";
      });
    }
    return result;
  };
  const result =
    kind === "title"
      ? clean(text)
      : (text.match(/[^。\n！？!?]+[。\n！？!?]*/g) || [])
          .filter((sentence) => clean(sentence) === sentence)
          .join("");
  return {
    text: removed.size && kind === "title" ? tidyCopy(result) : result.trim(),
    removed: [...removed],
  };
}

// Stored option keys can arrive from imports/API clients; the web stores labels.
const optionLabels: Record<string, string> = {
  resetBothDone: "どちらも完了",
  statusDone: "完了",
  resetBeforeShipping: "発送前に実施予定",
  unknownCondition: "未確認",
  negotiationAllowed: "相談可",
  negotiationDeclined: "値下げ不可",
  shipDaysOneTwo: "1〜2日",
  shipDaysTwoThree: "2〜3日",
  shipDaysFourSeven: "4〜7日",
  networkClear: "○",
  networkPartial: "△",
  networkBlocked: "×",
  networkUnknown: "不明",
  smokePetNone: "喫煙者・ペットなし",
  smokePetSmoking: "喫煙者あり",
  smokePetPets: "ペットあり",
  smokePetUnknown: "不明",
};

export function copyAnswer(value: string) {
  const trimmed = value.trim();
  return Object.hasOwn(optionLabels, trimmed) ? optionLabels[trimmed] : trimmed;
}

const boosterPriority: Record<Category, string[]> = {
  phone: [
    "sim",
    "battery",
    "network",
    "shipDays",
    "purchase",
    "reset",
    "accessories",
    "reason",
    "smokePet",
  ],
  gadget: [
    "operation",
    "accessories",
    "shipDays",
    "edition",
    "reset",
    "usage",
    "reason",
    "smokePet",
  ],
  clothing: [
    "size",
    "measurements",
    "material",
    "shipDays",
    "usage",
    "storage",
    "reason",
    "smokePet",
  ],
  other: ["size", "operation", "accessories", "shipDays", "reason", "smokePet"],
};

export function copyBoosters(category: Category, answers: Answers) {
  return boosterPriority[category]
    .filter((key) => !answers[key]?.trim())
    .slice(0, 4)
    .flatMap((key) => {
      const question = questions[category].find((question) => question.key === key);
      return question ? [{ key, label: question.label }] : [];
    });
}
