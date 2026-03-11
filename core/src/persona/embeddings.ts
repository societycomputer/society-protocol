import crypto from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

const DEFAULT_DIM = 384;
const DEFAULT_MAX_TOKENS = 128;

function normalize(values: number[]): number[] {
    const norm = Math.sqrt(values.reduce((acc, v) => acc + v * v, 0)) || 1;
    return values.map((v) => v / norm);
}

function hashEmbedding(text: string, dim = DEFAULT_DIM): number[] {
    const out = new Array<number>(dim).fill(0);
    const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return out;
    for (const token of tokens) {
        const digest = crypto.createHash('sha256').update(token).digest();
        for (let i = 0; i < digest.length; i++) {
            const idx = (digest[i] + i * 31) % dim;
            out[idx] += ((digest[i] / 255) - 0.5) * 2;
        }
    }
    return normalize(out);
}

export interface EmbeddingServiceConfig {
    modelId?: string;
    dim?: number;
    onnxModelPath?: string;
    onnxVocabPath?: string;
    maxTokens?: number;
    onnxSession?: any;
    tokenizer?: {
        encode(text: string, maxTokens: number): {
            inputIds: number[];
            attentionMask: number[];
            tokenTypeIds: number[];
        };
    };
}

export interface EmbeddingResult {
    vector: number[];
    model: string;
    dim: number;
    runtime: 'onnx' | 'fallback-hash';
}

export class PersonaEmbeddingService {
    private readonly dim: number;
    private readonly modelId: string;
    private readonly onnxModelPath?: string;
    private readonly onnxVocabPath?: string;
    private readonly maxTokens: number;
    private onnxSession: any | null = null;
    private ort: any | null = null;
    private tokenizer:
        | {
              encode(text: string, maxTokens: number): {
                  inputIds: number[];
                  attentionMask: number[];
                  tokenTypeIds: number[];
              };
          }
        | null = null;
    private initialized = false;

    constructor(config: EmbeddingServiceConfig = {}) {
        this.dim = config.dim || DEFAULT_DIM;
        this.modelId = config.modelId || 'all-MiniLM-L6-v2';
        this.onnxModelPath = config.onnxModelPath || process.env.SOCIETY_PERSONA_ONNX_MODEL;
        this.onnxVocabPath = config.onnxVocabPath || process.env.SOCIETY_PERSONA_ONNX_VOCAB;
        this.maxTokens = Math.max(8, config.maxTokens || DEFAULT_MAX_TOKENS);
        this.onnxSession = config.onnxSession || null;
        this.tokenizer = config.tokenizer || null;
    }

    async embedText(text: string): Promise<EmbeddingResult> {
        await this.ensureInitialized();

        if (this.onnxSession && this.tokenizer) {
            try {
                const vector = await this.embedWithOnnx(text);
                return {
                    vector,
                    model: this.modelId,
                    dim: this.dim,
                    runtime: 'onnx',
                };
            } catch (error) {
                if (process.env.NODE_ENV === 'production') {
                    throw new Error(`ONNX inference failed in production: ${(error as Error).message}`);
                }
            }
        }

        return {
            vector: hashEmbedding(text, this.dim),
            model: 'fallback-hash-v1',
            dim: this.dim,
            runtime: 'fallback-hash',
        };
    }

    private async ensureInitialized(): Promise<void> {
        if (this.initialized) return;
        this.initialized = true;

        try {
            if (this.onnxSession && this.tokenizer) {
                return;
            }
            const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
            const ort = await dynamicImport('onnxruntime-node');
            if (!this.onnxModelPath) {
                throw new Error('SOCIETY_PERSONA_ONNX_MODEL not configured');
            }
            const vocabPath = this.resolveVocabPath();
            if (!vocabPath) {
                throw new Error(
                    'SOCIETY_PERSONA_ONNX_VOCAB not configured and vocab.txt was not found near model'
                );
            }
            this.ort = ort;
            this.onnxSession = await (ort as any).InferenceSession.create(this.onnxModelPath);
            this.tokenizer = createWordPieceTokenizer(vocabPath);
        } catch (error) {
            const isProd = process.env.NODE_ENV === 'production';
            if (isProd) {
                throw new Error(
                    `ONNX runtime/model is required in production for Persona embeddings: ${(error as Error).message}`
                );
            }
            this.onnxSession = null;
            this.ort = null;
            this.tokenizer = null;
        }
    }

    private resolveVocabPath(): string | undefined {
        if (this.onnxVocabPath && existsSync(this.onnxVocabPath)) {
            return this.onnxVocabPath;
        }
        if (!this.onnxModelPath) return undefined;
        const candidate = join(dirname(this.onnxModelPath), 'vocab.txt');
        if (existsSync(candidate)) return candidate;
        return undefined;
    }

    private makeIntTensor(values: number[]): any {
        if (!this.ort?.Tensor) {
            return {
                type: 'int64',
                dims: [1, values.length],
                data: BigInt64Array.from(values.map((v) => BigInt(v))),
            };
        }
        return new this.ort.Tensor(
            'int64',
            BigInt64Array.from(values.map((v: number) => BigInt(v))),
            [1, values.length]
        );
    }

