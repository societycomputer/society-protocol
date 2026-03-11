/**
 * Society Protocol — Skills System
 * 
 * Sistema de skills/plugins para definir comportamentos reutilizáveis.
 * Baseado em arquivos skill.md (YAML frontmatter + Markdown).
 */

import YAML from 'yaml';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

// ─── Types ──────────────────────────────────────────────────────

export interface SkillManifest {
    skill: {
        name: string;
        version: string;
        description: string;
        author?: string;
        license?: string;
        homepage?: string;
        repository?: string;
    };
    
    triggers?: Array<{
        type: 'webhook' | 'schedule' | 'event' | 'manual';
        source?: string;
        event?: string;
        cron?: string;
        condition?: string;
    }>;
    
    society?: {
        template?: string;
        room?: string;
        priority?: 'low' | 'normal' | 'high' | 'critical';
        privacy?: 'public' | 'encrypted' | 'private';
        chain_config?: {
            timeout_ms?: number;
            max_retries?: number;
            consensus?: 'single' | 'majority' | 'unanimous';
        };
    };
    
    inputs?: Array<{
        name: string;
        type: 'string' | 'number' | 'boolean' | 'url' | 'file' | 'json' | 'markdown';
        required?: boolean;
        default?: any;
        description?: string;
        validation?: {
            pattern?: string;
            min?: number;
            max?: number;
            options?: string[];
        };
    }>;
    
    outputs?: Array<{
        name: string;
        type: 'string' | 'file' | 'json' | 'markdown' | 'html' | 'artifact';
        description?: string;
        path?: string;
    }>;
    
    adapters?: Array<{
        runtime: string;
        specialties?: string[];
        min_reputation?: number;
        max_cost?: number;
        count?: number;
    }>;
    
    hooks?: {
        on_init?: string;
        on_validate?: string;
        on_before_step?: string;
        on_after_step?: string;
        on_complete?: string;
        on_error?: string;
    };
    
    config?: {
        env?: Record<string, string>;
        secrets?: string[];
        files?: string[];
    };
    
    documentation?: string; // Markdown content
}

export interface SkillExecutionContext {
    skill: SkillManifest;
    inputs: Record<string, any>;
    config: Record<string, any>;
    society: {
        client: any;
        room: string;
    };
    logger: {
        info: (msg: string) => void;
        warn: (msg: string) => void;
        error: (msg: string) => void;
    };
}

export type SkillHook = (context: SkillExecutionContext) => Promise<void> | void;

// ─── Skill Parser ───────────────────────────────────────────────

export class SkillParser {
    parse(content: string): SkillManifest {
        // Extrair YAML frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        
        if (!frontmatterMatch) {
            throw new Error('Invalid skill.md format: missing YAML frontmatter');
        }

        const [, yamlContent, markdownContent] = frontmatterMatch;
        
        try {
            const manifest = YAML.parse(yamlContent) as SkillManifest;
            manifest.documentation = markdownContent.trim();
            
            this.validate(manifest);
            return manifest;
        } catch (err) {
            throw new Error(`Failed to parse skill manifest: ${(err as Error).message}`);
        }
    }

    parseFile(path: string): SkillManifest {
        if (!existsSync(path)) {
            throw new Error(`Skill file not found: ${path}`);
        }

        const content = readFileSync(path, 'utf-8');
        const manifest = this.parse(content);
        
        // Resolver caminhos relativos
        const baseDir = dirname(path);
        if (manifest.config?.files) {
            manifest.config.files = manifest.config.files.map((f) =>
                resolve(baseDir, f)
            );
        }

        return manifest;
    }

