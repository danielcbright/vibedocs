# Adopting VibeDocs as a static-site engine

This guide is for an **operator** standing up a public docs site backed by
VibeDocs: GitHub Actions builds the site on every push and deploys it to S3
behind CloudFront at your own domain.

You write markdown. VibeDocs renders it to a static site (HTML + Shiki syntax
highlighting + a generated `sitemap.xml`, `robots.txt`, `llms.txt`, and an
installable PWA). A workflow ships the output to AWS.

Two example artefacts back this guide — copy them into your repo and adapt:

- [`examples/release.yml.template`](../examples/release.yml.template) — the GitHub Actions workflow
- [`examples/.vibedocs.config.example.ts`](../examples/.vibedocs.config.example.ts) — a fully-annotated site config

---

## How the pieces fit

```
your repo (markdown + config)
        │  push to main
        ▼
GitHub Actions (release.yml)
  checkout → npm ci → npx vibedocs build → aws s3 sync → cloudfront invalidate
        ▼
S3 bucket  ──(origin)──>  CloudFront  ──(HTTPS at your domain)──>  readers
```

VibeDocs only owns the **build** step. The bucket, distribution, TLS cert, and
DNS record are standard AWS static-hosting plumbing you set up once, outside
VibeDocs.

---

## Prerequisites (one-time AWS setup)

These live entirely in your AWS account and are unrelated to VibeDocs. Set them
up once:

1. **S3 bucket** to hold the built site. Private bucket served via CloudFront
   Origin Access Control is the recommended pattern (don't enable public bucket
   hosting). Name it whatever you like — you'll reference it in the workflow.
2. **CloudFront distribution** with that bucket as its origin. Set the default
   root object to `index.html`. Note the **distribution ID** (looks like
   `E1ABCDEF234567`).
3. **ACM certificate** for your domain, issued in **us-east-1** (CloudFront only
   reads certs from that region), attached to the distribution.
4. **Route 53 (or any DNS) record** — an alias/CNAME pointing your domain at the
   CloudFront distribution.

VibeDocs emits **clean URLs** (`/docs/install/` → `docs/install/index.html`). If
your CDN needs a default-directory-index behaviour to resolve those, configure
it on the distribution (a CloudFront Function rewriting `/foo/` →
`/foo/index.html` is the common approach).

---

## Step 1 — Add VibeDocs as a dependency

VibeDocs is published to npm. Install it as a devDependency:

```bash
npm install --save-dev vibedocs
```

```jsonc
{
  "devDependencies": {
    "vibedocs": "^0.4.0"
  }
}
```

Then commit the updated `package-lock.json` so the workflow's `npm ci` is
reproducible. If you don't keep a lockfile, change the workflow's install step
from `npm ci` to `npm install`.

> **Do not use the old `github:danielcbright/vibedocs` git-dependency form.**
> It predates the npm release and is now actively broken on current npm. A git
> dependency has to build its frontend bundle during install, via the `prepare`
> lifecycle script — and **npm 12 blocks `prepare` for git, file and link
> dependencies by default**. The install "succeeds" with a warning, but you get
> a VibeDocs with no `frontend/dist/`, so `vibedocs serve` has no app to serve
> and `vibedocs build` has no assets to copy. The registry tarball ships
> `frontend/dist/` prebuilt, so the npm install above has no such step and
> nothing to skip.

The `vibedocs` bin becomes available as `npx vibedocs`. Verify locally:

```bash
npx vibedocs --help
```

```
Usage:
  vibedocs build --project <name> --out <dir> [--base-url <url>] [--frontend-dist <path>] [--hydration full|minimal]
  vibedocs build --project <name> --serve [--port <n>] [--frontend-dist <path>] [--hydration full|minimal]
```

---

## Step 2 — Add a site config

Copy [`examples/.vibedocs.config.example.ts`](../examples/.vibedocs.config.example.ts)
to your project root as `.vibedocs.config.ts`. Trim it to the fields you need —
`name`, `domain`, `description`, `theme.tokens`, and `llms` are required; the
rest are optional.

The config is loaded automatically by `vibedocs build` from the project root. A
wrong-typed field fails the build with a message naming the offending path.

---

## Step 3 — Drop in the workflow

Copy [`examples/release.yml.template`](../examples/release.yml.template) into
your repo as `.github/workflows/release.yml`, then replace every
`{{REPLACE_ME}}` marker. The values to fill in:

