import type { SnowyModel } from "./model";

export interface SnowyUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface SnowyVerification {
  requestHash: string;
  signer: string;
  programId: string;
}

export interface SnowyGenerateResponse {
  output: string;
  model: SnowyModel;
  usage: SnowyUsage;
  verification: SnowyVerification;
}
