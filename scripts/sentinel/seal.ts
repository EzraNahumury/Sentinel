// Seal encryption helper — encrypt SentinelMem case files before storing them on
// Walrus, so only addresses on an on-chain whitelist can decrypt. Opt-in privacy
// layer; the default flow stores plaintext JSON.
//
// Flow (all live on testnet — see scripts/sentinel/seal-demo.ts):
//   const crypto = await createSealCrypto(cfg)
//   const { ciphertext, id } = await crypto.encryptJson(caseFile)   // store BOTH on Walrus
//   const plain = await crypto.decryptJson(ciphertext, id, reader)  // reader ∈ whitelist
//
// The on-chain policy is the canonical Seal "whitelist" pattern, published as a
// FRESH package (seal_policy::whitelist) — the Seal SDK's SessionKey rejects
// upgraded packages. `seal_approve(id, &Whitelist)` is dry-run by the key servers
// to gate key release: the id must carry the whitelist object id as its prefix
// and the caller (the reader's session address) must be on the whitelist.
//
// @mysten/seal + @mysten/walrus are imported lazily (kept out of the default
// agent path so non-Seal runs need neither dependency nor on-chain setup).

import { Transaction } from "@mysten/sui/transactions";
import { fromHex, toHex } from "@mysten/sui/utils";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export interface SealConfig {
  packageId: string; // the published whitelist policy package (version 1)
  whitelistId: string; // shared Whitelist object id
  keyServerObjectIds: string[]; // Seal key-server object ids for the network
  threshold?: number; // default 2
  rpcUrl?: string; // Sui gRPC endpoint
  clockBackdateSec?: number; // backdate session creation_time vs key-server clock (default 120)
}

export interface SealCrypto {
  // Returns the ciphertext bytes (store on Walrus) AND the key-id used (hex) —
  // the id must be presented again to decrypt, so persist it with the blob.
  encryptJson(obj: unknown): Promise<{ ciphertext: Uint8Array; id: string }>;
  decryptJson(
    ciphertext: Uint8Array,
    id: string,
    reader: Ed25519Keypair,
  ): Promise<unknown>;
}

export async function createSealCrypto(cfg: SealConfig): Promise<SealCrypto> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let SealClient: any, SessionKey: any, SuiGrpcClient: any;
  try {
    ({ SealClient, SessionKey } = await import("@mysten/seal"));
    ({ SuiGrpcClient } = await import("@mysten/sui/grpc"));
  } catch {
    throw new Error(
      "Seal requires @mysten/seal + @mysten/walrus. Run: pnpm add @mysten/seal @mysten/walrus",
    );
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const suiClient = new SuiGrpcClient({
    network: "testnet",
    baseUrl: cfg.rpcUrl ?? "https://fullnode.testnet.sui.io:443",
  });
  const threshold = cfg.threshold ?? 2;
  const seal = new SealClient({
    suiClient,
    verifyKeyServers: false,
    serverConfigs: cfg.keyServerObjectIds.map((objectId) => ({
      objectId,
      weight: 1,
    })),
  });

  // Key-id = [whitelist objectId bytes][random nonce]; seal_approve checks the
  // whitelist-id prefix, so any nonce yields a fresh id under the same policy.
  const freshId = (): string =>
    toHex(
      Uint8Array.from([
        ...fromHex(cfg.whitelistId),
        ...crypto.getRandomValues(new Uint8Array(8)),
      ]),
    );

  return {
    async encryptJson(obj: unknown): Promise<{ ciphertext: Uint8Array; id: string }> {
      const data = new TextEncoder().encode(JSON.stringify(obj));
      const id = freshId();
      const { encryptedObject } = await seal.encrypt({
        threshold,
        packageId: cfg.packageId,
        id,
        data,
      });
      return { ciphertext: encryptedObject as Uint8Array, id };
    },

    async decryptJson(
      ciphertext: Uint8Array,
      id: string,
      reader: Ed25519Keypair,
    ): Promise<unknown> {
      const address = reader.getPublicKey().toSuiAddress();
      // Pass the reader as signer so the SDK signs the session personal message
      // itself (no separate getPersonalMessage/setSignature dance).
      const base = await SessionKey.create({
        address,
        packageId: cfg.packageId,
        ttlMin: 10,
        signer: reader,
        suiClient,
      });
      // The key servers reject a certificate whose creation_time is in THEIR
      // future — even a couple of seconds of local clock lead trips it. Backdate
      // the creation time by a safety margin (well within the TTL) and re-import
      // so the signer re-signs over the backdated message.
      const exported = base.export();
      exported.creationTimeMs -= (cfg.clockBackdateSec ?? 120) * 1000;
      const sessionKey = SessionKey.import(exported, suiClient, reader);

      // The seal_approve PTB must carry the SAME id used at encryption, so the
      // key servers authorize releasing the key for exactly this ciphertext.
      const tx = new Transaction();
      tx.moveCall({
        target: `${cfg.packageId}::whitelist::seal_approve`,
        arguments: [
          tx.pure.vector("u8", Array.from(fromHex(id))),
          tx.object(cfg.whitelistId),
        ],
      });
      const txBytes = await tx.build({
        client: suiClient,
        onlyTransactionKind: true,
      });
      const plaintext = await seal.decrypt({
        data: ciphertext,
        sessionKey,
        txBytes,
      });
      return JSON.parse(new TextDecoder().decode(plaintext as Uint8Array));
    },
  };
}
