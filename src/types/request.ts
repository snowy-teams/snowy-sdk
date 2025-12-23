import type { SnowyModel } from "./model";

export type SnowyBase58String = string;

export interface SnowyGenerateRequestToHash {
  programId: SnowyBase58String;
  model: SnowyModel;
  prompt: string;
  temperature: number;
  maxTokens: number;
  /** Milliseconds since Unix epoch */
  timestamp: number;
  /** Base58-encoded signer public key */
  signer: SnowyBase58String;
}

export interface SnowyGenerateRequest extends SnowyGenerateRequestToHash {
  /** Base58-encoded SHA-256 hash of the deterministic request payload */
  requestHash: SnowyBase58String;
  /** Base58-encoded Ed25519 signature over the 32-byte request hash */
  signature: SnowyBase58String;
}

export interface SnowyGenerateInput {
  model: SnowyModel;
  prompt: string;
  temperature: number;
  maxTokens: number;
  /** Milliseconds since Unix epoch; defaults to Date.now() */
  timestamp?: number;
}
