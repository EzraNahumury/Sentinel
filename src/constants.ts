// SentinelMem live testnet deployments (see README "Live on Sui testnet").
export const NETWORK = "testnet";

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
