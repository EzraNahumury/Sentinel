// SentinelMem on-chain anchoring: commit a host's latest manifest blob id to
// Sui via scan_market::sentinel_memory::anchor_memory, emitting a MemoryAnchored
// event (append-only, publicly queryable audit trail of the agent's memory).
//
// Uses a string move-call target so it works WITHOUT regenerated bindings — once
// the package (with sentinel_memory.move) is published, set SENTINEL_PKG +
// SENTINEL_MEMORY_REGISTRY and a Sui key, and anchoring activates.

import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";

export interface OnchainAnchorConfig {
  pkg: string; // published scan_market package id
  registryId: string; // shared MemoryRegistry object id (from sentinel_memory init)
  secret: string; // suiprivkey... of the anchoring agent
  rpc?: string;
}

/** (host, manifestBlobId) -> tx digest. */
export type OnAnchor = (host: string, manifestBlobId: string) => Promise<string>;

export function createOnchainAnchor(cfg: OnchainAnchorConfig): OnAnchor {
  const client = new SuiGrpcClient({
    network: "testnet",
    baseUrl: cfg.rpc ?? "https://fullnode.testnet.sui.io:443",
  });
  const keypair = Ed25519Keypair.fromSecretKey(
    decodeSuiPrivateKey(cfg.secret).secretKey,
  );
  return async (host, manifestBlobId) => {
    const tx = new Transaction();
    tx.moveCall({
      target: `${cfg.pkg}::sentinel_memory::anchor_memory`,
      arguments: [
        tx.object(cfg.registryId),
        tx.pure.string(host),
        tx.pure.string(manifestBlobId),
      ],
    });
    const res = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    });
    if (res.$kind === "FailedTransaction") {
      throw new Error("anchor_memory transaction failed");
    }
    await client.waitForTransaction({ result: res });
    return res.Transaction.digest;
  };
}
