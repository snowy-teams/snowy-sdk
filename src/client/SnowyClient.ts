import type { SnowyNetwork, SnowyWallet } from "../solana/types";
import type { SnowyModel } from "../types/model";
import type {
  SnowyGenerateInput,
  SnowyGenerateRequest,
  SnowyGenerateRequestToHash
} from "../types/request";
import type { SnowyGenerateResponse } from "../types/response";
import { SNOWY_PROGRAM_ID } from "../constants";
import { hashDeterministicJson } from "../crypto/hash";
import { ensureBase58PublicKey, signHash } from "../crypto/signer";
import { Transport, type TransportInit } from "./Transport";

export interface SnowyClientConfig {
  network: SnowyNetwork;
  /** Full URL for the inference router endpoint that accepts JSON POST */
  endpoint: string;
  /** Solana program ID embedded into every request */
  programId?: string;
  /** Transport customization */
  transport?: Transport;
  transportInit?: TransportInit;
}

function assertNonEmptyString(name: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Snowy SDK: ${name} must be a non-empty string`);
  }
}

function assertModel(model: string): asserts model is SnowyModel {
  if (model !== "snowy-base" && model !== "snowy-meme" && model !== "snowy-code") {
    throw new Error(`Snowy SDK: unsupported model: ${model}`);
  }
}

function assertNumber(name: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Snowy SDK: ${name} must be a finite number`);
  }
}

function assertInt(name: string, value: number): void {
  assertNumber(name, value);
  if (!Number.isInteger(value)) {
    throw new Error(`Snowy SDK: ${name} must be an integer`);
  }
}

function validateGenerateResponse(resp: unknown): asserts resp is SnowyGenerateResponse {
  if (!resp || typeof resp !== "object") throw new Error("Snowy SDK: invalid response");
  const r = resp as Record<string, unknown>;

  if (typeof r.output !== "string") throw new Error("Snowy SDK: response.output must be a string");
  if (typeof r.model !== "string") throw new Error("Snowy SDK: response.model must be a string");
  assertModel(r.model);

  if (!r.usage || typeof r.usage !== "object") throw new Error("Snowy SDK: response.usage missing");
  const u = r.usage as Record<string, unknown>;
  if (typeof u.promptTokens !== "number") throw new Error("Snowy SDK: usage.promptTokens missing");
  if (typeof u.completionTokens !== "number")
    throw new Error("Snowy SDK: usage.completionTokens missing");
  if (typeof u.totalTokens !== "number") throw new Error("Snowy SDK: usage.totalTokens missing");

  if (!r.verification || typeof r.verification !== "object")
    throw new Error("Snowy SDK: response.verification missing");
  const v = r.verification as Record<string, unknown>;
  if (typeof v.requestHash !== "string") throw new Error("Snowy SDK: verification.requestHash missing");
  if (typeof v.signer !== "string") throw new Error("Snowy SDK: verification.signer missing");
  if (typeof v.programId !== "string") throw new Error("Snowy SDK: verification.programId missing");
}

export class SnowyClient {
  public readonly network: SnowyNetwork;
  public readonly endpoint: string;
  public readonly programId: string;
  private readonly transport: Transport;

  constructor(config: SnowyClientConfig) {
    this.network = config.network;
    this.endpoint = config.endpoint;
    this.programId = config.programId ?? SNOWY_PROGRAM_ID;

    assertNonEmptyString("endpoint", this.endpoint);
    assertNonEmptyString("programId", this.programId);

    this.transport = config.transport ?? new Transport(config.transportInit);
  }

  /**
   * Generate an inference response from SNOWY.
   *
   * Security model:
   * - Build a deterministic payload
   * - SHA-256 hash it
   * - Sign the 32-byte hash via wallet.signMessage
   * - POST signed payload to the router endpoint
   */
  async generate(args: {
    wallet: SnowyWallet;
    input: SnowyGenerateInput;
  }): Promise<SnowyGenerateResponse> {
    const { wallet, input } = args;

    if (!wallet) throw new Error("Snowy SDK: wallet is required");
    ensureBase58PublicKey(wallet.publicKey);

    const model = input.model;
    assertModel(model);

    assertNonEmptyString("prompt", input.prompt);
    assertNumber("temperature", input.temperature);
    assertInt("maxTokens", input.maxTokens);

    const timestamp = input.timestamp ?? Date.now();
    assertInt("timestamp", timestamp);

    const toHash: SnowyGenerateRequestToHash = {
      programId: this.programId,
      model,
      prompt: input.prompt,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      timestamp,
      signer: wallet.publicKey
    };

    const { bytes: requestHashBytes, base58: requestHash } = await hashDeterministicJson(toHash);

    const signature = await signHash(wallet, requestHashBytes);

    const request: SnowyGenerateRequest = {
      ...toHash,
      requestHash,
      signature
    };

    const response = await this.transport.postJson<SnowyGenerateRequest, SnowyGenerateResponse>(
      this.endpoint,
      request
    );

    validateGenerateResponse(response);

    // Strong verification: ensure returned metadata matches what we sent.
    if (response.verification.requestHash !== requestHash) {
      throw new Error("Snowy SDK: response verification.requestHash mismatch");
    }
    if (response.verification.signer !== wallet.publicKey) {
      throw new Error("Snowy SDK: response verification.signer mismatch");
    }
    if (response.verification.programId !== this.programId) {
      throw new Error("Snowy SDK: response verification.programId mismatch");
    }

    return response;
  }
}
