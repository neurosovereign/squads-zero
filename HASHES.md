| Commit | Hash |
|--------|------|
|`fda8058008c1015a81b182657aaf6cbb21e9229d`|`c7b282cb2481b09baafee4fa54739f866a2275148b1577a81794abbc9639a6df`|
|`41c7c8076c4b6fc6a68f081ea4617c5c6cf9e9ac`|`5f1423af506b0d78a007735217a80e491c41db84af80ee645dab9845b0e0f328`|
|`5c909195463419e01b581d3cd62016d28def31db`| `e82894e5511c41739b7b04668691d63332c6d6309240cdbe019e8767b479b2da`|
|`57fd8e803ec975cc0ca06923c3564571ec1aad16`|`2206f7c3631cfb20b890b7f299359ef3d64c8d4287e9d5f790eef4fc06237068`|
|`0b7ffb3ea313b8641a3bf415db2cfad7759af753`|`8729bd7ec00311c1f68839f4e9deb016df4676d03a204558433e81d2b2a6894f`|
|`f5b9cdfee613a492fbc98dcebd3c687027dbadd7`|`4002017ec782bb206adca298f81ed9c368f47a6aacec957660b5d1ef98b56d74`|
|`71df267dac7cf564220b7b2166177ffeead4df4e`|`5281195f6eaf0e740e85d16434457d1a3663794d3ef6b3fda924fc3c8cd3e974`|
|`ee306a272a1c6bcc67db366b1c8308cff810f659`|`1e1076e882bb166f64bc2ef85462a938f1f20a6aae0aa1af6de97be38dae66c9`|
|`49a8ee11770155083f1d0b9ae8970bd9bb1e9116`|`b8246242f0c8c0dc5a313523dd411a97bd23878c8a146ecdde8af153f8691550`|
|`46ac4ebc2d965dcc053088273f51658c6feea6d8`|`7d3cc5ebe3ef2684760abe7cda0cb9a78cb0c759332f3859f6c9564084e808be`|

---

**Local divergence notice.** This fork carries modifications on top of the
upstream release: a custom Ledger wallet adapter
(`src/lib/ledgerSolanaAdapter.ts`, built on Ledger's official libraries,
derivation `44'/501'/0'`), a spending-limits page
(`src/lib/spendingLimits.ts`, `/limits`), a staking page (`src/lib/staking.ts`,
`/stake`), a members page (`src/lib/members.ts`, `/members`), and a JitoSOL
deposit page (`src/lib/jitoPool.ts`, `/jito` — direct SOL deposit into the
Jito stake pool via the SPL stake-pool program's `DepositSol` instruction,
wrapped in a vault-transaction proposal). The upstream hashes above therefore
**do not apply** to builds from this tree; verify by rebuilding from source
and diffing `dist/`.

**2026-09-04 redesign build.** The deployed dist (bundle.js sha256
`7c3d399a46a6843b09c56cab081d0c13b48a866450e41a9524316a4ebdf659da`) is
reproduced byte-identically by `npm ci --legacy-peer-deps && npx webpack
--config webpack.prod.js` from `package-lock.json` — **package-lock.json is
the live lockfile for this tree** (a `yarn --frozen-lockfile` build resolves a
different transitive tree and differs). Lockfile `resolved` URLs were
rewritten from the build environment's mirror (`npm.mirrors.msh.team`) to
`registry.npmjs.org`; all sha512 integrity entries verified on install.
