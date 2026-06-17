// Seal setup helper.
//   pnpm tsx scripts/sentinel/seal-setup.ts                       -> ensure reader key, print its Sui address
//   pnpm tsx scripts/sentinel/seal-setup.ts <pkg> <wl> <cap>      -> write .sentinel/seal.json
//
// The on-chain steps (publish, create_whitelist_entry, add) are done with the
// `sui` CLI using the funded dev key; this script only manages the reader key
// (no gas) and persists the resulting object ids for the demo.
import {
  loadOrCreateReader,
  saveSealConfig,
  DEFAULT_TESTNET_KEY_SERVERS,
  SEAL_CONFIG_PATH,
} from "./seal-config";

const [pkg, whitelistId, capId] = process.argv.slice(2);
const reader = await loadOrCreateReader();
const readerAddress = reader.getPublicKey().toSuiAddress();

if (!pkg) {
  // Mode 1: just surface the reader address to add to the whitelist.
  console.log(readerAddress);
} else {
  if (!whitelistId || !capId) {
    console.error("usage: seal-setup.ts <packageId> <whitelistId> <capId>");
    process.exit(1);
  }
  const threshold = Number(process.env.SEAL_THRESHOLD ?? 2);
  await saveSealConfig({
    packageId: pkg,
    whitelistId,
    capId,
    keyServers: DEFAULT_TESTNET_KEY_SERVERS,
    threshold,
    readerAddress,
  });
  console.log(`Wrote ${SEAL_CONFIG_PATH}`);
  console.log(`  package   = ${pkg}`);
  console.log(`  whitelist = ${whitelistId}`);
  console.log(`  cap       = ${capId}`);
  console.log(`  reader    = ${readerAddress}`);
  console.log(`  servers   = ${DEFAULT_TESTNET_KEY_SERVERS.length} (threshold ${threshold})`);
}
