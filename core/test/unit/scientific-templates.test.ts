/**
 * Tests for Scientific/Medical Templates
 */

import { describe, it, expect } from 'vitest';
import {
    TEMPLATES,
    getTemplate,
    listTemplates,
    searchTemplates,
    validateTemplateDag,
} from '../../src/templates.js';

describe('Scientific Templates', () => {
    // ─── Rare Disease Diagnosis ──────────────────────────────────

    describe('rare_disease_diagnosis', () => {
        it('should exist and have correct metadata', () => {
            const t = getTemplate('rare_disease_diagnosis');
            expect(t.category).toBe('medical');
            expect(t.tags).toContain('rare-disease');
            expect(t.tags).toContain('multi-specialist');
        });

        it('should generate valid DAG with default specialists', () => {
            const dag = getTemplate('rare_disease_diagnosis').generate('Patient with unexplained myopathy');
            expect(validateTemplateDag('rare_disease_diagnosis', dag)).toBe(true);

            // Should have: intake, lit scan, 4 specialists, cross-correlation, variant, consensus, report, knowledge
            expect(dag.length).toBe(11);

            // Verify specialist steps
            const specialistSteps = dag.filter(s => s.step_id.startsWith('specialist_'));
            expect(specialistSteps.length).toBe(4);
            expect(specialistSteps.map(s => s.step_id)).toContain('specialist_genetics');
            expect(specialistSteps.map(s => s.step_id)).toContain('specialist_neurology');
            expect(specialistSteps.map(s => s.step_id)).toContain('specialist_immunology');
            expect(specialistSteps.map(s => s.step_id)).toContain('specialist_metabolic');
        });

        it('should accept custom specialist list', () => {
            const dag = getTemplate('rare_disease_diagnosis').generate('Rare cardiac phenotype', {
                specialists: ['cardiology', 'genetics', 'pathology'],
            });
            expect(validateTemplateDag('rare_disease_diagnosis', dag)).toBe(true);

            const specialistSteps = dag.filter(s => s.step_id.startsWith('specialist_'));
            expect(specialistSteps.length).toBe(3);
            expect(specialistSteps.map(s => s.step_id)).toContain('specialist_cardiology');
        });

        it('should have parallel specialist execution', () => {
            const dag = getTemplate('rare_disease_diagnosis').generate('test');
            const genetics = dag.find(s => s.step_id === 'specialist_genetics')!;
            const neurology = dag.find(s => s.step_id === 'specialist_neurology')!;

            // Both depend on intake + lit scan, not on each other
            expect(genetics.depends_on).toContain('intake_structured');
            expect(genetics.depends_on).toContain('literature_scan');
            expect(neurology.depends_on).toContain('intake_structured');
            expect(neurology.depends_on).toContain('literature_scan');
            expect(genetics.depends_on).not.toContain('specialist_neurology');
        });

        it('should require high reputation for consensus review', () => {
            const dag = getTemplate('rare_disease_diagnosis').generate('test');
            const consensus = dag.find(s => s.step_id === 'consensus_review')!;
            expect(consensus.requirements?.min_reputation).toBeGreaterThanOrEqual(0.8);
        });

        it('should include genetic variant analysis', () => {
            const dag = getTemplate('rare_disease_diagnosis').generate('test');
            const variant = dag.find(s => s.step_id === 'genetic_variant_analysis')!;
            expect(variant).toBeDefined();
            expect(variant.requirements?.capabilities).toContain('bioinformatics');
        });

        it('should end with knowledge capture', () => {
            const dag = getTemplate('rare_disease_diagnosis').generate('test');
            const last = dag[dag.length - 1];
            expect(last.step_id).toBe('knowledge_capture');
            expect(last.kind).toBe('merge');
        });

        it('should include goal in intake description', () => {
            const dag = getTemplate('rare_disease_diagnosis').generate('Undiagnosed mitochondrial disorder');
            const intake = dag.find(s => s.step_id === 'intake_structured')!;
            expect(intake.description).toContain('mitochondrial disorder');
        });
    });

    // ─── Clinical Trial Monitor ──────────────────────────────────

    describe('clinical_trial_monitor', () => {
        it('should exist and have correct metadata', () => {
            const t = getTemplate('clinical_trial_monitor');
            expect(t.category).toBe('medical');
            expect(t.tags).toContain('clinical-trial');
            expect(t.tags).toContain('pharmacovigilance');
        });

        it('should generate valid DAG with default 3 sites', () => {
            const dag = getTemplate('clinical_trial_monitor').generate('Phase III oncology trial');
            expect(validateTemplateDag('clinical_trial_monitor', dag)).toBe(true);

            // protocol + 3*(data+safety) + aggregate + efficacy + dsmb + regulatory + checkpoint
            expect(dag.length).toBe(12);
        });

        it('should scale with custom site count', () => {
            const dag = getTemplate('clinical_trial_monitor').generate('test', { sites: 5 });
            expect(validateTemplateDag('clinical_trial_monitor', dag)).toBe(true);

            const siteSteps = dag.filter(s => s.step_id.startsWith('site_'));
            expect(siteSteps.length).toBe(10); // 5 data + 5 safety
        });

        it('should have parallel per-site monitoring', () => {
            const dag = getTemplate('clinical_trial_monitor').generate('test', { sites: 3 });
            const site1 = dag.find(s => s.step_id === 'site_1_data_collection')!;
            const site2 = dag.find(s => s.step_id === 'site_2_data_collection')!;

            // Sites run in parallel, both depend only on protocol
            expect(site1.depends_on).toEqual(['protocol_ingest']);
            expect(site2.depends_on).toEqual(['protocol_ingest']);
        });

        it('should require high reputation for DSMB review', () => {
            const dag = getTemplate('clinical_trial_monitor').generate('test');
            const dsmb = dag.find(s => s.step_id === 'dsmb_review')!;
            expect(dsmb.requirements?.min_reputation).toBeGreaterThanOrEqual(0.85);
        });

        it('should include regulatory reporting capabilities', () => {
            const dag = getTemplate('clinical_trial_monitor').generate('test');
            const reg = dag.find(s => s.step_id === 'regulatory_report')!;
            expect(reg.requirements?.capabilities).toContain('regulatory-writing');
            expect(reg.requirements?.capabilities).toContain('pharmacovigilance');
        });
    });

    // ─── Drug Interaction Analysis ───────────────────────────────

    describe('drug_interaction_analysis', () => {
        it('should exist and have correct metadata', () => {
            const t = getTemplate('drug_interaction_analysis');
            expect(t.category).toBe('medical');
            expect(t.tags).toContain('pharmacology');
            expect(t.tags).toContain('drug-interaction');
        });

        it('should generate valid DAG', () => {
            const dag = getTemplate('drug_interaction_analysis').generate('Elderly patient on 8 medications');
            expect(validateTemplateDag('drug_interaction_analysis', dag)).toBe(true);
            expect(dag.length).toBe(8);
        });

        it('should have parallel PK/PD/literature analysis', () => {
            const dag = getTemplate('drug_interaction_analysis').generate('test');
            const pk = dag.find(s => s.step_id === 'pk_analysis')!;
            const pd = dag.find(s => s.step_id === 'pd_analysis')!;
            const lit = dag.find(s => s.step_id === 'literature_evidence')!;

            // All three depend on medication_extraction only
            expect(pk.depends_on).toEqual(['medication_extraction']);
            expect(pd.depends_on).toEqual(['medication_extraction']);
            expect(lit.depends_on).toEqual(['medication_extraction']);
        });

        it('should converge into interaction matrix', () => {
            const dag = getTemplate('drug_interaction_analysis').generate('test');
            const matrix = dag.find(s => s.step_id === 'interaction_matrix')!;
            expect(matrix.depends_on).toContain('pk_analysis');
            expect(matrix.depends_on).toContain('pd_analysis');
            expect(matrix.depends_on).toContain('literature_evidence');
        });

        it('should include CYP450 capability', () => {
            const dag = getTemplate('drug_interaction_analysis').generate('test');
            const pk = dag.find(s => s.step_id === 'pk_analysis')!;
            expect(pk.requirements?.capabilities).toContain('cyp450');
        });
    });

    // ─── Epidemiological Investigation ───────────────────────────

    describe('epidemiological_investigation', () => {
        it('should exist and have correct metadata', () => {
            const t = getTemplate('epidemiological_investigation');
            expect(t.category).toBe('medical');
            expect(t.tags).toContain('epidemiology');
            expect(t.tags).toContain('outbreak');
        });

        it('should generate valid DAG', () => {
            const dag = getTemplate('epidemiological_investigation').generate('Cluster of Legionella cases');
            expect(validateTemplateDag('epidemiological_investigation', dag)).toBe(true);
            expect(dag.length).toBe(9);
        });

        it('should have parallel analytical and lab tracks', () => {
            const dag = getTemplate('epidemiological_investigation').generate('test');
            const analytical = dag.find(s => s.step_id === 'analytical_study')!;
            const lab = dag.find(s => s.step_id === 'lab_investigation')!;

            // Analytical depends on hypothesis, lab depends on case_definition
            // They don't depend on each other
            expect(analytical.depends_on).toContain('hypothesis_generation');
            expect(lab.depends_on).toContain('case_definition');
            expect(analytical.depends_on).not.toContain('lab_investigation');
            expect(lab.depends_on).not.toContain('analytical_study');
        });

        it('should require high reputation for epi review', () => {
            const dag = getTemplate('epidemiological_investigation').generate('test');
            const review = dag.find(s => s.step_id === 'epi_review')!;
            expect(review.requirements?.min_reputation).toBeGreaterThanOrEqual(0.8);
        });

        it('should converge to public health response', () => {
            const dag = getTemplate('epidemiological_investigation').generate('test');
            const response = dag.find(s => s.step_id === 'response_plan')!;
            expect(response.kind).toBe('synthesis');
            expect(response.requirements?.capabilities).toContain('public-health');
        });
    });

    // ─── Template Registry ───────────────────────────────────────

    describe('Template Registry', () => {
        it('should have all medical templates', () => {
            const medicalTemplates = listTemplates('medical');
            const ids = medicalTemplates.map(t => t.id);
            expect(ids).toContain('second_opinion');
            expect(ids).toContain('rare_disease_diagnosis');
            expect(ids).toContain('clinical_trial_monitor');
            expect(ids).toContain('drug_interaction_analysis');
            expect(ids).toContain('epidemiological_investigation');
            expect(medicalTemplates.length).toBe(5);
        });

        it('should find templates by search', () => {
            const results = searchTemplates('rare disease');
            expect(results.some(t => t.id === 'rare_disease_diagnosis')).toBe(true);
        });

        it('should find templates by tag', () => {
            const results = searchTemplates('pharmacovigilance');
            expect(results.some(t => t.id === 'clinical_trial_monitor')).toBe(true);
        });

        it('should validate all templates', () => {
            for (const [id, template] of Object.entries(TEMPLATES)) {
                const dag = template.generate('validation test');
                expect(validateTemplateDag(id, dag)).toBe(true);
            }
        });

        it('should have no duplicate step IDs within any template', () => {
            for (const [id, template] of Object.entries(TEMPLATES)) {
                const dag = template.generate('uniqueness test');
                const ids = dag.map(s => s.step_id);
                const uniqueIds = new Set(ids);
                expect(uniqueIds.size).toBe(ids.length);
            }
        });
    });
});
