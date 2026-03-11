/**
 * Society Protocol — Templates Module v1.0
 *
 * Predefined, battle-tested DAG templates for common collaborative tasks.
 * These provide deterministic execution paths without requiring AI planning.
 */

import { type CocDagNode } from './swp.js';

// ─── Types ──────────────────────────────────────────────────────

export interface Template {
    id: string;
    name: string;
    description: string;
    category: 'software' | 'research' | 'creative' | 'medical' | 'business' | 'generic';
    tags: string[];
    generate: (goal: string, options?: Record<string, unknown>) => CocDagNode[];
}

export interface TemplateRegistry {
    [id: string]: Template;
}

// ─── Template Definitions ───────────────────────────────────────

export const TEMPLATES: TemplateRegistry = {
    // ─── Software Development ───────────────────────────────────
    
    'software_feature': {
        id: 'software_feature',
        name: 'Software Feature Development',
        description: 'Complete SDLC: Design → Implement (FE/BE) → Review → Test → Deploy',
        category: 'software',
        tags: ['development', 'full-stack', 'ci/cd'],
        generate: (goal: string) => [
            {
                step_id: 'design_architecture',
                kind: 'task',
                title: 'Architecture & Design',
                description: `Design system architecture for: ${goal}. Define APIs, data models, and component structure.`,
                depends_on: [],
                requirements: { capabilities: ['architecture', 'system-design'] },
            },
            {
                step_id: 'implement_backend',
                kind: 'task',
                title: 'Backend Implementation',
                description: 'Implement server-side logic, APIs, and database integration.',
                depends_on: ['design_architecture'],
                requirements: { capabilities: ['backend', 'api-design'] },
            },
            {
                step_id: 'implement_frontend',
                kind: 'task',
                title: 'Frontend Implementation',
                description: 'Implement UI components, state management, and API integration.',
                depends_on: ['design_architecture'],
                requirements: { capabilities: ['frontend', 'ui-design'] },
            },
            {
                step_id: 'code_review',
                kind: 'review',
                title: 'Code Review',
                description: 'Review both frontend and backend implementations for quality, security, and best practices.',
                depends_on: ['implement_backend', 'implement_frontend'],
                requirements: { capabilities: ['code-review', 'security'] },
            },
            {
                step_id: 'integration_testing',
                kind: 'task',
                title: 'Integration Testing',
                description: 'Write and run integration tests for end-to-end flows.',
                depends_on: ['code_review'],
                requirements: { capabilities: ['testing', 'qa'] },
            },
            {
                step_id: 'deploy',
                kind: 'merge',
                title: 'Deploy to Production',
                description: 'Merge code, run CI/CD pipeline, and deploy to production.',
                depends_on: ['integration_testing'],
                requirements: { capabilities: ['devops', 'deployment'] },
            },
        ],
    },

    'bug_fix': {
        id: 'bug_fix',
        name: 'Bug Fix Pipeline',
        description: 'Investigate → Reproduce → Fix → Verify → Deploy',
        category: 'software',
        tags: ['bugfix', 'debugging', 'hotfix'],
        generate: (goal: string) => [
            {
                step_id: 'investigate',
                kind: 'task',
                title: 'Bug Investigation',
                description: `Investigate root cause of: ${goal}. Analyze logs, traces, and code.`,
                depends_on: [],
                requirements: { capabilities: ['debugging', 'analysis'] },
            },
            {
                step_id: 'reproduce',
                kind: 'task',
                title: 'Create Reproduction',
                description: 'Create minimal reproduction case or test that demonstrates the bug.',
                depends_on: ['investigate'],
                requirements: { capabilities: ['testing'] },
            },
            {
                step_id: 'implement_fix',
                kind: 'task',
                title: 'Implement Fix',
                description: 'Implement the fix with proper error handling.',
                depends_on: ['reproduce'],
                requirements: { capabilities: ['coding'] },
            },
            {
                step_id: 'review_fix',
                kind: 'review',
                title: 'Review Fix',
                description: 'Review fix for correctness and edge cases.',
                depends_on: ['implement_fix'],
                requirements: { capabilities: ['code-review'] },
            },
            {
                step_id: 'verify_fix',
                kind: 'verification',
                title: 'Verify Resolution',
                description: 'Confirm bug is fixed and no regressions introduced.',
                depends_on: ['review_fix'],
                requirements: { capabilities: ['qa'] },
            },
            {
                step_id: 'deploy_fix',
                kind: 'merge',
                title: 'Deploy Fix',
                description: 'Deploy the fix to production.',
                depends_on: ['verify_fix'],
                requirements: { capabilities: ['deployment'] },
            },
        ],
    },

    // ─── Research & Analysis ────────────────────────────────────

    'research_swarm': {
        id: 'research_swarm',
        name: 'Parallel Research Investigation',
        description: 'Divide topic into sub-domains, investigate in parallel, synthesize findings',
        category: 'research',
        tags: ['research', 'synthesis', 'parallel'],
        generate: (goal: string, options?: { domains?: number }) => {
            const numDomains = options?.domains || 3;
            const dag: CocDagNode[] = [
                {
                    step_id: 'scope_research',
                    kind: 'task',
                    title: 'Define Research Scope',
                    description: `Break down "${goal}" into ${numDomains} distinct investigation areas.`,
                    depends_on: [],
                    requirements: { capabilities: ['research', 'analysis'] },
                },
            ];

            // Generate parallel investigation tasks
            for (let i = 1; i <= numDomains; i++) {
                dag.push({
                    step_id: `investigate_domain_${i}`,
                    kind: 'task',
                    title: `Investigate Area ${i}`,
                    description: `Deep research on sub-domain ${i} of the topic.`,
                    depends_on: ['scope_research'],
                    requirements: { capabilities: ['research'] },
                });
            }

            const domainSteps = Array.from({ length: numDomains }, (_, i) => `investigate_domain_${i + 1}`);
            
            dag.push({
                step_id: 'cross_review',
                kind: 'review',
                title: 'Cross-Domain Review',
                description: 'Review findings for consistency and gaps across all domains.',
                depends_on: domainSteps,
                requirements: { capabilities: ['research', 'review'] },
            });

            dag.push({
                step_id: 'synthesize_findings',
                kind: 'synthesis',
                title: 'Synthesize Final Report',
                description: 'Combine all research into comprehensive, actionable report.',
                depends_on: ['cross_review'],
                requirements: { capabilities: ['writing', 'synthesis'] },
            });

            return dag;
        },
    },

    'literature_review': {
        id: 'literature_review',
        name: 'Academic Literature Review',
        description: 'Search → Screen → Extract → Synthesize → Report',
        category: 'research',
        tags: ['academic', 'papers', 'review'],
        generate: (goal: string) => [
            {
                step_id: 'search_papers',
                kind: 'task',
                title: 'Literature Search',
                description: `Search academic databases for papers on: ${goal}`,
                depends_on: [],
                requirements: { capabilities: ['research', 'academic-search'] },
            },
            {
                step_id: 'screen_papers',
                kind: 'task',
                title: 'Screen & Select',
                description: 'Apply inclusion/exclusion criteria to select relevant papers.',
                depends_on: ['search_papers'],
                requirements: { capabilities: ['analysis'] },
            },
            {
                step_id: 'extract_data',
                kind: 'task',
                title: 'Data Extraction',
                description: 'Extract key findings, methodologies, and data from selected papers.',
                depends_on: ['screen_papers'],
                requirements: { capabilities: ['analysis'] },
            },
            {
                step_id: 'quality_assessment',
                kind: 'review',
                title: 'Quality Assessment',
                description: 'Assess quality and bias risk of included studies.',
                depends_on: ['extract_data'],
                requirements: { capabilities: ['research', 'critical-analysis'] },
            },
            {
                step_id: 'synthesize_evidence',
                kind: 'synthesis',
                title: 'Evidence Synthesis',
                description: 'Synthesize findings across studies, identify patterns and gaps.',
                depends_on: ['quality_assessment'],
                requirements: { capabilities: ['synthesis', 'statistics'] },
            },
            {
                step_id: 'write_report',
                kind: 'merge',
                title: 'Write Review Paper',
                description: 'Write comprehensive literature review with citations.',
                depends_on: ['synthesize_evidence'],
                requirements: { capabilities: ['academic-writing'] },
            },
        ],
    },

    'literature_review_continuous': {
        id: 'literature_review_continuous',
        name: 'Continuous Scientific Literature Review',
        description: 'Scope update → Parallel search → Screening → Extraction → Contradiction scan → Dual review → Synthesis → Knowledge checkpoint',
        category: 'research',
        tags: ['academic', 'continuous', 'literature', 'scientific'],
        generate: (goal: string, options?: { domains?: number }) => {
            const domains = options?.domains || 4;
            const steps: CocDagNode[] = [
                {
                    step_id: 'scope_update',
                    kind: 'task',
                    title: 'Scope Update',
                    description: `Refine current scientific question, subdomains, and watchlist for: ${goal}`,
                    depends_on: [],
                    requirements: { capabilities: ['research', 'analysis'] },
                },
            ];

            for (let i = 1; i <= domains; i++) {
                steps.push(
                    {
                        step_id: `search_sources_parallel_${i}`,
                        kind: 'task',
                        title: `Search Sources ${i}`,
                        description: `Search scientific sources for subdomain ${i}.`,
                        depends_on: ['scope_update'],
                        requirements: { capabilities: ['research', 'academic-search'] },
                    },
                    {
                        step_id: `screen_relevance_parallel_${i}`,
                        kind: 'task',
                        title: `Screen Relevance ${i}`,
                        description: `Screen relevance and quality for subdomain ${i}.`,
                        depends_on: [`search_sources_parallel_${i}`],
                        requirements: { capabilities: ['analysis', 'triage'] },
                    },
                    {
                        step_id: `extract_evidence_parallel_${i}`,
                        kind: 'task',
                        title: `Extract Evidence ${i}`,
                        description: `Extract claims, methods, outcomes, and limitations for subdomain ${i}.`,
                        depends_on: [`screen_relevance_parallel_${i}`],
                        requirements: { capabilities: ['evidence-extraction', 'research'] },
                    }
                );
            }

            const extractionSteps = Array.from({ length: domains }, (_, index) => `extract_evidence_parallel_${index + 1}`);
            steps.push(
                {
                    step_id: 'contradiction_scan',
                    kind: 'task',
                    title: 'Contradiction Scan',
                    description: 'Identify conflicting claims and unresolved evidence across the corpus.',
                    depends_on: extractionSteps,
                    requirements: { capabilities: ['critical-analysis', 'research'] },
                },
                {
                    step_id: 'dual_review',
                    kind: 'review',
                    title: 'Dual Review',
                    description: 'Cross-review extracted evidence and contradiction analysis.',
                    depends_on: ['contradiction_scan'],
                    requirements: { capabilities: ['review', 'research'] },
                },
                {
                    step_id: 'synthesize_findings',
                    kind: 'synthesis',
                    title: 'Synthesize Findings',
                    description: 'Produce updated state-of-the-art synthesis with citations and gaps.',
                    depends_on: ['dual_review'],
                    requirements: { capabilities: ['synthesis', 'academic-writing'] },
                },
                {
                    step_id: 'knowledge_checkpoint',
                    kind: 'verification',
                    title: 'Knowledge Checkpoint',
                    description: 'Store cards, provenance, contradictions, and next watch triggers.',
                    depends_on: ['synthesize_findings'],
                    requirements: { capabilities: ['knowledge-management', 'verification'] },
                },
                {
                    step_id: 'monitor_triggers',
                    kind: 'merge',
                    title: 'Monitor Triggers',
                    description: 'Finalize the cycle and define what to monitor next.',
                    depends_on: ['knowledge_checkpoint'],
                    requirements: { capabilities: ['monitoring', 'synthesis'] },
                },
            );
            return steps;
        },
    },

    'hypothesis_swarm': {
        id: 'hypothesis_swarm',
        name: 'Scientific Hypothesis Swarm',
        description: 'Generate, attack, validate, and synthesize competing hypotheses in parallel',
        category: 'research',
        tags: ['hypothesis', 'scientific', 'parallel'],
        generate: (goal: string, options?: { domains?: number }) => {
            const branches = options?.domains || 4;
            const steps: CocDagNode[] = [
                {
                    step_id: 'frame_question',
                    kind: 'task',
                    title: 'Frame Research Question',
                    description: `Frame the core research question and evaluation criteria for: ${goal}`,
                    depends_on: [],
                    requirements: { capabilities: ['research', 'analysis'] },
                },
            ];
            for (let i = 1; i <= branches; i++) {
                steps.push(
                    {
                        step_id: `propose_hypothesis_${i}`,
                        kind: 'task',
                        title: `Propose Hypothesis ${i}`,
                        description: `Propose and motivate hypothesis branch ${i}.`,
                        depends_on: ['frame_question'],
                        requirements: { capabilities: ['hypothesis-generation', 'research'] },
                    },
                    {
                        step_id: `attack_hypothesis_${i}`,
                        kind: 'review',
                        title: `Attack Hypothesis ${i}`,
                        description: `Stress test hypothesis branch ${i} against contrary evidence.`,
                        depends_on: [`propose_hypothesis_${i}`],
                        requirements: { capabilities: ['critical-analysis', 'review'] },
                    }
                );
            }
            steps.push({
                step_id: 'synthesize_hypotheses',
                kind: 'merge',
                title: 'Synthesize Hypotheses',
                description: 'Rank competing hypotheses and identify best-supported paths.',
                depends_on: Array.from({ length: branches }, (_, index) => `attack_hypothesis_${index + 1}`),
                requirements: { capabilities: ['synthesis', 'research'] },
            });
            return steps;
        },
    },

    'research_monitor': {
        id: 'research_monitor',
        name: 'Scientific Research Monitor',
        description: 'Watch new papers, datasets, and evidence deltas over time',
        category: 'research',
        tags: ['monitoring', 'scientific', 'watchlist'],
        generate: (goal: string) => [
            {
                step_id: 'refresh_watchlist',
                kind: 'task',
                title: 'Refresh Watchlist',
                description: `Refresh source watchlist and alert criteria for: ${goal}`,
                depends_on: [],
                requirements: { capabilities: ['research', 'monitoring'] },
            },
            {
                step_id: 'scan_new_material',
                kind: 'task',
                title: 'Scan New Material',
                description: 'Scan for new papers, preprints, datasets, and major updates.',
                depends_on: ['refresh_watchlist'],
                requirements: { capabilities: ['research', 'monitoring'] },
            },
            {
                step_id: 'evaluate_delta',
                kind: 'review',
                title: 'Evaluate Delta',
                description: 'Decide what materially changes the state of the art.',
                depends_on: ['scan_new_material'],
                requirements: { capabilities: ['analysis', 'review'] },
            },
            {
                step_id: 'synthesize_delta',
                kind: 'merge',
                title: 'Synthesize Delta',
                description: 'Summarize changes, contradictions, and new opportunities for investigation.',
                depends_on: ['evaluate_delta'],
                requirements: { capabilities: ['synthesis', 'writing'] },
            },
        ],
    },

    // ─── Content Creation ───────────────────────────────────────

    'content_creation': {
        id: 'content_creation',
        name: 'Multi-Stage Content Pipeline',
        description: 'Outline → Draft → Review → Edit → Polish → Publish',
        category: 'creative',
        tags: ['writing', 'content', 'editorial'],
        generate: (goal: string) => [
            {
                step_id: 'create_outline',
                kind: 'task',
                title: 'Create Outline',
                description: `Develop detailed outline and structure for: ${goal}`,
                depends_on: [],
                requirements: { capabilities: ['planning', 'writing'] },
            },
            {
                step_id: 'write_draft',
                kind: 'task',
                title: 'Write First Draft',
                description: 'Write complete first draft based on outline.',
                depends_on: ['create_outline'],
                requirements: { capabilities: ['writing'] },
            },
            {
                step_id: 'content_review',
                kind: 'review',
                title: 'Content Review',
                description: 'Review for accuracy, clarity, and audience fit.',
                depends_on: ['write_draft'],
                requirements: { capabilities: ['editing', 'review'] },
            },
            {
                step_id: 'revise_content',
                kind: 'task',
                title: 'Revise & Improve',
                description: 'Incorporate feedback and improve the content.',
                depends_on: ['content_review'],
                requirements: { capabilities: ['writing', 'editing'] },
            },
            {
                step_id: 'copyedit',
                kind: 'review',
                title: 'Copy Editing',
                description: 'Fix grammar, style, and formatting issues.',
                depends_on: ['revise_content'],
                requirements: { capabilities: ['copyediting'] },
            },
            {
                step_id: 'final_polish',
                kind: 'merge',
                title: 'Final Polish & Publish',
                description: 'Final formatting and publish.',
                depends_on: ['copyedit'],
                requirements: { capabilities: ['publishing'] },
            },
        ],
    },

    // ─── Business & Strategy ────────────────────────────────────

    'strategic_analysis': {
        id: 'strategic_analysis',
        name: 'Strategic Business Analysis',
        description: 'Market → Competition → Capabilities → Strategy → Plan',
        category: 'business',
        tags: ['strategy', 'business', 'analysis'],
        generate: (goal: string) => [
            {
                step_id: 'market_analysis',
                kind: 'task',
                title: 'Market Analysis',
                description: `Analyze market size, trends, and dynamics for: ${goal}`,
                depends_on: [],
                requirements: { capabilities: ['market-research'] },
            },
            {
                step_id: 'competitive_analysis',
                kind: 'task',
                title: 'Competitive Analysis',
                description: 'Analyze competitors, their strengths and weaknesses.',
                depends_on: [],
                requirements: { capabilities: ['competitive-analysis'] },
            },
            {
                step_id: 'capability_assessment',
                kind: 'task',
                title: 'Internal Capabilities',
                description: 'Assess internal capabilities and gaps.',
                depends_on: [],
                requirements: { capabilities: ['business-analysis'] },
            },
            {
                step_id: 'synthesize_strategy',
                kind: 'synthesis',
                title: 'Strategy Formulation',
                description: 'Synthesize insights into strategic options.',
                depends_on: ['market_analysis', 'competitive_analysis', 'capability_assessment'],
                requirements: { capabilities: ['strategy'] },
            },
            {
                step_id: 'strategy_review',
                kind: 'review',
                title: 'Strategy Review',
                description: 'Review strategy for feasibility and risks.',
                depends_on: ['synthesize_strategy'],
                requirements: { capabilities: ['strategy', 'risk-analysis'] },
            },
            {
                step_id: 'implementation_plan',
                kind: 'merge',
                title: 'Implementation Roadmap',
                description: 'Create detailed implementation plan with milestones.',
                depends_on: ['strategy_review'],
                requirements: { capabilities: ['project-management'] },
            },
        ],
    },

    // ─── Medical / Healthcare ───────────────────────────────────

    'second_opinion': {
        id: 'second_opinion',
        name: 'Medical Second Opinion',
        description: 'Case Review → Differential Diagnosis → Recommendation',
        category: 'medical',
        tags: ['medical', 'diagnosis', 'healthcare'],
        generate: (goal: string) => [
            {
                step_id: 'extract_clinical_data',
                kind: 'task',
                title: 'Extract Clinical Data',
                description: `Extract structured clinical data from case: ${goal}`,
                depends_on: [],
                requirements: { capabilities: ['medical', 'data-extraction'] },
            },
            {
                step_id: 'literature_search',
                kind: 'task',
                title: 'Medical Literature Search',
                description: 'Search for relevant medical literature and guidelines.',
                depends_on: ['extract_clinical_data'],
                requirements: { capabilities: ['medical-research'] },
            },
            {
                step_id: 'differential_diagnosis',
                kind: 'task',
                title: 'Differential Diagnosis',
                description: 'Develop ranked differential diagnoses with reasoning.',
                depends_on: ['extract_clinical_data', 'literature_search'],
                requirements: { capabilities: ['diagnosis', 'medical'] },
            },
            {
                step_id: 'expert_review',
                kind: 'review',
                title: 'Expert Review',
                description: 'Review differential and recommendations for accuracy.',
                depends_on: ['differential_diagnosis'],
                requirements: { capabilities: ['medical', 'expert-review'], min_reputation: 0.8 },
            },
            {
                step_id: 'recommendations',
                kind: 'synthesis',
                title: 'Treatment Recommendations',
                description: 'Synthesize evidence-based treatment recommendations.',
                depends_on: ['expert_review'],
                requirements: { capabilities: ['medical', 'treatment-planning'] },
            },
            {
                step_id: 'final_report',
                kind: 'merge',
                title: 'Second Opinion Report',
                description: 'Compile comprehensive second opinion report.',
                depends_on: ['recommendations'],
                requirements: { capabilities: ['medical-reporting'] },
            },
        ],
    },

    // ─── Medical / Scientific ─────────────────────────────────

    'rare_disease_diagnosis': {
        id: 'rare_disease_diagnosis',
        name: 'Rare Disease Multi-Specialist Diagnosis',
        description: 'Parallel specialist analysis (genetics, neurology, immunology, metabolism) → cross-correlation → consensus diagnosis',
        category: 'medical',
        tags: ['rare-disease', 'diagnosis', 'multi-specialist', 'genetics', 'parallel'],
        generate: (goal: string, options?: { specialists?: string[] }) => {
            const specialists = options?.specialists || [
                'genetics',
                'neurology',
                'immunology',
                'metabolic',
            ];
            const steps: CocDagNode[] = [
                {
                    step_id: 'intake_structured',
                    kind: 'task',
                    title: 'Structured Case Intake',
                    description: `Extract structured clinical data, phenotype ontology (HPO terms), family history, lab results, imaging, and prior workup for: ${goal}`,
                    depends_on: [],
                    requirements: { capabilities: ['medical', 'data-extraction', 'phenotyping'] },
                },
                {
                    step_id: 'literature_scan',
                    kind: 'task',
                    title: 'Rare Disease Literature Scan',
                    description: 'Search OMIM, Orphanet, PubMed, ClinVar, and DECIPHER for matching phenotype/genotype patterns.',
                    depends_on: ['intake_structured'],
                    requirements: { capabilities: ['medical-research', 'rare-disease'] },
                },
            ];

            // Parallel specialist analysis
            for (const spec of specialists) {
                steps.push({
                    step_id: `specialist_${spec}`,
                    kind: 'task',
                    title: `${spec.charAt(0).toUpperCase() + spec.slice(1)} Specialist Analysis`,
                    description: `${spec} domain analysis: differential diagnosis from ${spec} perspective, relevant biomarkers, recommended tests.`,
                    depends_on: ['intake_structured', 'literature_scan'],
                    requirements: {
                        capabilities: ['medical', spec, 'diagnosis'],
                        min_reputation: 0.7,
                    },
                });
            }

            const specialistSteps = specialists.map(s => `specialist_${s}`);

            steps.push(
                {
                    step_id: 'cross_correlation',
                    kind: 'task',
                    title: 'Cross-Specialist Correlation',
                    description: 'Correlate findings across specialties. Identify overlapping differential diagnoses, contradictions, and synergistic evidence.',
                    depends_on: specialistSteps,
                    requirements: { capabilities: ['medical', 'cross-domain-analysis'] },
                },
                {
                    step_id: 'genetic_variant_analysis',
                    kind: 'task',
                    title: 'Genetic Variant Prioritization',
                    description: 'If genomic data available, prioritize candidate variants using ACMG criteria, phenotype match scores, and allele frequency.',
                    depends_on: ['cross_correlation'],
                    requirements: { capabilities: ['genetics', 'bioinformatics', 'variant-analysis'] },
                },
                {
                    step_id: 'consensus_review',
                    kind: 'review',
                    title: 'Multi-Disciplinary Consensus Review',
                    description: 'Virtual tumor-board style review: rank differential diagnoses by evidence strength, propose confirmatory tests.',
                    depends_on: ['genetic_variant_analysis'],
                    requirements: {
                        capabilities: ['medical', 'consensus-building'],
                        min_reputation: 0.8,
                    },
                },
                {
                    step_id: 'diagnostic_report',
                    kind: 'synthesis',
                    title: 'Diagnostic Report',
                    description: 'Synthesize evidence-based diagnostic report with ranked differentials, recommended next steps, and management considerations.',
                    depends_on: ['consensus_review'],
                    requirements: { capabilities: ['medical-reporting', 'synthesis'] },
                },
                {
                    step_id: 'knowledge_capture',
                    kind: 'merge',
                    title: 'Knowledge Capture & Provenance',
                    description: 'Store diagnostic reasoning chain as knowledge cards with full provenance for future case matching.',
                    depends_on: ['diagnostic_report'],
                    requirements: { capabilities: ['knowledge-management'] },
                },
            );

            return steps;
        },
    },

    'clinical_trial_monitor': {
        id: 'clinical_trial_monitor',
        name: 'Distributed Clinical Trial Monitor',
        description: 'Multi-site safety surveillance → efficacy tracking → adverse event detection → regulatory reporting',
        category: 'medical',
        tags: ['clinical-trial', 'monitoring', 'safety', 'pharmacovigilance', 'distributed'],
        generate: (goal: string, options?: { sites?: number }) => {
            const sites = options?.sites || 3;
            const steps: CocDagNode[] = [
                {
                    step_id: 'protocol_ingest',
                    kind: 'task',
                    title: 'Protocol Ingestion',
                    description: `Ingest and parse clinical trial protocol, endpoints, and safety criteria for: ${goal}`,
                    depends_on: [],
                    requirements: { capabilities: ['clinical-trial', 'protocol-analysis'] },
                },
            ];

            // Parallel per-site monitoring
            for (let i = 1; i <= sites; i++) {
                steps.push(
                    {
                        step_id: `site_${i}_data_collection`,
                        kind: 'task',
                        title: `Site ${i} Data Collection`,
                        description: `Collect and validate data from trial site ${i}: enrollment, dosing, labs, AEs.`,
                        depends_on: ['protocol_ingest'],
                        requirements: { capabilities: ['data-collection', 'clinical-trial'] },
                    },
                    {
                        step_id: `site_${i}_safety_scan`,
                        kind: 'task',
                        title: `Site ${i} Safety Scan`,
                        description: `Screen site ${i} data for adverse events, protocol deviations, and safety signals.`,
                        depends_on: [`site_${i}_data_collection`],
                        requirements: { capabilities: ['pharmacovigilance', 'safety-monitoring'] },
                    },
                );
            }

            const safetySteps = Array.from({ length: sites }, (_, i) => `site_${i + 1}_safety_scan`);

            steps.push(
                {
                    step_id: 'aggregate_safety',
                    kind: 'task',
                    title: 'Aggregate Safety Analysis',
                    description: 'Aggregate cross-site safety data. Run signal detection algorithms (PRR, ROR, BCPNN).',
                    depends_on: safetySteps,
                    requirements: { capabilities: ['pharmacovigilance', 'statistics', 'signal-detection'] },
                },
                {
                    step_id: 'efficacy_interim',
                    kind: 'task',
                    title: 'Interim Efficacy Assessment',
                    description: 'Assess primary and secondary endpoints against statistical analysis plan.',
                    depends_on: safetySteps,
                    requirements: { capabilities: ['biostatistics', 'clinical-trial'] },
                },
                {
                    step_id: 'dsmb_review',
                    kind: 'review',
                    title: 'DSMB Review Package',
                    description: 'Prepare Data Safety Monitoring Board review: safety tables, Kaplan-Meier, futility analysis.',
                    depends_on: ['aggregate_safety', 'efficacy_interim'],
                    requirements: {
                        capabilities: ['dsmb', 'biostatistics', 'regulatory'],
                        min_reputation: 0.85,
                    },
                },
                {
                    step_id: 'regulatory_report',
                    kind: 'synthesis',
                    title: 'Regulatory Report',
                    description: 'Generate CIOMS/MedWatch-compatible safety report and IND safety update.',
                    depends_on: ['dsmb_review'],
                    requirements: { capabilities: ['regulatory-writing', 'pharmacovigilance'] },
                },
                {
                    step_id: 'trial_checkpoint',
                    kind: 'merge',
                    title: 'Trial Monitoring Checkpoint',
                    description: 'Finalize monitoring cycle: archive data, update risk assessment, schedule next review.',
                    depends_on: ['regulatory_report'],
                    requirements: { capabilities: ['clinical-trial', 'project-management'] },
                },
            );

            return steps;
        },
    },

    'drug_interaction_analysis': {
        id: 'drug_interaction_analysis',
        name: 'Multi-Agent Drug Interaction Analysis',
        description: 'Parallel pharmacology analysis → interaction matrix → clinical risk assessment → patient-specific recommendations',
        category: 'medical',
        tags: ['pharmacology', 'drug-interaction', 'polypharmacy', 'patient-safety'],
        generate: (goal: string) => [
            {
                step_id: 'medication_extraction',
                kind: 'task',
                title: 'Medication Profile Extraction',
                description: `Extract complete medication list, dosages, routes, and schedules for: ${goal}`,
                depends_on: [],
                requirements: { capabilities: ['medical', 'pharmacology'] },
            },
            {
                step_id: 'pk_analysis',
                kind: 'task',
                title: 'Pharmacokinetic Analysis',
                description: 'Analyze CYP450 metabolism pathways, inhibitors/inducers, and PK interactions for each drug pair.',
                depends_on: ['medication_extraction'],
                requirements: { capabilities: ['pharmacokinetics', 'cyp450'] },
            },
            {
                step_id: 'pd_analysis',
                kind: 'task',
                title: 'Pharmacodynamic Analysis',
                description: 'Analyze receptor-level interactions, additive/synergistic/antagonistic effects.',
                depends_on: ['medication_extraction'],
                requirements: { capabilities: ['pharmacodynamics', 'pharmacology'] },
            },
            {
                step_id: 'literature_evidence',
                kind: 'task',
                title: 'Literature Evidence Search',
                description: 'Search DrugBank, Lexicomp, and PubMed for reported interaction evidence and case reports.',
                depends_on: ['medication_extraction'],
                requirements: { capabilities: ['medical-research', 'pharmacology'] },
            },
            {
                step_id: 'interaction_matrix',
                kind: 'task',
                title: 'Build Interaction Matrix',
                description: 'Combine PK, PD, and literature evidence into a scored interaction matrix with severity levels.',
                depends_on: ['pk_analysis', 'pd_analysis', 'literature_evidence'],
                requirements: { capabilities: ['pharmacology', 'analysis'] },
            },
            {
                step_id: 'clinical_risk_review',
                kind: 'review',
                title: 'Clinical Risk Assessment',
                description: 'Review interactions for clinical significance. Factor in patient comorbidities, renal/hepatic function, and age.',
                depends_on: ['interaction_matrix'],
                requirements: {
                    capabilities: ['clinical-pharmacology', 'risk-assessment'],
                    min_reputation: 0.75,
                },
            },
            {
                step_id: 'recommendations',
                kind: 'synthesis',
                title: 'Intervention Recommendations',
                description: 'Propose dose adjustments, alternative agents, monitoring plans, and deprescribing opportunities.',
                depends_on: ['clinical_risk_review'],
                requirements: { capabilities: ['pharmacology', 'treatment-planning'] },
            },
            {
                step_id: 'final_report',
                kind: 'merge',
                title: 'Interaction Analysis Report',
                description: 'Compile patient-friendly and clinician-facing interaction reports with evidence levels.',
                depends_on: ['recommendations'],
                requirements: { capabilities: ['medical-reporting'] },
            },
        ],
    },

    'epidemiological_investigation': {
        id: 'epidemiological_investigation',
        name: 'Epidemiological Outbreak Investigation',
        description: 'Surveillance → case identification → contact tracing → statistical analysis → public health response',
        category: 'medical',
        tags: ['epidemiology', 'outbreak', 'public-health', 'surveillance', 'investigation'],
        generate: (goal: string) => [
            {
                step_id: 'initial_surveillance',
                kind: 'task',
                title: 'Surveillance Data Collection',
                description: `Collect epidemiological surveillance data, case reports, and syndromic data for: ${goal}`,
                depends_on: [],
                requirements: { capabilities: ['epidemiology', 'surveillance'] },
            },
            {
                step_id: 'case_definition',
                kind: 'task',
                title: 'Case Definition & Identification',
                description: 'Establish confirmed/probable/suspected case definitions. Identify and classify cases.',
                depends_on: ['initial_surveillance'],
                requirements: { capabilities: ['epidemiology', 'case-definition'] },
            },
            {
                step_id: 'descriptive_epi',
                kind: 'task',
                title: 'Descriptive Epidemiology',
                description: 'Characterize outbreak by person, place, time. Create epidemic curve, attack rate, and spatial distribution.',
                depends_on: ['case_definition'],
                requirements: { capabilities: ['epidemiology', 'biostatistics'] },
            },
            {
                step_id: 'hypothesis_generation',
                kind: 'task',
                title: 'Hypothesis Generation',
                description: 'Generate hypotheses about source, mode of transmission, and risk factors.',
                depends_on: ['descriptive_epi'],
                requirements: { capabilities: ['epidemiology', 'hypothesis-generation'] },
            },
            {
                step_id: 'analytical_study',
                kind: 'task',
                title: 'Analytical Study Design',
                description: 'Design case-control or cohort study to test hypotheses. Calculate sample size and power.',
                depends_on: ['hypothesis_generation'],
                requirements: { capabilities: ['epidemiology', 'study-design', 'biostatistics'] },
            },
            {
                step_id: 'lab_investigation',
                kind: 'task',
                title: 'Laboratory Investigation',
                description: 'Coordinate specimen collection, molecular typing, and environmental sampling.',
                depends_on: ['case_definition'],
                requirements: { capabilities: ['microbiology', 'laboratory'] },
            },
            {
                step_id: 'epi_review',
                kind: 'review',
                title: 'Epidemiological Review',
                description: 'Review analytical results, lab findings, and assess evidence strength for each hypothesis.',
                depends_on: ['analytical_study', 'lab_investigation'],
                requirements: {
                    capabilities: ['epidemiology', 'review'],
                    min_reputation: 0.8,
                },
            },
            {
                step_id: 'response_plan',
                kind: 'synthesis',
                title: 'Public Health Response Plan',
                description: 'Synthesize control measures, communication plan, and ongoing surveillance strategy.',
                depends_on: ['epi_review'],
                requirements: { capabilities: ['public-health', 'response-planning'] },
            },
            {
                step_id: 'situation_report',
                kind: 'merge',
                title: 'Situation Report',
                description: 'Compile situation report with findings, response actions, and recommendations for stakeholders.',
                depends_on: ['response_plan'],
                requirements: { capabilities: ['reporting', 'public-health'] },
            },
        ],
    },

    // ─── Generic ────────────────────────────────────────────────

    'simple_task': {
        id: 'simple_task',
        name: 'Simple Task with Review',
        description: 'Execute → Review → Finalize',
        category: 'generic',
        tags: ['simple', 'basic'],
        generate: (goal: string) => [
            {
                step_id: 'execute',
                kind: 'task',
                title: 'Execute Task',
                description: goal,
                depends_on: [],
            },
            {
                step_id: 'review',
                kind: 'review',
                title: 'Review Output',
                description: 'Review the output for quality and correctness.',
                depends_on: ['execute'],
            },
            {
                step_id: 'finalize',
                kind: 'merge',
                title: 'Finalize',
                description: 'Incorporate feedback and finalize.',
                depends_on: ['review'],
            },
        ],
    },

    'parallel_execution': {
        id: 'parallel_execution',
        name: 'Parallel Task Execution',
        description: 'Split → Execute in parallel → Merge results',
        category: 'generic',
        tags: ['parallel', 'divide-and-conquer'],
        generate: (goal: string, options?: { subtasks?: number }) => {
            const numSubtasks = options?.subtasks || 3;
            const dag: CocDagNode[] = [];

            // Create parallel tasks
            for (let i = 1; i <= numSubtasks; i++) {
                dag.push({
                    step_id: `subtask_${i}`,
                    kind: 'task',
                    title: `Subtask ${i}`,
                    description: `Part ${i} of: ${goal}`,
                    depends_on: [],
                });
            }

            const subtaskIds = Array.from({ length: numSubtasks }, (_, i) => `subtask_${i + 1}`);

            dag.push({
                step_id: 'merge_results',
                kind: 'merge',
                title: 'Merge Results',
                description: 'Combine all partial results into final output.',
                depends_on: subtaskIds,
            });

            return dag;
        },
    },
};

