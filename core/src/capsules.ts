/**
 * Society Protocol — Capsules Module
 *
 * A Capsule is an immutable, exported snapshot of a CoC Chain.
 * It contains the DAG, assignment history, and all generated artifacts packaged
 * into a single archive (a `.society` zip file) for sharing and auditing.
 */

import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { type CocEngine } from './coc.js';
import { type Storage } from './storage.js';

export class CapsuleExporter {
    constructor(
        private coc: CocEngine,
        private storage: Storage
    ) { }

    /**
     * Exports a chain to a .society archive file.
     * @param chainId The ID of the chain to export.
     * @param outputDirectory Where to save the file.
     * @returns The absolute path to the generated .society file.
     */
    public async export(chainId: string, outputDirectory: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const chain = this.coc.getChain(chainId);
            if (!chain) {
                return reject(new Error(`Cannot export: Chain ${chainId} not found.`));
            }

            // Also get all raw events for auditing
            const events = this.storage.db.prepare('SELECT * FROM coc_events WHERE chain_id = ? ORDER BY ts ASC').all(chainId);

            const filename = `capsule_${chainId}.society`;
            const outputPath = path.join(outputDirectory, filename);
            const output = fs.createWriteStream(outputPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            output.on('close', () => {
                resolve(outputPath);
            });

            archive.on('error', (err) => {
                reject(err);
            });

            archive.pipe(output);

            // 1. Write the main manifesto (chain.json)
            archive.append(JSON.stringify(chain, null, 2), { name: 'manifest.json' });

            // 2. Write the audit log
            archive.append(JSON.stringify(events, null, 2), { name: 'audit_log.json' });

            // 3. Extract and write individual artifacts into a folder hierarchy
            for (const step of chain.steps) {
                if (step.artifacts && step.artifacts.length > 0) {
                    for (let i = 0; i < step.artifacts.length; i++) {
                        const artifact = step.artifacts[i];
                        // If artifact is a string containing code/text, we save it directly
                        const content = typeof artifact === 'string' ? artifact : JSON.stringify(artifact, null, 2);
                        const extension = this.guessExtension(content);
                        archive.append(content, { name: `artifacts/${step.step_id}/artifact_${i}${extension}` });
                    }
                }
            }

            void archive.finalize();
        });
    }

    private guessExtension(content: string): string {
        if (content.startsWith('{') || content.startsWith('[')) return '.json';
        if (content.includes('import ') || content.includes('function ')) {
            if (content.includes('React') || content.includes('JSX')) return '.tsx';
            return '.ts';
        }
        if (content.startsWith('# ')) return '.md';
        return '.txt';
    }
}
