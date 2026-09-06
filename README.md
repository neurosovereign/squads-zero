<img width="1377" height="768" alt="Squads Zero" src="https://github.com/user-attachments/assets/b31d531c-107d-42d7-9420-3513170b6c49" />

# Squads Zero

[![Release](https://img.shields.io/github/v/release/neurosovereign/squads-zero?display_name=tag&sort=semver)](https://github.com/neurosovereign/squads-zero/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Squads Zero** is a free, open-source front end for [Squads V4](https://squads.so/protocol), the multisig program on Solana. It is a community fork of [Squads-Protocol/public-v4-client](https://github.com/Squads-Protocol/public-v4-client) with the subscription paywall and account limits removed — every feature is free ($0), with no account and no sign-up.

It is a pure static site: there is no backend, no telemetry, and no analytics. Your wallet keys, your RPC settings, and your API keys never leave your browser. If you don't trust the deployment you're on, build it yourself and verify it against the published release hashes (see [Releases & build verification](#releases--build-verification)).

## Features

- **Unlimited multisigs** — create and switch between as many squads and accounts as you like
- **Treasury dashboard** — balances, token list, and a portfolio value chart per vault
- **Transaction management** — propose, approve, reject, execute; full instruction-level display for any transaction
- **Spending limits** — configure per-member, per-token flow limits (`/limits`)
- **Staking** — native SOL staking view and JitoSOL deposits via vault proposals (`/stake`, `/jito`)
- **Members & settings** — manage members, thresholds, timelock, and upgrade authority (`/members`, `/squad-settings`)
- **Hardware wallets** — Ledger support via a custom WebHID adapter (derivation path `44'/501'/0'`)
- **Program upgrades & config authority** — full support for on-chain program management
- **Helius integration** — indexed transaction history and DAS-capable RPC
- **Self-hosting** — run it anywhere as static files, via Docker, or on Vercel

An optional, dismissible donation nudge is shown after successful executions; donating is never required.

## Requirements

| Requirement | Notes |
|---|---|
| Node.js **v20+** and Yarn 1 (classic) | Only if you build from source. For Docker, only Docker is needed. |
| A Solana browser wallet | Phantom, Solflare, Backpack, or Ledger. |
| **A Helius API key** (free) | **Required for full functionality** — see below. Get one at [helius.dev](https://helius.dev). |

### Why you need a Helius API key

The app has no server of its own. Without a Helius key it falls back to a public community RPC: core multisig operations (creating squads, proposing, approving, executing transactions) still work, but rate limits are aggressive and the following need Helius:

- the **activity feed** (parsed transaction history via the Enhanced Transactions API)
- the **portfolio value chart** (daily prices and token metadata)
- **spending limits and staking views** (DAS queries: token metadata, stake accounts)

The Helius free tier is enough for personal use. The key is entered in the app's **Settings** page, stored only in your browser's `localStorage`, and sent only to Helius RPC endpoints — never to any other server.

## Getting started

### 1. Clone and build

```bash
git clone https://github.com/neurosovereign/squads-zero.git
cd squads-zero
yarn install --frozen-lockfile
yarn build
```

The production bundle lands in `dist/`. Serve it with any static file server (the app uses hash routing, so no server-side rewrite rules are needed):

```bash
npx serve dist
```

Optional: print the deterministic build hash so you can compare it against the published release hash:

```bash
./scripts/generate-hash.sh
```

### 2. Development mode

```bash
yarn dev
```

Runs a hot-reloading dev server at `http://localhost:3000`.

### 3. Configure the app

1. Open the app and connect your wallet.
2. Go to **Settings** and paste your Helius API key.
3. Look up an existing squad by address, or create a new one on the **Create** page.

## Self-hosting

### Docker

```bash
docker build -t squads-zero .
docker run -d -p 8080:80 squads-zero
```

The image builds deterministically and stamps its own build hash, which you can read out and compare against the release hash:

```bash
docker exec <container-id> cat /var/build-metadata/hash.txt
```

### Vercel / any static host

The repo ships a `vercel.json` with security headers, so `vercel deploy` works out of the box, or use the one-click flow:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fneurosovereign%2Fsquads-zero)

### RPC routing note

The client first tries a same-origin `/rpc` proxy (used by some deployments to strip browser `Origin` headers for the public mainnet RPC), then falls back to a public RPC. Setting a Helius key in Settings bypasses all of this — the key's RPC endpoint is used directly and is the recommended setup.

## Releases & build verification

Every release tag is built by CI into a deterministic `dist/` bundle, and its hash is published on the [releases page](https://github.com/neurosovereign/squads-zero/releases) as three artifacts:

- `dist-hash.txt` — the canonical build hash: SHA-256 over the sorted concatenation of all files in `dist/` (same formula as `./scripts/generate-hash.sh`, the `hash.txt` embedded in the Docker image, and the verify scripts)
- `dist.tar.gz` — the exact bundle the hash was computed over
- `SHA256SUMS` — checksums of the release artifacts themselves

**Verify a downloaded release:**

```bash
sha256sum -c SHA256SUMS
```

**Verify any live deployment** (e.g. one you didn't host yourself), by fetching its `manifest.json` and files and hashing them:

```bash
./scripts/verify-remote.sh https://your-deployment.example <dist-hash>
```

There is also `./scripts/verify-ipfs.sh <CID> <hash>` for IPFS deployments.

**Verify from source:** rebuild the tag yourself (`yarn install --frozen-lockfile && yarn build`), run `./scripts/generate-hash.sh`, and compare with `dist-hash.txt`. Builds are deterministic — webpack uses deterministic module/chunk IDs and file timestamps are normalized — so any mismatch means the deployment is not running this source.

> The hash table in [`HASHES.md`](HASHES.md) belongs to **upstream** releases and does not apply to this fork; see the local divergence notice in that file. For Squads Zero, the GitHub release artifacts are the source of truth.

## Differences from upstream

Beyond removing the paywall and account limits, this fork adds: a custom Ledger wallet adapter (`src/lib/ledgerSolanaAdapter.ts`), a spending-limits page (`/limits`), a staking page (`/stake`), a members page (`/members`), a JitoSOL deposit page (`/jito`), the treasury portfolio chart, the activity feed, and the donation nudge. The full list with file references lives in [`HASHES.md`](HASHES.md).

## Security model

- **No backend, no accounts, no telemetry.** The app is a static bundle; all chain data is read client-side from your RPC endpoint.
- **Keys stay local.** Wallet keys live in your wallet extension/Ledger; the Helius key and settings live in `localStorage` on your device only.
- **Verifiable builds.** Deterministic builds + published per-release hashes mean you never have to trust a deployment you can't verify.

## Contributing & License

Contributions via pull requests are welcome — keep builds deterministic (don't break `webpack.prod.js` settings or the timestamp normalization in the `Dockerfile`/release workflow). Licensed under the [MIT License](LICENSE).
