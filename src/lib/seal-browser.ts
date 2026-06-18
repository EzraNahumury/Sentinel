// Browser-side Seal decryption: a connected wallet decrypts a sealed case file
// IF its address is on the on-chain whitelist. The wallet signs the Seal session
// personal message; the key servers run seal_approve and release the key only for
// whitelisted addresses (otherwise NoAccessError). Mirrors scripts/sentinel/seal.ts
// but wallet-signed instead of using a local keypair.
import { SealClient, SessionKey } from "@mysten/seal";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { fromHex } from "@mysten/sui/utils";
import type { CaseFileEntry, SealedEnvelope } from "./memory";
import { SEAL_PKG, SEAL_WHITELIST_ID, SEAL_KEY_SERVERS } from "../constants";

export type PersonalMessageSigner = (message: Uint8Array) => Promise<string>;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function decryptSealedInBrowser(
  env: SealedEnvelope,
  address: string,
  sign: PersonalMessageSigner,
): Promise<CaseFileEntry> {
  const suiClient = new SuiGrpcClient({
    network: "testnet",
    baseUrl: "https://fullnode.testnet.sui.io:443",
  });
  const seal = new SealClient({
    suiClient,
    verifyKeyServers: false,
    serverConfigs: SEAL_KEY_SERVERS.map((objectId) => ({ objectId, weight: 1 })),
  });

  const base = await SessionKey.create({
    address,
    packageId: SEAL_PKG,
    ttlMin: 10,
    suiClient,
  });
  // Backdate the creation time so the key servers don't reject a future-dated
  // certificate when the client clock leads theirs; the wallet then signs the
  // (backdated) personal message.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exported: any = base.export();
  exported.creationTimeMs -= 120_000;
  const sessionKey = SessionKey.import(exported, suiClient);
  const signature = await sign(sessionKey.getPersonalMessage());
  await sessionKey.setPersonalMessageSignature(signature);

  const tx = new Transaction();
  tx.moveCall({
    target: `${SEAL_PKG}::whitelist::seal_approve`,
    arguments: [
      tx.pure.vector("u8", Array.from(fromHex(env.sealId))),
      tx.object(SEAL_WHITELIST_ID),
    ],
  });
  const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
  const plaintext = await seal.decrypt({
    data: b64ToBytes(env.ciphertext),
    sessionKey,
    txBytes,
  });
  return JSON.parse(new TextDecoder().decode(plaintext as Uint8Array)) as CaseFileEntry;
}
