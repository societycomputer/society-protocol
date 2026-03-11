import { describe, it, expect } from 'vitest';
import { MessageCompressor } from '../../src/compression.js';

describe('MessageCompressor', () => {
    const sample = new TextEncoder().encode('Society compression round-trip validation '.repeat(80));

    it('should round-trip gzip losslessly', async () => {
        const compressor = new MessageCompressor({
            algorithm: 'gzip',
            threshold: 0
        });

        const compressed = await compressor.compress(sample);
        const decompressed = await compressor.decompress(compressed, 'gzip');
        expect(Array.from(decompressed)).toEqual(Array.from(sample));
    });

    it('should round-trip lz4 losslessly with explicit codec framing', async () => {
        const compressor = new MessageCompressor({
            algorithm: 'lz4',
            threshold: 0
        });

        const compressed = await compressor.compress(sample);
        expect(String.fromCharCode(compressed[0], compressed[1])).toBe('L4');

        const decompressed = await compressor.decompress(compressed, 'lz4');
        expect(Array.from(decompressed)).toEqual(Array.from(sample));
    });

    it('should round-trip zstd losslessly with explicit codec framing', async () => {
        const compressor = new MessageCompressor({
            algorithm: 'zstd',
            threshold: 0
        });

        const compressed = await compressor.compress(sample);
        expect(String.fromCharCode(compressed[0], compressed[1])).toBe('ZS');

        const decompressed = await compressor.decompress(compressed, 'zstd');
        expect(Array.from(decompressed)).toEqual(Array.from(sample));
    });
});
