# Security

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/sat0xshi/mer-harness/security/advisories/new). Do not include tokens, cookies, photos, or personal information in public issues.

Only the configured owner can use the API. Google mode verifies ID tokens and uses a 30-day signed, HttpOnly, Secure session cookie; Access mode verifies Access JWTs. Missing configuration fails closed. Development bypass is restricted to development on loopback hosts. Mutations require a matching Origin.

Keep `OWNER_EMAIL` and `SESSION_SECRET` in Wrangler secrets, never in vars or source control. Use a random session secret of at least 32 characters. Rotate `SESSION_SECRET` to invalidate all Google sessions; logout removes the current browser cookie. A copied stateless session remains valid until expiry or secret rotation.

The app never accesses any marketplace site. API responses and photos must not enter the service worker cache. D1 contains private listing data and photos; restrict account access and protect backups.
