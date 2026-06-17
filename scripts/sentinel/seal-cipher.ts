// Adapter: turn the Seal layer (scripts/sentinel/seal.ts) into the dependency-
// free CaseFileCipher the memory layer accepts. Built only when SENTINEL_SEAL=1,
// so the default agent path keeps storing plaintext and needs no Seal setup.
//
// seal(entry): encrypt the signed case file -> { sealId, ciphertext(base64) }.
// open(env):   decrypt with the whitelisted reader -> the original case file.
import { createSealCrypto } from "./seal";
import { loadSealConfig, loadOrCreateReader } from "./seal-config";
import type { CaseFileCipher, CaseFileEntry, SealedEnvelope } from "../../src/lib/memory";

export async function makeSealCaseFileCipher(): Promise<{
  cipher: CaseFileCipher;
  label: string;
}> {
  const cfg = await loadSealConfig();
  const reader = await loadOrCreateReader();
  const crypto = await createSealCrypto({
    packageId: cfg.packageId,
    whitelistId: cfg.whitelistId,
    keyServerObjectIds: cfg.keyServers,
    threshold: cfg.threshold,
  });

  const cipher: CaseFileCipher = {
    async seal(entry: CaseFileEntry): Promise<SealedEnvelope> {
      const { ciphertext, id } = await crypto.encryptJson(entry);
      return {
        schema: "sentinelmem.sealed.v1",
        sealId: id,
        ciphertext: Buffer.from(ciphertext).toString("base64"),
      };
    },
    async open(env: SealedEnvelope): Promise<CaseFileEntry> {
      const bytes = new Uint8Array(Buffer.from(env.ciphertext, "base64"));
      return (await crypto.decryptJson(bytes, env.sealId, reader)) as CaseFileEntry;
    },
  };

  return {
    cipher,
    label: `Seal whitelist ${cfg.whitelistId.slice(0, 10)}… (threshold ${cfg.threshold}/${cfg.keyServers.length})`,
  };
}
