/**
 * Society Protocol - Skills Engine v1.0
 * 
 * Sistema de skills/plugins avançado:
 * - skill.md: Skills Society Protocol (YAML + Markdown)
 * - claw.md: Skills OpenClaw específicas
 * - Integração multi-runtime (OpenClaw, Claude, Ollama, etc)
 * - Auto-discovery e hot-reload de skills
 * - Composição de skills (skills chamando skills)
 */

import { EventEmitter } from 'events';
import { ulid } from 'ulid';
import { readFileSync, existsSync, readdirSync, watch } from 'fs';
import { join } from 'path';
import YAML from 'yaml';
import { spawn } from 'child_process';
import { type Storage } from '../storage.js';
import { type Identity } from '../identity.js';
import { SkillParser } from './parser.js';

// ─── Types ───────────────────────────────────────────────────────

export type SkillId = string;
export type RuntimeType = 'openclaw' | 'claude' | 'ollama' | 'openai' | 'local' | 'docker' | 'http';

export interface SkillManifest {
    skill: {
        id: string;
        name: string;
        version: string;
        description: string;
        author?: string;
        license?: string;
        homepage?: string;
        repository?: string;
        tags?: string[];
        icon?: string;
    };
    
    runtime: {
        type: RuntimeType;
        // OpenClaw específico
        openclaw?: {
            model?: string;
            tools?: string[];
            mcp?: boolean;
            autoApprove?: string[];
        };
        // Claude específico
        claude?: {
            model?: string;
            maxTokens?: number;
            systemPrompt?: string;
        };
        // Ollama específico
        ollama?: {
            model: string;
            parameters?: Record<string, any>;
        };
        // HTTP genérico
        http?: {
            endpoint: string;
            method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
            headers?: Record<string, string>;
            timeout?: number;
        };
        // Docker
        docker?: {
            image: string;
            command?: string;
            env?: Record<string, string>;
            volumes?: string[];
        };
    };
    
    triggers: Array<{
        type: 'webhook' | 'cron' | 'event' | 'file' | 'manual' | 'api' | 'mention';
        config: Record<string, any>;
    }>;
    
    capabilities: {
        inputs: Array<{
            name: string;
            type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'file';
            description?: string;
            required?: boolean;
            default?: any;
            validation?: {
                pattern?: string;
                min?: number;
                max?: number;
                enum?: any[];
            };
        }>;
        outputs: Array<{
            name: string;
            type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'file';
            description?: string;
        }>;
    };
    
    actions: Array<{
        name: string;
        description: string;
        type: 'summon' | 'message' | 'notify' | 'export' | 'http' | 'execute' | 'compose';
        config: Record<string, any>;
        condition?: string;  // Condicional (ex: "input.priority == 'high'")
    }>;
    
    compose?: {
        skills: string[];  // IDs de outras skills para compor
        sequence: 'parallel' | 'sequential' | 'conditional';
        mapping?: Record<string, string>;  // Mapeamento de inputs/outputs
    };
    
    society: {
        room?: string;
        federation?: string;
        template?: string;
        assignees?: string[];
        requireConsensus?: boolean;
        reputationThreshold?: number;
    };
    
    knowledge?: {
        space?: string;
        indexResults?: boolean;
        requiredConcepts?: string[];
    };
    
    security: {
        sandbox: 'none' | 'light' | 'strict' | 'vm';
        permissions: string[];
        maxExecutionTime?: number;
        maxMemory?: string;
        allowNetwork?: boolean;
        allowFilesystem?: boolean;
    };
    
    meta: {
        created: string;
        updated: string;
        version: number;
        changelog?: string[];
    };
}

// OpenClaw específico
export interface ClawSkill {
    claw: {
        name: string;
        version: string;
        description: string;
    };
    
    instructions: {
        system: string;           // System prompt
        user?: string;            // Template de user prompt
        context?: string[];       // Variáveis de contexto a injetar
        examples?: Array<{
            input: string;
            output: string;
            explanation?: string;
        }>;
    };
    
