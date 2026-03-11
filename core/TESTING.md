# Society Protocol - Testing Guide

This document explains how to test the Society Protocol implementation.

## Quick Start

Run the manual test suite:

```bash
cd core
npx tsx scripts/test-manual.ts
```

Expected output: All 15 tests should pass ✅

## Test Structure

### Manual Tests (`scripts/test-manual.ts`)

A comprehensive smoke test that verifies all core modules:

- **Storage**: Database initialization
- **Federation**: Create, retrieve, permissions, policies
- **Knowledge**: Spaces, cards (concept/fact/insight), updates
- **Compression**: Data compression/decompression

### Running Tests

```bash
# Run manual tests
npm run test:manual        # If configured in package.json
npx tsx scripts/test-manual.ts

# Build check
npm run build

# Type check
npm run lint
```

## Test Coverage

### Modules Tested

| Module | Tests | Status |
|--------|-------|--------|
| Storage | DB initialization | ✅ |
| Federation | CRUD, permissions, policies | ✅ |
| Knowledge | Spaces, cards, updates | ✅ |
| Compression | Compress/decompress | ✅ |

### Modules Requiring Additional Setup

These modules require more complex initialization (P2P, rooms, etc.):

- **CoC (Chain of Collaboration)**: Requires RoomManager with P2P
- **Skills Engine**: Requires runtime configuration
- **Security**: Requires proper key management setup

## Integration Testing

To test the full integration with P2P networking:

```bash
# Start a bootstrap node
npm run start -- --bootstrap

# In another terminal, connect a peer
npm run start -- --connect /ip4/127.0.0.1/tcp/4001/p2p/<peer-id>
```

## Creating Custom Tests

Example test structure:

```typescript
import { FederationEngine } from './src/federation.js';
import { Storage } from './src/storage.js';

const storage = new Storage({ dbPath: ':memory:' });
const federation = new FederationEngine(storage, identity);

// Test creating a federation
const fed = await federation.createFederation(
    'Test',
    'Description',
    'public'
);

console.assert(fed.name === 'Test', 'Name should match');
```

## CI/CD Testing

For automated testing in CI/CD:

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - run: npm run test:manual
```

## Troubleshooting

### Common Issues

**SQLite errors**: Ensure write permissions to temp directory

**Module not found**: Run `npm run build` first

**Type errors**: Check TypeScript version (5.8+)

## Next Steps

1. Add unit tests for individual functions
2. Add integration tests for CoC + Knowledge binding
3. Add P2P networking tests
4. Add performance benchmarks

## Test Data

Tests use temporary directories that are automatically cleaned up:
- Location: `/tmp/society-manual-test-<timestamp>/`
- Auto-cleanup: Yes
- Parallel safe: Yes
