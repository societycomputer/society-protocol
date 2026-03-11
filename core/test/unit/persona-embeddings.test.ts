import { describe, it, expect } from 'vitest';
import { PersonaEmbeddingService } from '../../src/persona/embeddings.js';

describe('PersonaEmbeddingService', () => {
    it('uses ONNX runtime path when session and tokenizer are available', async () => {
        const dim = 384;
        const seq = 8;
        const data = new Float32Array(seq * dim);
        for (let i = 0; i < data.length; i++) {
            data[i] = (i % 31) / 31;
        }

        const fakeSession = {
            inputNames: ['input_ids', 'attention_mask', 'token_type_ids'],
            outputNames: ['last_hidden_state'],
            async run() {
                return {
                    last_hidden_state: {
                        dims: [1, seq, dim],
                        data,
                    },
                };
            },
        };

        const service = new PersonaEmbeddingService({
            dim,
            onnxSession: fakeSession,
            tokenizer: {
                encode() {
                    return {
                        inputIds: new Array(seq).fill(1),
                        attentionMask: new Array(seq).fill(1),
                        tokenTypeIds: new Array(seq).fill(0),
                    };
                },
            },
        });

        const result = await service.embedText('hello persona vault');
        expect(result.runtime).toBe('onnx');
        expect(result.dim).toBe(dim);
        expect(result.vector).toHaveLength(dim);
        const norm = Math.sqrt(result.vector.reduce((acc, value) => acc + value * value, 0));
        expect(norm).toBeGreaterThan(0.9);
        expect(norm).toBeLessThan(1.1);
    });
});