    tools: {
        available: string[];      // Ferramentas disponíveis (file_read, grep, etc)
        required: string[];       // Ferramentas obrigatórias
        autoApprove?: string[];   // Ferramentas aprovadas automaticamente
    };
    
    workflow: {
        steps: Array<{
            id: string;
            tool: string;
            params: Record<string, any>;
            condition?: string;
            output?: string;        // Variável para armazenar output
        }>;
        errorHandling: 'stop' | 'continue' | 'retry';
        maxIterations?: number;
    };
    
    validation: {
        preConditions?: string[];
        postConditions?: string[];
        assertions?: Array<{
            condition: string;
            errorMessage: string;
        }>;
    };
    
    integrations: {
        society?: {
            enabled: boolean;
            room?: string;
            shareResults?: boolean;
        };
        github?: {
            enabled: boolean;
            repos?: string[];
            events?: string[];
        };
        mcp?: {
            enabled: boolean;
            servers?: string[];
        };
    };
}

// Runtime execution
export interface SkillRuntime {
    id: string;
    skillId: SkillId;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    startedAt: number;
    finishedAt?: number;
    inputs: Record<string, any>;
    outputs: Record<string, any>;
    logs: string[];
    error?: string;
    artifacts: string[];
}

export class SkillExecutionError extends Error {
    constructor(
        public readonly code: 'validation' | 'runtime' | 'timeout' | 'network' | 'not_found',
        message: string,
        public readonly runtimeType?: RuntimeType,
        public readonly details?: Record<string, any>
    ) {
        super(message);
        this.name = 'SkillExecutionError';
    }
}

// ─── Skills Engine ───────────────────────────────────────────────

export class SkillsEngine extends EventEmitter {
    private skills = new Map<SkillId, SkillManifest>();
    private clawSkills = new Map<SkillId, ClawSkill>();
    private runtimes = new Map<string, SkillRuntime>();
    private skillDir: string;
    private watchers: Array<ReturnType<typeof watch>> = [];
    private skillParser = new SkillParser();
    
    constructor(
        private storage: Storage,
        private identity: Identity,
        skillDir?: string
    ) {
        super();
        this.skillDir = skillDir || join(process.env.HOME || '', '.society', 'skills');
        this.loadSkills();
        this.setupWatchers();
    }

    // ─── Skill Loading ───────────────────────────────────────────

    private loadSkills(): void {
        if (!existsSync(this.skillDir)) {
            return;
        }

        const entries = readdirSync(this.skillDir, { withFileTypes: true });
        
        for (const entry of entries) {
            if (entry.isDirectory()) {
                // Pasta de skill
                const skillPath = join(this.skillDir, entry.name);
                this.loadSkillFromDir(skillPath);
            } else if (entry.name.endsWith('.md')) {
                // Arquivo único
                this.loadSkillFromFile(join(this.skillDir, entry.name));
            }
        }
    }

    private loadSkillFromDir(dir: string): void {
        const skillMd = join(dir, 'skill.md');
        const clawMd = join(dir, 'claw.md');
        
        if (existsSync(skillMd)) {
            this.loadSkillFromFile(skillMd);
        }
        
        if (existsSync(clawMd)) {
            this.loadClawSkillFromFile(clawMd);
        }
    }

    private loadSkillFromFile(path: string): void {
        try {
            const content = readFileSync(path, 'utf-8');
            const manifest = this.parseSkillMd(content);
            
            if (manifest) {
                manifest.skill.id = manifest.skill.id || this.generateSkillId(path);
                this.skills.set(manifest.skill.id, manifest);
                this.emit('skill:loaded', manifest.skill.id, manifest);
            }
        } catch (err) {
            console.error(`Failed to load skill from ${path}:`, err);
        }
    }

    private loadClawSkillFromFile(path: string): void {
        try {
            const content = readFileSync(path, 'utf-8');
            const clawSkill = this.parseClawMd(content);
            
            if (clawSkill) {
                const id = this.generateSkillId(path);
                this.clawSkills.set(id, clawSkill);
                this.emit('claw-skill:loaded', id, clawSkill);
            }
        } catch (err) {
            console.error(`Failed to load claw skill from ${path}:`, err);
        }
    }

