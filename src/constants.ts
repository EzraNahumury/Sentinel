// SentinelMem live testnet deployments (see README "Live on Sui testnet").
export const NETWORK = "testnet";

// On-chain memory anchor (sentinel_memory module) — used by the "Anchor on-chain"
// wallet action to write host -> manifest pointers to Sui.
export const SENTINEL_PKG =
  "0xca26b2e73757ee26fd7e32f1f656bcffa81e5bd42b0fe115ca9ba90ee3297c6e";
export const MEMORY_REGISTRY_ID =
  "0x4df6d15626ffde080ab1b5bf15728fc107a7007aa7adfba0eb059a57a21927b5";

// Seal access-control policy — used to decrypt sealed case files in the browser
// (only addresses on the whitelist can fetch the key).
export const SEAL_PKG =
  "0x96adf5e3d28fe56db65e9aaf205017759a2bc41b4c9f1a0a8f44d037f9c9c167";
export const SEAL_WHITELIST_ID =
  "0xc43457fae4d6478ef444cdc4155f376f75ee0d4238960f94fc2a269235d7bac1";
export const SEAL_KEY_SERVERS = [
  "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75", // mysten-testnet-1
  "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8", // mysten-testnet-2
];

export interface DeployedEntry {
  label: string;
  id: string;
}

export const SENTINEL_DEPLOYMENTS: ReadonlyArray<DeployedEntry> = [
  // On-chain memory anchor (scan_market package incl. sentinel_memory module).
  { label: "Memory package", id: "0xca26b2e73757ee26fd7e32f1f656bcffa81e5bd42b0fe115ca9ba90ee3297c6e" },
  { label: "MemoryRegistry", id: "0x4df6d15626ffde080ab1b5bf15728fc107a7007aa7adfba0eb059a57a21927b5" },
  // Inspector UI hosted as a Walrus Site.
  { label: "Walrus Site", id: "0xf416e087b8ea080a6b8e0e2f290e14e6600ef022160c5a3c6904ac38d689cd16" },
  // Seal access-control policy (encrypt case files before Walrus).
  { label: "Seal policy", id: "0x96adf5e3d28fe56db65e9aaf205017759a2bc41b4c9f1a0a8f44d037f9c9c167" },
  { label: "Seal whitelist", id: "0xc43457fae4d6478ef444cdc4155f376f75ee0d4238960f94fc2a269235d7bac1" },
];