    private async embedWithOnnx(text: string): Promise<number[]> {
        const encoded = this.tokenizer!.encode(text, this.maxTokens);
        const inputNames: string[] = Array.isArray(this.onnxSession.inputNames)
            ? this.onnxSession.inputNames
            : ['input_ids', 'attention_mask', 'token_type_ids'];
        const feeds: Record<string, any> = {};

        for (const name of inputNames) {
            const lower = String(name).toLowerCase();
            if (lower.includes('input') && lower.includes('id')) {
                feeds[name] = this.makeIntTensor(encoded.inputIds);
            } else if (lower.includes('attention')) {
                feeds[name] = this.makeIntTensor(encoded.attentionMask);
            } else if (lower.includes('token') && lower.includes('type')) {
                feeds[name] = this.makeIntTensor(encoded.tokenTypeIds);
            } else {
                feeds[name] = this.makeIntTensor(encoded.inputIds);
            }
        }

        const outputs = await this.onnxSession.run(feeds);
        const outputName = (Array.isArray(this.onnxSession.outputNames) && this.onnxSession.outputNames[0])
            || Object.keys(outputs)[0];
        const output = outputs[outputName];
        if (!output) {
            throw new Error('ONNX session returned no outputs');
        }

        const pooled = poolEmbedding(output, encoded.attentionMask);
        return fitAndNormalize(pooled, this.dim);
    }
}

export function vectorToJson(vector: number[]): string {
    return `[${vector.map((v) => Number.isFinite(v) ? Number(v.toFixed(8)) : 0).join(',')}]`;
}

function fitAndNormalize(values: number[], dim: number): number[] {
    const out =
        values.length === dim
            ? values
            : values.length > dim
            ? values.slice(0, dim)
            : values.concat(new Array(dim - values.length).fill(0));
    return normalize(out);
}

function poolEmbedding(tensor: any, attentionMask: number[]): number[] {
    const dataRaw = tensor?.data;
    const dimsRaw = tensor?.dims;
    const data = Array.from(dataRaw || []) as number[];
    const dims = Array.isArray(dimsRaw) ? dimsRaw.map((d: any) => Number(d)) : [];

    if (dims.length === 3) {
        const seq = dims[1];
        const hidden = dims[2];
        const out = new Array<number>(hidden).fill(0);
        let count = 0;
        for (let i = 0; i < seq; i++) {
            if ((attentionMask[i] || 0) === 0) continue;
            count += 1;
            const offset = i * hidden;
            for (let h = 0; h < hidden; h++) {
                out[h] += Number(data[offset + h] || 0);
            }
        }
        if (count > 0) {
            for (let h = 0; h < hidden; h++) out[h] /= count;
        }
        return out;
    }

    if (dims.length === 2) {
        const hidden = dims[1];
        return data.slice(0, hidden).map((v) => Number(v || 0));
    }

    return data.map((v) => Number(v || 0));
}

function createWordPieceTokenizer(vocabPath: string): {
    encode(text: string, maxTokens: number): {
        inputIds: number[];
        attentionMask: number[];
        tokenTypeIds: number[];
    };
} {
    const lines = readFileSync(vocabPath, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const vocab = new Map<string, number>();
    lines.forEach((token, index) => vocab.set(token, index));

    const unk = vocab.get('[UNK]') ?? 100;
    const cls = vocab.get('[CLS]') ?? 101;
    const sep = vocab.get('[SEP]') ?? 102;
    const pad = vocab.get('[PAD]') ?? 0;

    return {
        encode(text: string, maxTokens: number) {
            const words = basicTokenize(text);
            const pieces: number[] = [cls];
            for (const word of words) {
                const wordPieces = toWordPieces(word, vocab, unk);
                for (const id of wordPieces) {
                    if (pieces.length >= maxTokens - 1) break;
                    pieces.push(id);
                }
                if (pieces.length >= maxTokens - 1) break;
            }
            pieces.push(sep);

            const attentionMask = new Array(pieces.length).fill(1);
            const tokenTypeIds = new Array(pieces.length).fill(0);

            // Pad to stable shape for ONNX sessions with fixed max length.
            while (pieces.length < maxTokens) {
                pieces.push(pad);
                attentionMask.push(0);
                tokenTypeIds.push(0);
            }

            return {
                inputIds: pieces,
                attentionMask,
                tokenTypeIds,
            };
        },
    };
}

function basicTokenize(text: string): string[] {
    const matches = text.toLowerCase().match(/[a-z0-9]+|[^\s]/g);
    return matches || [];
}

function toWordPieces(token: string, vocab: Map<string, number>, unkId: number): number[] {
    if (vocab.has(token)) {
        return [vocab.get(token)!];
    }

    const result: number[] = [];
    let start = 0;
    while (start < token.length) {
        let end = token.length;
        let piece: string | undefined;
        while (start < end) {
            const candidate = start === 0 ? token.slice(start, end) : `##${token.slice(start, end)}`;
            if (vocab.has(candidate)) {
                piece = candidate;
                break;
            }
            end -= 1;
        }
        if (!piece) {
            return [unkId];
        }
        result.push(vocab.get(piece)!);
        start = end;
    }
    return result.length > 0 ? result : [unkId];
}