    // ─── Parsers ─────────────────────────────────────────────────

    private parseSkillMd(content: string): SkillManifest | null {
        const parsed = this.skillParser.parse(content) as any;
        const skillInfo = parsed?.skill;
        if (!skillInfo?.name) {
            throw new Error('Invalid skill manifest: skill.name is required');
        }

        const id = skillInfo.id || `skill_${ulid().slice(0, 8)}`;
        const nowIso = new Date().toISOString();
        const runtime = parsed.runtime && typeof parsed.runtime === 'object'
            ? parsed.runtime
            : { type: 'local' };
        const triggers = Array.isArray(parsed.triggers)
            ? parsed.triggers.map((trigger: any) => this.normalizeTrigger(trigger))
            : [{ type: 'manual', config: {} }];

        const capabilities = parsed.capabilities && typeof parsed.capabilities === 'object'
            ? parsed.capabilities
            : {
                inputs: Array.isArray(parsed.inputs)
                    ? parsed.inputs.map((input: any) => this.normalizeInputCapability(input))
                    : [],
                outputs: Array.isArray(parsed.outputs)
                    ? parsed.outputs.map((output: any) => this.normalizeOutputCapability(output))
                    : []
            };

        return {
            skill: {
                id,
                name: skillInfo.name,
                version: skillInfo.version || '1.0.0',
                description: skillInfo.description || parsed.documentation || 'Skill',
                author: skillInfo.author,
                license: skillInfo.license,
                homepage: skillInfo.homepage,
                repository: skillInfo.repository,
                tags: skillInfo.tags || [],
                icon: skillInfo.icon
            },
            runtime,
            triggers,
            capabilities,
            actions: parsed.actions || [],
            compose: parsed.compose,
            society: parsed.society || {},
            knowledge: parsed.knowledge,
            security: parsed.security || {
                sandbox: 'light',
                permissions: []
            },
            meta: parsed.meta || {
                created: nowIso,
                updated: nowIso,
                version: 1
            }
        };
    }

    private parseClawMd(content: string): ClawSkill | null {
        const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
        if (!match) return null;

        const [_, yamlContent, instructionsBody] = match;
        const claw = YAML.parse(yamlContent) as ClawSkill;
        
        if (claw && instructionsBody.trim()) {
            claw.instructions.system = instructionsBody.trim();
        }
        
        return claw;
    }

    // ─── Skill Execution ─────────────────────────────────────────

    async executeSkill(
        skillId: SkillId,
        inputs: Record<string, any>,
        context?: {
            room?: string;
            federation?: string;
            trigger?: string;
        }
    ): Promise<SkillRuntime> {
        const skill = this.skills.get(skillId);
        if (!skill) {
            throw new SkillExecutionError(
                'not_found',
                `Skill ${skillId} not found`
            );
        }

        // Validar inputs
        await this.validateInputs(skill, inputs);

        const runtime: SkillRuntime = {
            id: `run_${ulid()}`,
            skillId,
            status: 'running',
            startedAt: Date.now(),
            inputs,
            outputs: {},
            logs: [],
            artifacts: []
        };

        this.runtimes.set(runtime.id, runtime);
        this.emit('runtime:started', runtime);

        try {
            await this.runRuntimeWithRetries(skill, runtime, context);

            // Executar ações pós-execução
            await this.executeActions(skill, runtime, context);

            runtime.status = 'completed';
            runtime.finishedAt = Date.now();
            
            this.emit('runtime:completed', runtime);
        } catch (error) {
            runtime.status = 'failed';
            const normalized = this.normalizeExecutionError(skill.runtime.type, error);
            runtime.error = normalized.message;
            runtime.finishedAt = Date.now();
            
            this.emit('runtime:failed', runtime);
            throw normalized;
        }

        return runtime;
    }