| Variable | What it is |
|---|---|
| `VIBEDOCS_PROJECT` | The project name `vibedocs build --project` looks for. When the build runs at the repo root, this is your checkout's directory name. |
| `VIBEDOCS_BASE_URL` | Full origin the site is served from, e.g. `https://docs.example.com`. Drives `sitemap.xml` / `robots.txt` and absolute URLs. Overrides `domain` from the config. |
| `AWS_REGION` | Region of your S3 bucket, e.g. `us-east-1`. |
| `S3_BUCKET` | The bucket name from the prerequisites. |
| `CLOUDFRONT_DISTRIBUTION_ID` | The distribution ID from the prerequisites. |

### How `--project` resolves

`vibedocs build` looks for the project directory in this order:

1. `$VIBEDOCS_ROOT/<project>` (defaults `VIBEDOCS_ROOT` to the current working
   directory), then
2. the current working directory itself, when its basename equals `<project>`.

Running the workflow at the repo root with `VIBEDOCS_PROJECT` set to your repo's
directory name hits case (1): `<cwd>/<repo-name>` won't exist, but you can also
point `VIBEDOCS_ROOT` at the parent. The simplest reliable setup is a docs
**subdirectory** named to match `VIBEDOCS_PROJECT` (so `<repo>/<project>/`
exists at the repo root). If your markdown lives directly at the repo root, set
`VIBEDOCS_PROJECT` to the repo's own directory name so case (2) applies.

---

## Step 4 — Set GitHub Actions secrets

The workflow authenticates to AWS with an access-key pair stored as repository
secrets. In your repo: **Settings → Secrets and variables → Actions → New
repository secret**, add:

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | Access key for an IAM principal scoped to your bucket + distribution. |
| `AWS_SECRET_ACCESS_KEY` | The matching secret key. |

Grant that IAM principal **least privilege**: `s3:PutObject`, `s3:DeleteObject`,
`s3:ListBucket` on the bucket (and its `/*`), plus
`cloudfront:CreateInvalidation` on the distribution. Nothing more.

> Prefer keyless auth? Swap the access-key secrets for GitHub OIDC: configure an
> IAM role with a trust policy for `token.actions.githubusercontent.com`, give
> the workflow `permissions: { id-token: write, contents: read }`, and pass
> `role-to-assume:` to `aws-actions/configure-aws-credentials` instead of the
> key pair. This avoids long-lived credentials in your repo.

### Workflow permissions

The template requests `permissions: contents: read` only — the build needs to
read your code, nothing else. The AWS deploy is authorised by the secrets above,
not by the `GITHUB_TOKEN`. If you switch to OIDC, add `id-token: write`.

---

## Step 5 — Push and verify

Commit everything and push to your default branch. Watch the run in the
**Actions** tab. On success the workflow has synced `./site` to S3 and
invalidated CloudFront — your domain serves the new build within a minute or so.

To preview locally before pushing:

```bash
npx vibedocs build --project <name> --out ./site --base-url https://docs.example.com
npx vibedocs build --project <name> --serve   # builds, then serves on :5050
```

---

## Choosing a hydration mode

`vibedocs build` defaults to **full** hydration — the deployed site is the same
interactive SPA the live server serves (Ctrl+K search, theme toggle, rendered
Mermaid diagrams, copy-markdown buttons, mobile drawer).

Add `--hydration minimal` (or set `hydration: 'minimal'` in the config) to ship
~500 KB less JS per page. Minimal mode trades away client-side search, the theme
toggle (readers get system-preference theme only), rendered Mermaid (raw source
shown instead), and copy-md buttons, in exchange for a much lighter page. It's
the right call for public docs sites where most readers land on one page and
leave. Both modes still emit an installable, offline-capable PWA.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `--project <name> is required` | Missing/empty `VIBEDOCS_PROJECT`. |
| Build can't find the project directory | `VIBEDOCS_PROJECT` doesn't match a directory under `VIBEDOCS_ROOT`, and isn't the cwd basename. See "How `--project` resolves". |
| Config error naming a field path | A field in `.vibedocs.config.ts` is missing or the wrong type — the message names it. |
| Site builds but `/docs/foo/` 404s | CloudFront isn't rewriting clean URLs to `index.html`. Add a directory-index behaviour. |
| Deploy step fails with AccessDenied | The IAM principal behind your secrets lacks an S3 or CloudFront permission listed in Step 4. |
