import { describe, expect, it } from "vitest";
import { legacyRedirect } from "./entry";

describe("legacy host redirect", () => {
  it("301s old staging host to the new host with path and query", () => {
    const res = legacyRedirect(
      new Request("https://mer-harness-stg.sat0xshi.com/some/path?x=1&y=%E3%81%82"),
    );
    expect(res?.status).toBe(301);
    expect(res?.headers.get("Location")).toBe(
      "https://furima-harness-stg.sat0xshi.com/some/path?x=1&y=%E3%81%82",
    );
  });
  it("301s old production host", () => {
    const res = legacyRedirect(new Request("https://mer-harness.sat0xshi.com/api/state"));
    expect(res?.headers.get("Location")).toBe("https://furima-harness.sat0xshi.com/api/state");
  });
  it("leaves new and local hosts alone", () => {
    expect(legacyRedirect(new Request("https://furima-harness-stg.sat0xshi.com/"))).toBeUndefined();
    expect(legacyRedirect(new Request("http://localhost:8787/"))).toBeUndefined();
  });
});