    private async runRuntimeWithRetries(
        skill: SkillManifest,
        runtime: SkillRuntime,
        context?: any
    ): Promise<void> {
        const maxRetries = this.getMaxRetries(skill);
        let attempt = 0;

        while (true) {
            try {
                await this.executeRuntime(skill, runtime, context);
                return;
            } catch (error) {
                if (attempt >= maxRetries) {
                    throw error;
                }
                attempt++;
                runtime.logs.push(
                    `Runtime ${skill.runtime.type} failed on attempt ${attempt}/${maxRetries + 1}. Retrying...`
                );
            }
        }
    }

    private async executeRuntime(
        skill: SkillManifest,
        runtime: SkillRuntime,
        context?: any
    ): Promise<void> {
        switch (skill.runtime.type) {
            case 'openclaw':
                await this.executeOpenClaw(skill, runtime, context);
                break;
            case 'claude':
                await this.executeClaude(skill, runtime, context);
                break;
            case 'ollama':
                await this.executeOllama(skill, runtime, context);
                break;
            case 'http':
                await this.executeHttp(skill, runtime);
                break;
            case 'docker':
                await this.executeDocker(skill, runtime);
                break;
            case 'local':
                await this.executeLocal(skill, runtime);
                break;
            default:
                throw new SkillExecutionError(
                    'runtime',
                    `Unknown runtime type: ${skill.runtime.type}`,
                    skill.runtime.type
                );
        }
    }

    private getMaxRetries(skill: SkillManifest): number {
        const retries = Number((skill.runtime as any)?.retries ?? (skill.security as any)?.retries ?? 0);
        if (!Number.isFinite(retries) || retries <= 0) {
            return 0;
        }
        return Math.min(5, Math.floor(retries));
    }

    private getRuntimeTimeoutMs(skill: SkillManifest, fallbackMs: number = 30_000): number {
        const timeout = Number((skill.runtime as any)?.timeoutMs ?? skill.security?.maxExecutionTime ?? fallbackMs);
        if (!Number.isFinite(timeout) || timeout <= 0) {
            return fallbackMs;
        }
        return timeout;
    }

    private normalizeExecutionError(runtimeType: RuntimeType, error: unknown): SkillExecutionError {
        if (error instanceof SkillExecutionError) {
            return error;
        }

        const message = error instanceof Error ? error.message : String(error);
        if (/timed? out/i.test(message)) {
            return new SkillExecutionError('timeout', message, runtimeType);
        }
        if (/fetch|network|ENOTFOUND|ECONNREFUSED/i.test(message)) {
            return new SkillExecutionError('network', message, runtimeType);
        }
        return new SkillExecutionError('runtime', message, runtimeType);
    }