// ─── Helper Functions ───────────────────────────────────────────

export function getTemplate(id: string): Template {
    const template = TEMPLATES[id];
    if (!template) {
        throw new Error(
            `Unknown template: "${id}". ` +
            `Available: ${Object.keys(TEMPLATES).join(', ')}`
        );
    }
    return template;
}

export function listTemplates(category?: Template['category']): Template[] {
    const templates = Object.values(TEMPLATES);
    if (category) {
        return templates.filter(t => t.category === category);
    }
    return templates;
}

export function searchTemplates(query: string): Template[] {
    const lowerQuery = query.toLowerCase();
    return Object.values(TEMPLATES).filter(t =>
        t.id.includes(lowerQuery) ||
        t.name.toLowerCase().includes(lowerQuery) ||
        t.description.toLowerCase().includes(lowerQuery) ||
        t.tags.some(tag => tag.includes(lowerQuery))
    );
}

export function getTemplateCategories(): Template['category'][] {
    const categories = new Set<Template['category']>();
    Object.values(TEMPLATES).forEach(t => categories.add(t.category));
    return Array.from(categories);
}

export function validateTemplateDag(templateId: string, dag: CocDagNode[]): boolean {
    // Check for duplicate IDs
    const ids = new Set<string>();
    for (const step of dag) {
        if (ids.has(step.step_id)) {
            console.error(`Template ${templateId}: Duplicate step_id ${step.step_id}`);
            return false;
        }
        ids.add(step.step_id);
    }

    // Check dependencies exist
    for (const step of dag) {
        for (const dep of step.depends_on) {
            if (!ids.has(dep)) {
                console.error(`Template ${templateId}: Step ${step.step_id} depends on unknown ${dep}`);
                return false;
            }
        }
    }

    // Check for cycles using DFS
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const nodeMap = new Map(dag.map(n => [n.step_id, n]));

    const visit = (nodeId: string): boolean => {
        if (visiting.has(nodeId)) return false;
        if (visited.has(nodeId)) return true;

        visiting.add(nodeId);
        const node = nodeMap.get(nodeId);
        if (node) {
            for (const dep of node.depends_on) {
                if (!visit(dep)) return false;
            }
        }
        visiting.delete(nodeId);
        visited.add(nodeId);
        return true;
    };

    for (const node of dag) {
        if (!visit(node.step_id)) {
            console.error(`Template ${templateId}: Cycle detected`);
            return false;
        }
    }

    return true;
}

// Validate all templates on load
for (const [id, template] of Object.entries(TEMPLATES)) {
    // Test with a dummy goal
    const testDag = template.generate('test goal');
    if (!validateTemplateDag(id, testDag)) {
        console.error(`Template validation failed: ${id}`);
    }
}