    private validate(manifest: SkillManifest): void {
        // Validações obrigatórias
        if (!manifest.skill?.name) {
            throw new Error('Skill name is required');
        }

        if (!manifest.skill?.version) {
            throw new Error('Skill version is required');
        }

        if (!manifest.skill?.description) {
            throw new Error('Skill description is required');
        }

        // Validar versão semver simples
        const versionRegex = /^\d+\.\d+\.\d+$/;
        if (!versionRegex.test(manifest.skill.version)) {
            throw new Error('Version must follow semver format (x.y.z)');
        }

        // Validar inputs
        if (manifest.inputs) {
            const names = new Set<string>();
            for (const input of manifest.inputs) {
                if (!input.name) {
                    throw new Error('Input name is required');
                }
                if (names.has(input.name)) {
                    throw new Error(`Duplicate input name: ${input.name}`);
                }
                names.add(input.name);

                const validTypes = ['string', 'number', 'boolean', 'url', 'file', 'json', 'markdown'];
                if (input.type && !validTypes.includes(input.type)) {
                    throw new Error(`Invalid input type: ${input.type}`);
                }
            }
        }

        // Validar society config
        if (manifest.society?.priority) {
            const validPriorities = ['low', 'normal', 'high', 'critical'];
            if (!validPriorities.includes(manifest.society.priority)) {
                throw new Error(`Invalid priority: ${manifest.society.priority}`);
            }
        }
    }
}

// ─── Skill Loader ───────────────────────────────────────────────

export class SkillLoader {
    private parser = new SkillParser();
    private skills = new Map<string, SkillManifest>();

    loadFromFile(path: string): SkillManifest {
        const manifest = this.parser.parseFile(path);
        this.skills.set(manifest.skill.name, manifest);
        return manifest;
    }

    loadFromDirectory(dir: string): SkillManifest[] {
        const { readdirSync } = require('fs');
        const { join } = require('path');

        const files = readdirSync(dir)
            .filter((f: string) => f.endsWith('.skill.md'))
            .map((f: string) => join(dir, f));

        return files.map((f: string) => this.loadFromFile(f));
    }

    get(name: string): SkillManifest | undefined {
        return this.skills.get(name);
    }

    list(): SkillManifest[] {
        return Array.from(this.skills.values());
    }

    listByCategory(category: string): SkillManifest[] {
        // Categorização baseada em templates ou tags
        return this.list().filter((s) => {
            const template = s.society?.template || '';
            return template.includes(category);
        });
    }
}

// ─── Skill Executor ─────────────────────────────────────────────

export class SkillExecutor {
    private hooks = new Map<string, SkillHook>();

    registerHook(name: string, hook: SkillHook): void {
        this.hooks.set(name, hook);
    }

    async execute(
        manifest: SkillManifest,
        inputs: Record<string, any>,
        society: { client: any; room: string }
    ): Promise<Record<string, any>> {
        // Validar inputs
        this.validateInputs(manifest, inputs);

        const context: SkillExecutionContext = {
            skill: manifest,
            inputs,
            config: manifest.config?.env || {},
            society,
            logger: {
                info: (msg) => console.log(`[skill:${manifest.skill.name}] ${msg}`),
                warn: (msg) => console.warn(`[skill:${manifest.skill.name}] ${msg}`),
                error: (msg) => console.error(`[skill:${manifest.skill.name}] ${msg}`),
            },
        };

        try {
            // Executar hook de inicialização
            await this.runHook(manifest.hooks?.on_init, context);

            // Criar chain no Society
            const goal = this.buildGoal(manifest, inputs);
            const chain = await society.client.summon({
                goal,
                roomId: society.room,
                template: manifest.society?.template,
                priority: manifest.society?.priority,
            });

            // Executar hook de conclusão
            await this.runHook(manifest.hooks?.on_complete, context);

            // Coletar outputs
            return this.collectOutputs(manifest, chain);
        } catch (err) {
            // Executar hook de erro
            await this.runHook(manifest.hooks?.on_error, context);
            throw err;
        }
    }