    private async executeOpenClaw(
        skill: SkillManifest,
        runtime: SkillRuntime,
        context?: any
    ): Promise<void> {
        const config = skill.runtime.openclaw!;
        
        runtime.logs.push('Initializing OpenClaw runtime...');

        const instructions = this.buildOpenClawInstructions(skill, runtime.inputs);
        const endpoint = process.env.OPENCLAW_API_URL || 'http://localhost:8080/v1/skills/execute';
        runtime.logs.push(`Calling OpenClaw endpoint ${endpoint}`);

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: config?.model,
                mcp: !!config?.mcp,
                tools: config?.tools || [],
                instructions,
                inputs: runtime.inputs,
                context
            }),
            signal: AbortSignal.timeout(this.getRuntimeTimeoutMs(skill, 30_000))
        });

        if (!response.ok) {
            throw new Error(`OpenClaw execution failed: ${response.status}`);
        }

        const payload = await response.json();
        const responseData = payload && typeof payload === 'object'
            ? payload as Record<string, unknown>
            : { result: payload };
        runtime.outputs = {
            ...responseData,
            instructions
        };
    }

    private async executeClaude(
        skill: SkillManifest,
        runtime: SkillRuntime,
        context?: any
    ): Promise<void> {
        const config = skill.runtime.claude!;
        
        runtime.logs.push('Initializing Claude runtime...');
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new Error('ANTHROPIC_API_KEY is required for Claude runtime');
        }

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: config.model || 'claude-3-5-sonnet-latest',
                max_tokens: config.maxTokens || 1024,
                system: config.systemPrompt || 'You are a helpful assistant.',
                messages: [
                    {
                        role: 'user',
                        content: JSON.stringify({
                            inputs: runtime.inputs,
                            context
                        })
                    }
                ]
            }),
            signal: AbortSignal.timeout(this.getRuntimeTimeoutMs(skill, 30_000))
        });

        if (!response.ok) {
            throw new Error(`Claude execution failed: ${response.status}`);
        }

        const data = await response.json() as any;
        const resultText = data?.content?.[0]?.text ?? JSON.stringify(data);
        runtime.outputs = {
            result: resultText,
            model: config.model || 'claude-3-5-sonnet'
        };
    }

    private async executeOllama(
        skill: SkillManifest,
        runtime: SkillRuntime,
        context?: any
    ): Promise<void> {
        const config = skill.runtime.ollama!;
        
        runtime.logs.push(`Initializing Ollama with model ${config.model}...`);
        const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
        const response = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: config.model,
                prompt: JSON.stringify({
                    inputs: runtime.inputs,
                    context
                }),
                stream: false,
                ...(config.parameters || {})
            }),
            signal: AbortSignal.timeout(this.getRuntimeTimeoutMs(skill, 30_000))
        });

        if (!response.ok) {
            throw new Error(`Ollama execution failed: ${response.status}`);
        }

        const data = await response.json() as any;
        runtime.outputs = {
            result: data?.response || '',
            model: config.model
        };
    }

    private async executeHttp(skill: SkillManifest, runtime: SkillRuntime): Promise<void> {
        const config = skill.runtime.http!;
        
        runtime.logs.push(`Making HTTP ${config.method || 'POST'} to ${config.endpoint}...`);
        
        const response = await fetch(config.endpoint, {
            method: config.method || 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...config.headers
            },
            body: JSON.stringify(runtime.inputs),
            signal: AbortSignal.timeout(config.timeout ? config.timeout * 1000 : this.getRuntimeTimeoutMs(skill, 30_000))
        });

        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }

        runtime.outputs = await response.json();
    }

    private async executeDocker(skill: SkillManifest, runtime: SkillRuntime): Promise<void> {
        const config = skill.runtime.docker!;
        
        runtime.logs.push(`Running Docker container ${config.image}...`);

        const args: string[] = ['run', '--rm'];
        for (const volume of config.volumes || []) {
            args.push('-v', volume);
        }
        for (const [key, value] of Object.entries(config.env || {})) {
            args.push('-e', `${key}=${value}`);
        }
        args.push(config.image);
        if (config.command) {
            args.push('sh', '-lc', config.command);
        }

        const execution = await this.runCommand('docker', args, skill.security.maxExecutionTime || 60_000);
        runtime.outputs = {
            result: execution.stdout.trim(),
            stderr: execution.stderr.trim(),
            code: execution.code,
            image: config.image
        };
    }

    private async executeLocal(skill: SkillManifest, runtime: SkillRuntime): Promise<void> {
        runtime.logs.push('Executing local skill...');
        
        // Executar ações definidas na skill
        for (const action of skill.actions || []) {
            runtime.logs.push(`Executing action: ${action.name}`);
            if (action.type !== 'execute') continue;
            const command = action.config.command as string | undefined;
            if (!command) continue;
            const execution = await this.runCommand(
                'sh',
                ['-lc', command],
                skill.security.maxExecutionTime || 60_000
            );
            runtime.outputs[action.name] = {
                stdout: execution.stdout.trim(),
                stderr: execution.stderr.trim(),
                code: execution.code
            };
        }
        
        runtime.outputs = {
            ...runtime.outputs,
            result: 'Local execution completed',
            inputs: runtime.inputs
        };
    }

    private async executeActions(
        skill: SkillManifest,
        runtime: SkillRuntime,
        context?: any
    ): Promise<void> {
        for (const action of skill.actions || []) {
            // Verificar condição
            if (action.condition && !(await this.evaluateCondition(action.condition, runtime))) {
                continue;
            }

            switch (action.type) {
                case 'summon':
                    await this.executeSummonAction(skill, action, runtime, context);
                    break;
                case 'message':
                    await this.executeMessageAction(skill, action, runtime, context);
                    break;
                case 'notify':
                    runtime.logs.push(`Notification: ${action.config.message}`);
                    break;
                case 'export':
                    runtime.logs.push(`Exporting to ${action.config.format}`);
                    break;
                case 'compose':
                    await this.executeComposedSkills(skill, runtime, context);
                    break;
            }
        }
    }

    private async executeComposedSkills(
        parentSkill: SkillManifest,
        runtime: SkillRuntime,
        context?: any
    ): Promise<void> {
        if (!parentSkill.compose) return;

        const { skills, sequence } = parentSkill.compose;
        
        if (sequence === 'parallel') {
            // Executar todas em paralelo
            await Promise.all(
                skills.map(id => this.executeSkill(id, runtime.inputs, context))
            );
        } else if (sequence === 'sequential') {
            // Executar em sequência
            let composedInputs = { ...runtime.inputs };
            for (const id of skills) {
                const subRuntime = await this.executeSkill(id, composedInputs, context);
                runtime.outputs[`compose:${id}`] = subRuntime.outputs;
                // Mapear outputs para inputs da próxima
                if (parentSkill.compose?.mapping) {
                    composedInputs = {
                        ...composedInputs,
                        ...this.applyComposeMapping(parentSkill.compose.mapping, id, subRuntime.outputs)
                    };
                }
            }
        }
    }

    // ─── Skill Composition ───────────────────────────────────────

    composeSkills(
        name: string,
        skillIds: string[],
        options: {
            sequence?: 'parallel' | 'sequential' | 'conditional';
            mapping?: Record<string, string>;
        }
    ): SkillManifest {
        const composed: SkillManifest = {
            skill: {
                id: `composed_${ulid()}`,
                name,
                version: '1.0.0',
                description: `Composed skill: ${skillIds.join(' + ')}`
            },
            runtime: {
                type: 'local'
            },
            triggers: [],
            capabilities: {
                inputs: [],
                outputs: []
            },
            actions: [],
            compose: {
                skills: skillIds,
                sequence: options.sequence || 'sequential',
                mapping: options.mapping
            },
            society: {},
            security: {
                sandbox: 'light',
                permissions: ['compose:execute']
            },
            meta: {
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                version: 1
            }
        };

        // Agregar capabilities das skills componentes
        for (const id of skillIds) {
            const skill = this.skills.get(id);
            if (skill) {
                composed.capabilities.inputs.push(...skill.capabilities.inputs);
                composed.capabilities.outputs.push(...skill.capabilities.outputs);
            }
        }

        this.skills.set(composed.skill.id, composed);
        return composed;
    }

    // ─── Helpers ─────────────────────────────────────────────────

    private normalizeTrigger(trigger: any): SkillManifest['triggers'][number] {
        const rawType = String(trigger?.type || 'manual');
        const type = rawType === 'schedule'
            ? 'cron'
            : (['webhook', 'cron', 'event', 'file', 'manual', 'api', 'mention'].includes(rawType)
                ? rawType
                : 'manual');
        const config = trigger?.config && typeof trigger.config === 'object'
            ? trigger.config
            : {
                source: trigger?.source,
                event: trigger?.event,
                cron: trigger?.cron,
                condition: trigger?.condition
            };
        return { type: type as SkillManifest['triggers'][number]['type'], config };
    }

    private normalizeInputCapability(input: any): SkillManifest['capabilities']['inputs'][number] {
        const mappedType = this.mapExternalTypeToInputType(input?.type);
        return {
            name: String(input?.name || 'input'),
            type: mappedType,
            description: input?.description,
            required: input?.required ?? false,
            default: input?.default,
            validation: input?.validation
        };
    }

    private normalizeOutputCapability(output: any): SkillManifest['capabilities']['outputs'][number] {
        const mappedType = this.mapExternalTypeToOutputType(output?.type);
        return {
            name: String(output?.name || 'output'),
            type: mappedType,
            description: output?.description
        };
    }

    private mapExternalTypeToInputType(type: unknown): SkillManifest['capabilities']['inputs'][number]['type'] {
        switch (type) {
            case 'number':
            case 'boolean':
            case 'array':
            case 'object':
            case 'file':
            case 'string':
                return type;
            case 'json':
                return 'object';
            case 'url':
            case 'markdown':
            default:
                return 'string';
        }
    }

    private mapExternalTypeToOutputType(type: unknown): SkillManifest['capabilities']['outputs'][number]['type'] {
        switch (type) {
            case 'number':
            case 'boolean':
            case 'array':
            case 'object':
            case 'file':
            case 'string':
                return type;
            case 'json':
                return 'object';
            case 'artifact':
                return 'file';
            case 'html':
            case 'markdown':
            default:
                return 'string';
        }
    }

    private async validateInputs(skill: SkillManifest, inputs: Record<string, any>): Promise<void> {
        for (const input of skill.capabilities.inputs) {
            if (input.required && !(input.name in inputs)) {
                throw new SkillExecutionError(
                    'validation',
                    `Required input missing: ${input.name}`,
                    skill.runtime.type
                );
            }
            
            if (input.name in inputs && input.validation) {
                const value = inputs[input.name];
                
                if (input.validation.pattern) {
                    const { SafeExpressionEvaluator } = await import('../prompt-guard.js');
                    const safePattern = SafeExpressionEvaluator.validateRegexPattern(input.validation.pattern);
                    const regex = new RegExp(safePattern);
                    if (!regex.test(String(value))) {
                        throw new SkillExecutionError(
                            'validation',
                            `Input ${input.name} does not match pattern`,
                            skill.runtime.type
                        );
                    }
                }
                
                if (input.validation.min !== undefined && value < input.validation.min) {
                    throw new SkillExecutionError(
                        'validation',
                        `Input ${input.name} below minimum`,
                        skill.runtime.type
                    );
                }
                
                if (input.validation.max !== undefined && value > input.validation.max) {
                    throw new SkillExecutionError(
                        'validation',
                        `Input ${input.name} above maximum`,
                        skill.runtime.type
                    );
                }
                
                if (input.validation.enum && !input.validation.enum.includes(value)) {
                    throw new SkillExecutionError(
                        'validation',
                        `Input ${input.name} not in allowed values`,
                        skill.runtime.type
                    );
                }
            }
        }
    }

    private async evaluateCondition(condition: string, runtime: SkillRuntime): Promise<boolean> {
        try {
            const { SafeExpressionEvaluator } = await import('../prompt-guard.js');
            const evaluator = new SafeExpressionEvaluator();
            const variables: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(runtime.inputs || {})) {
                variables[`inputs.${k}`] = v;
            }
            for (const [k, v] of Object.entries(runtime.outputs || {})) {
                variables[`outputs.${k}`] = v;
            }
            return evaluator.evaluate(condition, variables);
        } catch {
            return false;
        }
    }

    private buildOpenClawInstructions(
        skill: SkillManifest,
        inputs: Record<string, any>
    ): string {
        return `
# Task: ${skill.skill.name}

## Inputs
${Object.entries(inputs).map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`).join('\n')}

