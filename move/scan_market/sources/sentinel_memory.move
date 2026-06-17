/// SentinelMem — on-chain anchor for verifiable agent memory.
///
/// The case files and per-host manifests live on Walrus; this module anchors the
/// pointer (host -> latest manifest blob id) on Sui as an append-only, publicly
/// queryable audit trail. Each anchor emits a `MemoryAnchored` event carrying the
/// agent address, host, manifest blob id, and a monotonic version, so anyone can
/// reconstruct an agent's memory timeline from chain — and prove that a recalled
/// manifest is the one the agent actually committed at that time.
///
/// Activation: this is a new module in the `scan_market` package. To use it,
/// republish the package and regenerate the TS bindings (`pnpm codegen`), then
/// wire `anchorMemory` into scripts/sentinel/agent.ts after appendCaseFile. The
/// off-chain FileAnchorStore works without this; on-chain anchoring is the
/// production, tamper-evident pointer.
module scan_market::sentinel_memory {
    use std::string::String;
    use sui::event;

    /// Shared object; its only state is a monotonic anchor counter. The memory
    /// timeline itself is reconstructed from the emitted `MemoryAnchored` events.
    public struct MemoryRegistry has key {
        id: UID,
        anchors: u64,
    }

    public struct MemoryAnchored has copy, drop {
        agent: address,
        host: String,
        manifest_blob_id: String,
        version: u64,
    }

    /// Runs on a FRESH publish and auto-creates + shares the registry. If this
    /// module is added to an existing package via UPGRADE (where `init` does NOT
    /// run), call `create_registry` once to create the registry instead.
    fun init(ctx: &mut TxContext) {
        create_registry(ctx);
    }

    /// Create + share a new `MemoryRegistry` (the shared anchor target). Needed
    /// after an upgrade-based deploy; harmless to call again (creates another).
    public fun create_registry(ctx: &mut TxContext) {
        transfer::share_object(MemoryRegistry {
            id: object::new(ctx),
            anchors: 0,
        });
    }

    /// Anchor the latest manifest blob id for `host`. Append-only: the newest
    /// `MemoryAnchored` event for a (agent, host) pair is the current head.
    public fun anchor_memory(
        registry: &mut MemoryRegistry,
        host: String,
        manifest_blob_id: String,
        ctx: &mut TxContext,
    ) {
        registry.anchors = registry.anchors + 1;
        event::emit(MemoryAnchored {
            agent: ctx.sender(),
            host,
            manifest_blob_id,
            version: registry.anchors,
        });
    }
}
