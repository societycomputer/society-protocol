/**
 * Content-Addressed Block Store
 *
 * IPFS-inspired content-addressed storage for Society Protocol.
 * Uses blake3 hashing for CIDs and SQLite for block persistence.
 * Supports chunked file storage with Merkle-like manifests.
 *
 * Based on: IPFS (arXiv:1407.3561) — content-addressed blocks with CID-based retrieval
 */

import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';
import { type Storage } from './storage.js';

// ─── Constants ──────────────────────────────────────────────────

const BLOCK_SIZE = 256 * 1024; // 256KB per block

// ─── Types ──────────────────────────────────────────────────────

export interface FileManifest {
    rootCid: string;
    fileName: string;
    totalSize: number;
    blockSize: number;
    blocks: Array<{ cid: string; offset: number; size: number }>;
    mimeType?: string;
    createdAt: number;
    author: string; // DID
}

// ─── ContentStore ───────────────────────────────────────────────

export class ContentStore {
    private storage: Storage;
    private manifests = new Map<string, FileManifest>(); // rootCid → manifest

    constructor(storage: Storage) {
        this.storage = storage;
        this.ensureTable();
    }

    private ensureTable(): void {
        this.storage.db.exec(`
            CREATE TABLE IF NOT EXISTS content_blocks (
                cid TEXT PRIMARY KEY,
                data BLOB NOT NULL,
                size INTEGER NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
            );
            CREATE TABLE IF NOT EXISTS file_manifests (
                root_cid TEXT PRIMARY KEY,
                manifest TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
            );
        `);
    }

    /**
     * Store a data block, returning its CID (blake3 hash).
     */
    async put(data: Uint8Array): Promise<string> {
        const { blake3 } = await import('@noble/hashes/blake3');
        const hash = blake3(data);
        const cid = Buffer.from(hash).toString('hex');

        // Idempotent: skip if already stored
        const existing = this.storage.db
            .prepare('SELECT cid FROM content_blocks WHERE cid = ?')
            .get(cid);
        if (!existing) {
            this.storage.db
                .prepare('INSERT INTO content_blocks (cid, data, size) VALUES (?, ?, ?)')
                .run(cid, Buffer.from(data), data.byteLength);
        }

        return cid;
    }

    /**
     * Retrieve a block by CID.
     */
    async get(cid: string): Promise<Uint8Array | null> {
        const row = this.storage.db
            .prepare('SELECT data FROM content_blocks WHERE cid = ?')
            .get(cid) as { data: Buffer } | undefined;

        return row ? new Uint8Array(row.data) : null;
    }

    /**
     * Check if a block exists locally.
     */
    has(cid: string): boolean {
        const row = this.storage.db
            .prepare('SELECT 1 FROM content_blocks WHERE cid = ?')
            .get(cid);
        return !!row;
    }

    /**
     * Store a file from disk, chunking into blocks.
     * Returns a manifest describing all blocks.
     */
    async storeFile(filePath: string, author: string): Promise<FileManifest> {
        const fileData = readFileSync(filePath);
        return this.storeBuffer(fileData, basename(filePath), author);
    }

    /**
     * Store raw buffer data, chunking into blocks.
     */
    async storeBuffer(data: Buffer | Uint8Array, fileName: string, author: string): Promise<FileManifest> {
        const buf = Buffer.from(data);
        const blocks: FileManifest['blocks'] = [];

        for (let offset = 0; offset < buf.byteLength; offset += BLOCK_SIZE) {
            const chunk = new Uint8Array(buf.subarray(offset, Math.min(offset + BLOCK_SIZE, buf.byteLength)));
            const cid = await this.put(chunk);
            blocks.push({ cid, offset, size: chunk.byteLength });
        }

        // Root CID = hash of all block CIDs concatenated
        const { blake3 } = await import('@noble/hashes/blake3');
        const rootData = new TextEncoder().encode(blocks.map(b => b.cid).join(':'));
        const rootCid = Buffer.from(blake3(rootData)).toString('hex');

        const manifest: FileManifest = {
            rootCid,
            fileName,
            totalSize: buf.byteLength,
            blockSize: BLOCK_SIZE,
            blocks,
            createdAt: Date.now(),
            author,
        };

        // Persist manifest
        this.manifests.set(rootCid, manifest);
        this.storage.db
            .prepare('INSERT OR REPLACE INTO file_manifests (root_cid, manifest) VALUES (?, ?)')
            .run(rootCid, JSON.stringify(manifest));

        return manifest;
    }

    /**
     * Reassemble a file from its manifest.
     * All blocks must be locally available.
     */
    async retrieveFile(manifest: FileManifest): Promise<Uint8Array> {
        const result = Buffer.alloc(manifest.totalSize);

        for (const block of manifest.blocks) {
            const data = await this.get(block.cid);
            if (!data) {
                throw new Error(`Missing block ${block.cid} for file ${manifest.fileName}`);
            }
            Buffer.from(data).copy(result, block.offset);
        }

        return new Uint8Array(result);
    }

    /**
     * Save reassembled file to disk.
     */
    async saveFile(manifest: FileManifest, outputPath: string): Promise<void> {
        const data = await this.retrieveFile(manifest);
        writeFileSync(outputPath, data);
    }

    /**
     * Get a manifest by root CID.
     */
    getManifest(rootCid: string): FileManifest | null {
        if (this.manifests.has(rootCid)) {
            return this.manifests.get(rootCid)!;
        }

        const row = this.storage.db
            .prepare('SELECT manifest FROM file_manifests WHERE root_cid = ?')
            .get(rootCid) as { manifest: string } | undefined;

        if (row) {
            const manifest = JSON.parse(row.manifest) as FileManifest;
            this.manifests.set(rootCid, manifest);
            return manifest;
        }

        return null;
    }

    /**
     * List all stored file manifests.
     */
    listFiles(): FileManifest[] {
        const rows = this.storage.db
            .prepare('SELECT manifest FROM file_manifests ORDER BY created_at DESC')
            .all() as Array<{ manifest: string }>;

        return rows.map(r => JSON.parse(r.manifest) as FileManifest);
    }

    /**
     * List missing blocks for a manifest (for fetching from peers).
     */
    getMissingBlocks(manifest: FileManifest): string[] {
        return manifest.blocks
            .filter(b => !this.has(b.cid))
            .map(b => b.cid);
    }

    /**
     * Store a manifest received from a peer (without blocks).
     */
    addRemoteManifest(manifest: FileManifest): void {
        this.manifests.set(manifest.rootCid, manifest);
        this.storage.db
            .prepare('INSERT OR REPLACE INTO file_manifests (root_cid, manifest) VALUES (?, ?)')
            .run(manifest.rootCid, JSON.stringify(manifest));
    }
}