## Instructions
${skill.actions.map(a => `- ${a.name}: ${a.description}`).join('\n')}
        `.trim();
    }

    private applyComposeMapping(
        mapping: Record<string, string>,
        skillId: string,
        outputs: Record<string, any>
    ): Record<string, any> {
        const mapped: Record<string, any> = {};
        for (const [target, source] of Object.entries(mapping)) {
            const [sourceSkill, sourceKey] = source.split('.');
            if (sourceSkill && sourceKey) {
                if (sourceSkill === skillId && sourceKey in outputs) {
                    mapped[target] = outputs[sourceKey];
                }
            } else if (source in outputs) {
                mapped[target] = outputs[source];
            }
        }
        return mapped;
    }

    private async executeSummonAction(
        skill: SkillManifest,
        action: SkillManifest['actions'][number],
        runtime: SkillRuntime,
        context?: any
    ): Promise<void> {
        const roomId = action.config.room || context?.room || skill.society.room;
        if (!roomId) {
            throw new Error('Summon action requires a room');
        }

        this.storage.createRoom(roomId, roomId, this.identity.did);
        const chainId = `skill_coc_${ulid()}`;
        const goal = action.config.goal || runtime.inputs.goal || skill.skill.description;
        this.storage.createChain(
            chainId,
            roomId,
            String(goal),
            skill.society.template || null,
            this.identity.did,
            'normal'
        );
        runtime.logs.push(`Summoned chain ${chainId}`);
        runtime.outputs.summonedChainId = chainId;
    }

    private async executeMessageAction(
        skill: SkillManifest,
        action: SkillManifest['actions'][number],
        runtime: SkillRuntime,
        context?: any
    ): Promise<void> {
        const roomId = action.config.room || context?.room || skill.society.room;
        if (!roomId) {
            throw new Error('Message action requires a room');
        }

        this.storage.createRoom(roomId, roomId, this.identity.did);
        const text = String(action.config.message || runtime.outputs.result || runtime.inputs.message || '');
        const messageId = `msg_${ulid()}`;
        this.storage.saveMessage(
            messageId,
            roomId,
            this.identity.did,
            this.identity.displayName,
            text,
            null,
            Date.now()
        );
        runtime.logs.push(`Stored message ${messageId} in room ${roomId}`);
        runtime.outputs.messageId = messageId;
    }

    private runCommand(
        command: string,
        args: string[],
        timeoutMs: number
    ): Promise<{ stdout: string; stderr: string; code: number }> {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            const timer = setTimeout(() => {
                timedOut = true;
                child.kill('SIGTERM');
            }, timeoutMs);

            child.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
            });

            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });

            child.on('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });

            child.on('close', (code) => {
                clearTimeout(timer);
                if (timedOut) {
                    reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
                    return;
                }
                if (code !== 0) {
                    reject(new Error(`Command failed (${command}): ${stderr.trim() || `exit ${code}`}`));
                    return;
                }
                resolve({ stdout, stderr, code: code || 0 });
            });
        });
    }

    private setupWatchers(): void {
        if (!existsSync(this.skillDir)) return;

        const watcher = watch(this.skillDir, { recursive: true }, (event, filename) => {
            if (filename?.endsWith('.md')) {
                console.log(`Skill file changed: ${filename}`);
                // Recarregar skill
                const fullPath = join(this.skillDir, filename);
                if (existsSync(fullPath)) {
                    if (filename.includes('claw')) {
                        this.loadClawSkillFromFile(fullPath);
                    } else {
                        this.loadSkillFromFile(fullPath);
                    }
                }
            }
        });

        this.watchers.push(watcher);
    }

    private generateSkillId(path: string): string {
        const basename = path.split('/').pop()?.replace(/\.md$/, '') || 'skill';
        return `skill_${basename}_${ulid().slice(0, 8)}`;
    }

    // ─── Public API ──────────────────────────────────────────────

    getSkill(id: SkillId): SkillManifest | undefined {
        return this.skills.get(id);
    }

    getClawSkill(id: SkillId): ClawSkill | undefined {
        return this.clawSkills.get(id);
    }

    listSkills(): SkillManifest[] {
        return Array.from(this.skills.values());
    }

    listClawSkills(): Array<{ id: string; skill: ClawSkill }> {
        return Array.from(this.clawSkills.entries()).map(([id, skill]) => ({ id, skill }));
    }

    searchSkills(query: string): SkillManifest[] {
        const q = query.toLowerCase();
        return this.listSkills().filter(s =>
            s.skill.name.toLowerCase().includes(q) ||
            s.skill.description.toLowerCase().includes(q) ||
            s.skill.tags?.some(t => t.toLowerCase().includes(q))
        );
    }

    getRuntime(id: string): SkillRuntime | undefined {
        return this.runtimes.get(id);
    }

    listRuntimes(): SkillRuntime[] {
        return Array.from(this.runtimes.values());
    }

    stop(): void {
        for (const watcher of this.watchers) {
            watcher.close();
        }
        this.watchers = [];
    }
}

// Classes already exported via 'export class'
