import { existsSync, readFileSync } from "node:fs";

const workflow = readFileSync(existsSync(".github/workflows/ci.yml") ? ".github/workflows/ci.yml" : "docs/ci/ci.yml", "utf8");
if (
  /wrangler[ \t]+(?:deploy|publish)|pnpm[ \t]+deploy|cloudflare\/wrangler-action|db:migrate:staging/.test(
    workflow,
  )
) {
  throw new Error("CI must validate only; remote deployment/migrations are forbidden.");
}
console.log("CI contains no deployment step.");