    private validateInputs(
        manifest: SkillManifest,
        inputs: Record<string, any>
    ): void {
        if (!manifest.inputs) return;

        for (const input of manifest.inputs) {
            const value = inputs[input.name];

            // Verificar obrigatório
            if (input.required && (value === undefined || value === null)) {
                throw new Error(`Required input missing: ${input.name}`);
            }

            // Usar default se não fornecido
            if (value === undefined && input.default !== undefined) {
                inputs[input.name] = input.default;
                continue;
            }

            if (value === undefined) continue;

            // Validar tipo
            if (input.type) {
                const actualType = typeof value;
                const expectedType = input.type === 'json' ? 'object' : input.type;
                
                if (actualType !== expectedType && !(input.type === 'file' && typeof value === 'string')) {
                    throw new Error(
                        `Invalid type for input ${input.name}: expected ${input.type}, got ${actualType}`
                    );
                }
            }

            // Validar padrão regex
            if (input.validation?.pattern && typeof value === 'string') {
                const regex = new RegExp(input.validation.pattern);
                if (!regex.test(value)) {
                    throw new Error(`Input ${input.name} does not match pattern`);
                }
            }

            // Validar range numérico
            if (input.type === 'number' && typeof value === 'number') {
                if (input.validation?.min !== undefined && value < input.validation.min) {
                    throw new Error(`Input ${input.name} below minimum ${input.validation.min}`);
                }
                if (input.validation?.max !== undefined && value > input.validation.max) {
                    throw new Error(`Input ${input.name} above maximum ${input.validation.max}`);
                }
            }

            // Validar opções
            if (input.validation?.options && !input.validation.options.includes(value)) {
                throw new Error(
                    `Invalid value for ${input.name}: must be one of ${input.validation.options.join(', ')}`
                );
            }
        }
    }

    private buildGoal(manifest: SkillManifest, inputs: Record<string, any>): string {
        // Construir goal a partir da descrição e inputs
        let goal = manifest.skill.description;

        // Substituir placeholders nos inputs
        for (const [key, value] of Object.entries(inputs)) {
            goal = goal.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
        }

        // Adicionar contexto dos inputs
        const inputContext = Object.entries(inputs)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join(', ');

        return `${goal}\n\nContext: ${inputContext}`;
    }

    private async runHook(
        hookName: string | undefined,
        context: SkillExecutionContext
    ): Promise<void> {
        if (!hookName) return;

        const hook = this.hooks.get(hookName);
        if (hook) {
            await hook(context);
        }
    }

    private collectOutputs(
        manifest: SkillManifest,
        chain: any
    ): Record<string, any> {
        const outputs: Record<string, any> = {};

        if (!manifest.outputs) return outputs;

        for (const output of manifest.outputs) {
            // Extrair output da chain baseado no tipo
            switch (output.type) {
                case 'markdown':
                    outputs[output.name] = this.extractMarkdownOutput(chain);
                    break;
                case 'json':
                    outputs[output.name] = this.extractJsonOutput(chain);
                    break;
                case 'file':
                    outputs[output.name] = this.extractFileOutput(chain, output.path);
                    break;
                default:
                    outputs[output.name] = chain;
            }
        }

        return outputs;
    }

    private extractMarkdownOutput(chain: any): string {
        // Extrair output markdown da chain
        return chain.steps
            ?.filter((s: any) => s.status === 'merged')
            .map((s: any) => s.memo)
            .join('\n\n---\n\n') || '';
    }

    private extractJsonOutput(chain: any): any {
        try {
            return JSON.parse(this.extractMarkdownOutput(chain));
        } catch {
            return { chain_id: chain.id, steps: chain.steps };
        }
    }

    private extractFileOutput(chain: any, path?: string): string {
        // Lógica para extrair arquivo
        return path || `./output-${chain.id}.md`;
    }
}

// ─── Utility Functions ──────────────────────────────────────────

export function createSkillTemplate(options: {
    name: string;
    description: string;
    template?: string;
    inputs?: SkillManifest['inputs'];
}): string {
    return `---
skill:
  name: "${options.name}"
  version: "1.0.0"
  description: "${options.description}"

society:
  template: "${options.template || 'simple_task'}"
  priority: "normal"

inputs:
${(options.inputs || [])
    .map(
        (i) => `  - name: "${i.name}"
    type: "${i.type || 'string'}"
    required: ${i.required !== false}
    description: "${i.description || ''}"`
    )
    .join('\n')}

outputs:
  - name: "result"
    type: "markdown"
    description: "Final result of the collaboration"

hooks:
  on_complete: "notify"
---

# ${options.name}

${options.description}

## Usage

\`\`\`javascript
import { skillExecutor } from 'society-core/sdk';

const result = await skillExecutor.execute('${options.name}', {
  ${(options.inputs || []).map((i) => `${i.name}: 'value'`).join(',\n  ')}
});
\`\`\`

## Output

The skill will produce a collaborative output based on the inputs provided.
`;
}

// Export singleton instances
export const skillParser = new SkillParser();
export const skillLoader = new SkillLoader();
export const skillExecutor = new SkillExecutor();
