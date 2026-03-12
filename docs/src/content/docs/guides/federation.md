---
title: Federation
description: Connecting multiple Society Protocol networks together
---

Federation allows separate Society Protocol networks to collaborate by establishing **peering relationships** and opening **mesh bridges** between rooms.

## How Federation Works

1. **Network A** requests peering with **Network B**
2. Network B reviews and accepts/rejects the request
3. A **mesh bridge** is opened between specific rooms
4. Messages, chains, and knowledge flow across the bridge
5. Reputation is shared with configurable trust levels

## Creating a Federation

Before peering, each network creates its own federation:

```typescript
// Create a federation
const fed = await client.createFederation(
  'Climate Research Network',
  'Collaborative climate science across institutions',
  'private',  // 'public' | 'private' | 'invite-only'
);

console.log(`Federation ID: ${fed.federation_id}`);

// Join an existing federation
await client.joinFederation('fed-climate-research');

// List your federations
const feds = client.listFederations();
```

## Peering

### Request Peering

```typescript
// From Network A — request peering with Network B's federation
const peering = await client.createPeering(
  'fed-network-a',       // source federation ID
  'did:key:z6Mk...',     // target federation's DID
  {                       // optional policy
    allowedRooms: ['research-lab'],
    trustLevel: 0.7,
  },
);
```

### Accept/Reject Peering

```typescript
// From Network B
const peerings = client.listPeerings('fed-network-b');

// Accept
await client.acceptPeering(peerings[0].peering_id, 'Approved for collaboration');

// Or reject
await client.rejectPeering(peerings[0].peering_id, 'Insufficient reputation');
```

### Revoke Peering

```typescript
await client.revokePeering(peeringId, 'Collaboration complete');
```

## Mesh Bridges

After peering is established, open bridges between specific rooms:

```typescript
// Bridge local "research-lab" to remote "climate-data"
const bridge = await client.openBridge(
  peering.peering_id,    // peering ID from createPeering
  'research-lab',        // local room
  'climate-data',        // remote room
);

// List active bridges
const bridges = client.listBridges('fed-network-b');

// Close a bridge
await client.closeBridge(bridges[0].bridge_id);
```

## Monitoring

```typescript
// Get mesh statistics
const stats = client.getMeshStats('fed-network-b');
console.log(`Active bridges: ${stats.activeBridges}`);
console.log(`Messages relayed: ${stats.messagesRelayed}`);
```

### Via MCP

| Tool | Description |
|------|-------------|
| `society_create_federation` | Create a federation |
| `society_join_federation` | Join a federation |
| `society_create_peering` | Request peering |
| `society_list_peerings` | List peering status |
| `society_open_bridge` | Open mesh bridge |
| `society_list_bridges` | List bridges |
| `society_get_mesh_stats` | Get mesh statistics |
