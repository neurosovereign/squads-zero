<img width="1377" height="768" alt="bg-06" src="https://github.com/user-attachments/assets/b31d531c-107d-42d7-9420-3513170b6c49" />

# Squads Zero (v4 Public Client)

**Squads Zero** is a fully refactored, optimization-focused fork of the `public-v4-client`, bypassing artificial subscription paywalls to provide a free, unrestricted multisig client ($0 cost).

## Features
- **Verifiable Build**: Static files in `dist/` can be verified using remote URLs or IPFS CIDs against expected hashes.
- **Self-hosting**: Run via Docker with Nginx.

## Getting Started

### 1. Build the Web App
Prerequisites: Node.js v20+, Yarn.
```bash
git clone https://github.com
cd squads-zero
yarn install --frozen-lockfile
yarn build
./scripts/generate-hash.sh
```

### 3. Self-Host with Docker
Prerequisites: Docker.
```bash
docker build -t squads-zero .
docker run -d -p 8080:80 squads-zero
```

### 4. Build Hash & Integrity
Since we have red-designed the whole app, it is no longer possible to verify the hash. Sorry about that. Let your coding agent check the code. We didn't add anything malicious.

## Contributing & License
Contributions via pull requests are welcome. Licensed under the MIT License.
