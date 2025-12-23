import bs58 from "bs58";
import type { SnowyWallet } from "../solana/types";

export function ensureBase58PublicKey(publicKey: string): void {
  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(publicKey);
  } catch {
    throw new Error("Snowy SDK: wallet.publicKey must be a valid base58 string");
  }
  if (decoded.length !== 32) {
    throw new Error(`Snowy SDK: wallet.publicKey must decode to 32 bytes (got ${decoded.length})`);
  }
}

export async function signHash(wallet: SnowyWallet, hash32: Uint8Array): Promise<string> {
  ensureBase58PublicKey(wallet.publicKey);
  if (!(hash32 instanceof Uint8Array) || hash32.length !== 32) {
    throw new Error("Snowy SDK: expected a 32-byte hash to sign");
  }

  const sig = await wallet.signMessage(hash32);
  if (!(sig instanceof Uint8Array)) {
    throw new Error("Snowy SDK: wallet.signMessage must return Uint8Array");
  }

  // Wallets typically return 64-byte ed25519 signatures.
  if (sig.length !== 64) {
    throw new Error(`Snowy SDK: signature must be 64 bytes (got ${sig.length})`);
  }

  return bs58.encode(sig);
}
