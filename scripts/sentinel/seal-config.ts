// Shared config + reader-key handling for the Seal encryption layer.
//
// The "reader" is an Ed25519 keypair whose Sui address is added to the on-chain
// whitelist. It signs the Seal SessionKey personal message to fetch decryption
// keys; it needs no gas (the seal_approve check runs read-only on the key
// servers). The secret is persisted to a gitignored file so the demo reproduces.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export const SEAL_CONFIG_PATH =
  process.env.SEAL_CONFIG ?? ".sentinel/seal.json";
export const SEAL_READER_PATH =
  process.env.SEAL_READER_KEY ?? ".sentinel/seal-reader.key";

// Official Mysten testnet open-mode key servers (docs.wal.app → Seal Pricing).
export const DEFAULT_TESTNET_KEY_SERVERS = [
  "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75", // mysten-testnet-1
  "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8", // mysten-testnet-2
];

export interface SealOnchainConfig {
  packageId: string;
  whitelistId: string;
  capId: string;
  keyServers: string[];
  threshold: number;
  readerAddress: string;
}

export async function loadOrCreateReader(
  path: string = SEAL_READER_PATH,
): Promise<Ed25519Keypair> {
  try {
    const secret = (await readFile(path, "utf8")).trim();
    return Ed25519Keypair.fromSecretKey(secret);
  } catch {
    const kp = Ed25519Keypair.generate();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, kp.getSecretKey(), { mode: 0o600 });
    return kp;
  }
}

export async function loadSealConfig(
  path: string = SEAL_CONFIG_PATH,
): Promise<SealOnchainConfig> {
  return JSON.parse(await readFile(path, "utf8")) as SealOnchainConfig;
}

export async function saveSealConfig(
  cfg: SealOnchainConfig,
  path: string = SEAL_CONFIG_PATH,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cfg, null, 2));
}
