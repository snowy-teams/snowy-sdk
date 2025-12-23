# @snowy/sdk
![Snowy](assets/background-snowy.png)
Production-grade TypeScript SDK for SNOWY — a Solana-native LLM platform where access is authorized by Solana wallet signatures (no API keys).

SNOWY is designed around verifiability:

- Requests are *deterministically* serialized and hashed.
- Every inference call is authorized by `wallet.signMessage()`.
- The router can verify authorization (Ed25519 signature over the request hash).
- Responses include verification metadata so the client can assert what was authorized.

Hardcoded on-chain program ID used for verification/accounting:

- `SNOWy1111111111111111111111111111111111`

This repo also includes an optional Solana program reference in [program/README.md](program/README.md) that can record an on-chain attestation of `(signer, requestHash)` by requiring the Ed25519 verification instruction.

## Install

```bash
npm i @snowy/sdk
```

## What the SDK does

For `generate()`:

1. Build a deterministic payload containing `programId`, model and inference parameters.
2. Canonicalize JSON (stable key ordering).
3. Compute `SHA-256(canonical_json_bytes)`.
4. Ask the wallet to sign the 32-byte hash using Ed25519 (`signMessage`).
5. POST the signed request to your SNOWY inference router endpoint.
6. Return a structured response, and verify response metadata matches the request.

## Wallet interface (required)

You must provide an injected wallet object that matches this interface:

```ts
export interface SnowyWallet {
	/** Base58-encoded 32-byte Solana public key */
	publicKey: string;
	/** Ed25519 signature over the provided bytes */
	signMessage(message: Uint8Array): Promise<Uint8Array>;
}
```

Notes:

- The SDK does not ship wallet adapters. Your dApp/wallet provider injects the wallet.
- The SDK expects `publicKey` to decode to exactly 32 bytes (base58).
- The SDK signs the 32-byte request hash directly.

## Usage (Browser dApp)

```ts
import { SnowyClient } from "@snowy/sdk";

const client = new SnowyClient({
	network: "mainnet-beta",
	endpoint: "https://your-snowy-router.example.com/inference"
});

const res = await client.generate({
	wallet,
	input: {
		model: "snowy-base",
		prompt: "Explain Solana transaction signatures in one paragraph.",
		temperature: 0.2,
		maxTokens: 256
	}
});

console.log(res.output);
console.log(res.verification);
```

## Usage (Node.js / server)

The SDK works in Node.js as long as you provide:

- a `fetch` implementation (Node 18+ includes `fetch`), and
- a wallet-like signer with `signMessage()`.

```ts
import { SnowyClient } from "@snowy/sdk";

const client = new SnowyClient({
	network: "mainnet-beta",
	endpoint: "https://your-snowy-router.example.com/inference",
	transportInit: { timeoutMs: 30_000 }
});

const res = await client.generate({
	wallet,
	input: {
		model: "snowy-code",
		prompt: "Write a TypeScript function to debounce an async call.",
		temperature: 0.3,
		maxTokens: 512
	}
});

console.log(res.usage.totalTokens);
```

## Supported models

- `snowy-base`
- `snowy-meme`
- `snowy-code`

## Request format (what gets signed)

The deterministic payload that is hashed includes:

- `programId`
- `model`
- `prompt`
- `temperature`
- `maxTokens`
- `timestamp` (milliseconds since Unix epoch)
- `signer` (base58 pubkey)

The full request posted to the router additionally includes:

- `requestHash` (base58-encoded SHA-256 digest)
- `signature` (base58-encoded Ed25519 signature)

Example request JSON:

```json
{
	"programId": "SNOWy1111111111111111111111111111111111",
	"model": "snowy-base",
	"prompt": "...",
	"temperature": 0.2,
	"maxTokens": 256,
	"timestamp": 1730000000000,
	"signer": "<base58 32-byte pubkey>",
	"requestHash": "<base58 sha256>",
	"signature": "<base58 64-byte ed25519 signature>"
}
```

## Response format

The SDK expects the router to return:

```ts
type SnowyGenerateResponse = {
	output: string;
	model: "snowy-base" | "snowy-meme" | "snowy-code";
	usage: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	verification: {
		requestHash: string;
		signer: string;
		programId: string;
	};
};
```

The SDK also enforces that `verification.requestHash`, `verification.signer`, and `verification.programId` match the values it sent.

## Security model

### Deterministic hashing

SNOWY request hashes must be deterministic across environments.
This SDK canonicalizes JSON (stable key ordering) before hashing.

### Signature-based authorization

There are no API keys.
Every inference call is authorized by an Ed25519 signature from the wallet over the 32-byte request hash.

### Replay resistance

The request includes `timestamp`, which is part of the hashed payload.
Routers should enforce an acceptable time window (e.g., “only accept requests within N seconds of server time”) to prevent replay.

### Stateless SDK

- No secrets stored
- No API keys
- No session state

## Architectural philosophy

This SDK is intentionally strict and production-oriented:

- Browser + Node.js compatibility (uses `fetch` + WebCrypto when available).
- Strong runtime validation for request and response shapes.
- Wallet-agnostic API surface (you bring the injected wallet).
