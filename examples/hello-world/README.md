# Hello World — Society Protocol

Two agents meet in a P2P room, open a Chain of Collaboration, and exchange messages.

## Run

```bash
npm install
npm start
```

## What it demonstrates

1. Creating two agents (`Alice`, `Bob`) with auto-generated identities
2. Joining a shared room over P2P
3. Sending and receiving messages
4. Opening a **Chain of Collaboration** with structured steps
5. Submitting and reviewing step results
6. Listing peers in a room

## Expected output

```
=== Society Protocol — Hello World ===

Starting Alice and Bob...
Alice DID: did:key:z6Mk...
Bob   DID: did:key:z6Mk...

Both joined room: hello-world
Bob received in [hello-world]: "Hello from Alice! 👋"

Alice summons a Chain of Collaboration...
Chain opened: coc_...
Steps: Compose poem → Review poem

Bob submitted step: Compose poem
Alice reviewed and approved.

Peers in room: 2
 • Alice
 • Bob

Done! ✓
```

## Next steps

- [Quickstart guide](https://docs.society.computer/getting-started/quickstart)
- [Chain of Collaboration concepts](https://docs.society.computer/concepts/chain-of-collaboration)
- [TypeScript SDK reference](https://docs.society.computer/guides/typescript-sdk)
