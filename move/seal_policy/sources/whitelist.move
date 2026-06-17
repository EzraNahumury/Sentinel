// SentinelMem Seal access-control policy.
//
// This is the canonical Seal "whitelist" pattern (MystenLabs/seal →
// move/patterns/sources/whitelist.move), packaged standalone so it publishes as
// a FRESH package at version 1 — required by the Seal SDK's SessionKey.create,
// which rejects upgraded packages.
//
// Key-id format: [pkg id][whitelist id][random nonce]. Anyone may encrypt to a
// whitelist's key-id; only addresses on the whitelist can fetch the decryption
// key. `seal_approve` is what the Seal key servers dry-run to gate key release.
module seal_policy::whitelist;

use sui::table;

const ENoAccess: u64 = 1;
const EInvalidCap: u64 = 2;
const EDuplicate: u64 = 3;
const ENotInWhitelist: u64 = 4;
const EWrongVersion: u64 = 5;

const VERSION: u64 = 1;

public struct Whitelist has key {
    id: UID,
    version: u64,
    addresses: table::Table<address, bool>,
}

public struct Cap has key, store {
    id: UID,
    wl_id: ID,
}

/// Create a whitelist with an admin cap.
public fun create_whitelist(ctx: &mut TxContext): (Cap, Whitelist) {
    let wl = Whitelist {
        id: object::new(ctx),
        version: VERSION,
        addresses: table::new(ctx),
    };
    let cap = Cap {
        id: object::new(ctx),
        wl_id: object::id(&wl),
    };
    (cap, wl)
}

public fun share_whitelist(wl: Whitelist) {
    transfer::share_object(wl);
}

/// Helper: create + share a whitelist and send the cap back to the sender.
entry fun create_whitelist_entry(ctx: &mut TxContext) {
    let (cap, wl) = create_whitelist(ctx);
    share_whitelist(wl);
    transfer::public_transfer(cap, ctx.sender());
}

public fun add(wl: &mut Whitelist, cap: &Cap, account: address) {
    assert!(cap.wl_id == object::id(wl), EInvalidCap);
    assert!(!wl.addresses.contains(account), EDuplicate);
    wl.addresses.add(account, true);
}

public fun remove(wl: &mut Whitelist, cap: &Cap, account: address) {
    assert!(cap.wl_id == object::id(wl), EInvalidCap);
    assert!(wl.addresses.contains(account), ENotInWhitelist);
    wl.addresses.remove(account);
}

/// All whitelisted addresses can access all key-ids with the whitelist's prefix.
fun check_policy(caller: address, id: vector<u8>, wl: &Whitelist): bool {
    assert!(wl.version == VERSION, EWrongVersion);

    // Check the id carries the whitelist object id as a prefix.
    let prefix = wl.id.to_bytes();
    let mut i = 0;
    if (prefix.length() > id.length()) {
        return false
    };
    while (i < prefix.length()) {
        if (prefix[i] != id[i]) {
            return false
        };
        i = i + 1;
    };

    wl.addresses.contains(caller)
}

entry fun seal_approve(id: vector<u8>, wl: &Whitelist, ctx: &TxContext) {
    assert!(check_policy(ctx.sender(), id, wl), ENoAccess);
}

#[test_only]
public fun destroy_for_testing(wl: Whitelist, cap: Cap) {
    let Whitelist { id, version: _, addresses } = wl;
    addresses.drop();
    object::delete(id);
    let Cap { id, .. } = cap;
    object::delete(id);
}

#[test]
fun test_approve() {
    let ctx = &mut tx_context::dummy();
    let (cap, mut wl) = create_whitelist(ctx);
    wl.add(&cap, @0x2);

    let mut obj_id = object::id(&wl).to_bytes();
    obj_id.push_back(11);
    assert!(check_policy(@0x2, obj_id, &wl), 1);
    assert!(!check_policy(@0x1, obj_id, &wl), 1);

    destroy_for_testing(wl, cap);
}
