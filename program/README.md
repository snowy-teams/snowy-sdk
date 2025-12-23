# SNOWY On-chain Authorization Program

This folder contains a minimal Solana program that can be used to anchor SNOWY inference authorization on-chain.

## What it does

- Requires that the transaction includes an `ed25519_program` signature verification instruction.
- Verifies the verification targets:
  - `signer` (wallet public key)
  - `message` = 32-byte `request_hash` (SHA-256 hash used by the SDK)
- Creates a PDA record account derived from:
  - `seed = ["snowy", signer, request_hash]`

## Why this matters

SNOWY inference is performed off-chain, but authorization is wallet-based and verifiable. This program enables dApps to create an on-chain attestation that a given wallet authorized a specific deterministic inference request hash.

## Note

This is a Solana program source reference; deploying and maintaining the on-chain program is an ops decision.
