export type SnowyNetwork = "mainnet-beta";

export type SnowyProgramId = string;

export interface SnowyWallet {
  /** Base58-encoded 32-byte Solana public key */
  publicKey: string;
  /** Ed25519 signature over the provided bytes */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}
