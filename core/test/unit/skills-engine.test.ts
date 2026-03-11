import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Storage } from '../../src/storage.js';
import { generateIdentity, type Identity } from '../../src/identity.js';
import { SkillsEngine } from '../../src/skills/engine.js';

describe('SkillsEngine', () => {
    let testDir: string;
    let skillsDir: string;
    let storage: Storage;
    let identity: Identity;
    let engine: SkillsEngine | undefined;

    beforeEach(() => {
        testDir = join(tmpdir(), `society-skills-test-${Date.now()}`);
        skillsDir = join(testDir, 'skills');
        mkdirSync(skillsDir, { recursive: true });

        storage = new Storage({ dbPath: join(testDir, 'test.db') });
        identity = generateIdentity('Skills Tester');
        engine = undefined;
    });

    afterEach(() => {
        const watchers = (engine as any)?.watchers as Array<{ close: () => void }> | undefined;
        watchers?.forEach((watcher) => watcher.close());
        try {
            storage.close();
        } catch {}
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should load YAML skill manifest via parser and expose normalized capabilities', () => {
        const skillFile = join(skillsDir, 'skill.md');
        writeFileSync(skillFile, `---
skill:
  id: "complex-skill"
  name: "Complex Skill"
  version: "1.2.3"
  description: "Parses complex YAML"
runtime:
  type: "local"
inputs:
  - name: "url"
    type: "url"
    required: true
outputs:
  - name: "payload"
    type: "json"
security:
  sandbox: "light"
  permissions: []
---
# Complex Skill
`);

        engine = new SkillsEngine(storage, identity, skillsDir);
        const skill = engine.getSkill('complex-skill');

        expect(skill).toBeDefined();
        expect(skill?.capabilities.inputs[0].name).toBe('url');
        expect(skill?.capabilities.inputs[0].type).toBe('string');
        expect(skill?.capabilities.outputs[0].type).toBe('object');
    });

    it('should retry local runtime execution when configured', async () => {
        const flagPath = join(testDir, 'retry.flag');
        const skillFile = join(skillsDir, 'retry.skill.md');
        writeFileSync(skillFile, `---
skill:
  id: "retry-local"
  name: "Retry Local"
  version: "1.0.0"
  description: "Retry test"
runtime:
  type: "local"
  retries: 1
security:
  sandbox: "light"
  permissions: []
  maxExecutionTime: 5000
capabilities:
  inputs:
    - name: "task"
      type: "string"
      required: true
  outputs: []
actions:
  - name: "run"
    description: "Execute command with first-attempt failure"
    type: "execute"
    config:
      command: "if [ ! -f '${flagPath}' ]; then touch '${flagPath}'; exit 1; fi; echo retry-ok"
---
# Retry Local
`);

        engine = new SkillsEngine(storage, identity, skillsDir);
        const runtime = await engine.executeSkill('retry-local', { task: 'go' });

        expect(runtime.status).toBe('completed');
        expect(runtime.logs.some((line) => line.includes('Retrying'))).toBe(true);
        expect(runtime.outputs.run.stdout).toContain('retry-ok');
    });

    it('should raise typed error for missing skills', async () => {
        engine = new SkillsEngine(storage, identity, skillsDir);
        await expect(engine.executeSkill('missing-skill', {})).rejects.toMatchObject({
            name: 'SkillExecutionError',
            code: 'not_found'
        });
    });
});
