// Seal encryption helper — encrypt SentinelMem case files before storing them on
// Walrus, so only authorized readers (per an on-chain allowlist policy) can
// decrypt. Opt-in privacy layer; the default flow stores plaintext JSON.
//
// Activation (needs on-chain setup you deploy):
//   1. Publish Seal's allowlist pattern (MystenLabs/seal → move/patterns/sources/
//      whitelist.move). Note packageId + the shared Whitelist objectId, and add
//      authorized reader addresses to it.
//   2. Get the key-server objectIds for your network.
//   3. Set env: SENTINEL_SEAL=1, SEAL_PKG, SEAL_WHITELIST, SEAL_KEY_SERVERS
//      (comma-separated objectIds), SEAL_THRESHOLD (default 2).
//   4. Wire encryptJson() before uploadToWalrus and decryptJson() after
//      readCaseFile in the memory layer (left to the integrator — keeps the core
//      demo dependency-free).
//
// @mysten/seal + @mysten/walrus are imported lazily (not default deps):
//   pnpm add @mysten/seal @mysten/walrus
//
// NOTE: @mysten/seal is beta; confirm the SealClient/SessionKey API against
// https://www.npmjs.com/package/@mysten/seal before relying on it.

import { Transaction } from "@mysten/sui/transactions";
import { fromHEX, toHEX } from "@mysten/sui/utils";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export interface SealConfig {
  packageId: string; // the published allowlist policy package
  whitelistId: string; // shared Whitelist object id
  keyServerObjectIds: string[]; // key-server object ids for the network
  threshold?: number; // default 2
  network?: "testnet" | "mainnet"; // default testnet
  rpcUrl?: string;
}

export interface SealCrypto {
  encryptJson(obj: unknown): Promise<Uint8Array>; // returns ciphertext bytes (store on Walrus)
  decryptJson(ciphertext: Uint8Array, reader: Ed25519Keypair): Promise<unknown>;
}

export async function createSealCrypto(cfg: SealConfig): Promise<SealCrypto> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let SealClient: any, SessionKey: any, SuiClient: any, getFullnodeUrl: any;
  try {
    ({ SealClient, SessionKey } = await import("@mysten/seal"));
    ({ SuiClient, getFullnodeUrl } = await import("@mysten/sui/client"));
  } catch {
    throw new Error(
      "Seal requires @mysten/seal + @mysten/walrus. Run: pnpm add @mysten/seal @mysten/walrus",
    );
  }
  const network = cfg.network ?? "testnet";
  const suiClient = new SuiClient({ url: cfg.rpcUrl ?? getFullnodeUrl(network) });
  const threshold = cfg.threshold ?? 2;
  const seal = new SealClient({
    suiClient,
    verifyKeyServers: false,
    serverConfigs: cfg.keyServerObjectIds.map((objectId) => ({ objectId, weight: 1 })),
  });

  // id = [whitelist objectId bytes][random nonce] — seal_approve checks the prefix.
  const freshId = (): string =>
    toHEX(
      Uint8Array.from([
        ...fromHEX(cfg.whitelistId),
        ...crypto.getRandomValues(new Uint8Array(8)),
      ]),
    );

  return {
    async encryptJson(obj: unknown): Promise<Uint8Array> {
      const data = new TextEncoder().encode(JSON.stringify(obj));
      const { encryptedObject } = await seal.encrypt({
        threshold,
        packageId: cfg.packageId,
        id: freshId(),
        data,
      });
      return encryptedObject as Uint8Array;
    },

    async decryptJson(ciphertext: Uint8Array, reader: Ed25519Keypair): Promise<unknown> {
      const address = reader.getPublicKey().toSuiAddress();
      const sessionKey = await SessionKey.create({
        address,
        packageId: cfg.packageId,
        ttlMin: 10,
        suiClient,
      });
      const { signature } = await reader.signPersonalMessage(
        sessionKey.getPersonalMessage(),
      );
      sessionKey.setPersonalMessageSignature(signature);

      // Recover the id from the ciphertext header is SDK-specific; in the common
      // flow the caller stores the id alongside the blob. Here we re-derive the
      // approve call against the whitelist; integrators that need the exact id
      // should persist it with the blob. The seal_approve call gates release.
      const tx = new Transaction();
      tx.moveCall({
        target: `${cfg.packageId}::whitelist::seal_approve`,
        arguments: [
          tx.pure.vector("u8", fromHEX(cfg.whitelistId)),
          tx.object(cfg.whitelistId),
        ],
      });
      const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
      const plaintext = await seal.decrypt({ data: ciphertext, sessionKey, txBytes });
      return JSON.parse(new TextDecoder().decode(plaintext as Uint8Array));
    },
  };
}
