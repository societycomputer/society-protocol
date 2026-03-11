/**
 * Rare Disease Research Scenario
 *
 * Creates a realistic multi-hospital federation for rare disease diagnosis,
 * populating the dashboard with federations, chains, missions, knowledge cards,
 * and multiple hospital agents.
 *
 * Usage: npx tsx scripts/rare-disease-scenario.ts
 */

import { createClient, type SocietyClient } from 'society-core/sdk';

const ROOM = 'dev';

// ─── Hospital Agent Definitions ──────────────────────────────────

interface HospitalSpec {
  name: string;
  specialties: string[];
  port: number;
}

const HOSPITALS: HospitalSpec[] = [
  {
    name: 'Hospital-São-Paulo',
    specialties: ['genetics', 'neurology', 'metabolism', 'rare-diseases'],
    port: 9200,
  },
  {
    name: 'Hospital-Tokyo',
    specialties: ['immunology', 'genomics', 'pharmacogenomics', 'clinical-trials'],
    port: 9202,
  },
  {
    name: 'Hospital-Berlin',
    specialties: ['neurology', 'pathology', 'bioinformatics', 'epidemiology'],
    port: 9204,
  },
];

const clients: SocietyClient[] = [];

// ─── Helpers ─────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function spawnHospital(spec: HospitalSpec): Promise<SocietyClient> {
  const client = await createClient({
    identity: { name: spec.name },
    storage: { path: undefined },
    network: {
      port: spec.port,
      enableGossipsub: true,
      enableDht: true,
    },
    proactive: {
      enableLeadership: true,
    },
  });

  await client.joinRoom(ROOM);
  const id = client.getIdentity();
  console.log(`  [${spec.name}] Online — DID: ${id.did.slice(0, 40)}...`);
  return client;
}

// ─── Main Scenario ───────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Rare Disease Research — Multi-Hospital Test ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // 1. Spawn hospital agents
  console.log('1. Spawning hospital agents...');
  for (const spec of HOSPITALS) {
    try {
      const client = await spawnHospital(spec);
      clients.push(client);
      await sleep(300);
    } catch (err: any) {
      console.error(`   [${spec.name}] Failed: ${err.message}`);
    }
  }
  console.log(`   ${clients.length} hospitals online.\n`);

  if (clients.length === 0) {
    console.error('No hospitals started. Exiting.');
    process.exit(1);
  }

  const lead = clients[0]; // Hospital-São-Paulo leads

  // 2. Create Federation: "Rare Disease Research Consortium"
  console.log('2. Creating federation: Rare Disease Research Consortium...');
  try {
    const fed = await lead.createFederation(
      'Rare Disease Research Consortium',
      'Multi-hospital federation for collaborative diagnosis and research of rare diseases. Members share anonymized case data, genomic findings, and treatment protocols.',
      'private',
    );
    console.log(`   Federation created: ${fed.id}`);

    // Other hospitals join the federation (same node, works with in-memory)
    for (let i = 1; i < clients.length; i++) {
      try {
        await clients[i].joinFederation(fed.id);
        console.log(`   ${HOSPITALS[i].name} joined federation.`);
      } catch {
        // In-memory mode: each client has isolated federation state
        // Create federation in each client so dashboard shows it
        await clients[i].createFederation(
          `Hospital ${HOSPITALS[i].name} — Rare Disease`,
          `Local federation node for ${HOSPITALS[i].name}`,
          'private',
        );
        console.log(`   ${HOSPITALS[i].name} created local federation.`);
      }
    }
  } catch (err: any) {
    console.error(`   Federation error: ${err.message}`);
  }

  // 3. Create Knowledge Space and Cards
  console.log('\n3. Creating knowledge space and cards...');
  try {
    const space = await lead.createKnowledgeSpace(
      'Rare Disease Knowledge Base',
      'Shared knowledge base for rare disease research, including case studies, genetic variants, and treatment protocols.',
      'team',
    );
    console.log(`   Knowledge space: ${space.id}`);

    // Create knowledge cards
    const cards = [
      {
        type: 'fact',
        title: 'Ehlers-Danlos Syndrome — Type Identification',
        content: 'EDS Type vascular (vEDS) caused by COL3A1 mutations. Prevalence: 1 in 50,000-200,000. Diagnosis requires genetic testing and clinical evaluation of skin hyperextensibility, joint hypermobility, and tissue fragility.',
        options: {
          summary: 'COL3A1 mutations cause vascular EDS; prevalence 1:50k-200k',
          tags: ['eds', 'collagen', 'genetics', 'vascular'],
          domain: ['genetics', 'rare-diseases'],
          confidence: 0.95,
        },
      },
      {
        type: 'hypothesis',
        title: 'Novel MTHFR Variant — Potential Link to Neurological Symptoms',
        content: 'Patient cohort (n=12) across 3 hospitals presents with similar neurological symptoms and a novel MTHFR variant (c.1298A>C homozygous + c.677C>T heterozygous compound). Hypothesis: this compound variant may affect folate metabolism differently than known single variants.',
        options: {
          summary: 'Novel compound MTHFR variant may explain neurological symptoms in cohort of 12 patients',
          tags: ['mthfr', 'folate', 'neurology', 'compound-variant'],
          domain: ['genetics', 'neurology'],
          confidence: 0.6,
        },
      },
      {
        type: 'evidence',
        title: 'CYP2D6 Poor Metabolizer Status in Gaucher Patients',
        content: 'Analysis of 847 Gaucher disease patients shows 23% are CYP2D6 poor metabolizers vs. 7% in general population (p<0.001). This may affect enzyme replacement therapy dosing.',
        options: {
          summary: 'Gaucher patients show 3x higher rate of CYP2D6 poor metabolizer status',
          tags: ['gaucher', 'cyp2d6', 'pharmacogenomics', 'ert'],
          domain: ['pharmacogenomics', 'metabolism'],
          confidence: 0.85,
        },
      },
      {
        type: 'sop',
        title: 'Cross-Hospital Rare Disease Diagnostic Protocol',
        content: '1. Initial clinical assessment + family history\n2. Targeted gene panel (500 rare disease genes)\n3. Whole exome sequencing if panel negative\n4. Cross-reference with consortium case database\n5. Multi-disciplinary team review (genetics, neurology, immunology)\n6. Functional validation of novel variants\n7. Consensus diagnosis report',
        options: {
          summary: '7-step diagnostic protocol for rare diseases across consortium hospitals',
          tags: ['protocol', 'diagnostic', 'wes', 'gene-panel'],
          domain: ['rare-diseases', 'clinical'],
          confidence: 0.9,
        },
      },
      {
        type: 'finding',
        title: 'Mitochondrial DNA Depletion — New Variant in POLG2',
        content: 'Berlin and Tokyo labs independently identified a novel POLG2 variant (p.Arg369Gly) in 3 unrelated patients with progressive external ophthalmoplegia and mtDNA depletion. Functional studies show 40% reduction in polymerase gamma activity.',
        options: {
          summary: 'Novel POLG2 variant found in 3 patients with PEO across 2 hospitals',
          tags: ['polg2', 'mitochondrial', 'peo', 'novel-variant'],
          domain: ['genetics', 'neurology', 'mitochondrial'],
          confidence: 0.75,
        },
      },
      {
        type: 'paper',
        title: 'Review: AI-Assisted Diagnosis in Ultra-Rare Diseases',
        content: 'Systematic review of 42 studies using AI/ML for rare disease diagnosis. Deep phenotyping + NLP achieves 78% concordance with expert diagnosis. Limitation: training data bias toward European populations.',
        options: {
          summary: 'AI diagnostic tools show 78% concordance with experts but population bias exists',
          tags: ['ai', 'machine-learning', 'deep-phenotyping', 'nlp'],
          domain: ['bioinformatics', 'rare-diseases'],
          confidence: 0.8,
        },
      },
    ];

    for (const card of cards) {
      try {
        const c = await lead.createKnowledgeCard(
          space.id,
          card.type,
          card.title,
          card.content,
          card.options,
        );
        console.log(`   Card: [${card.type}] ${card.title.slice(0, 50)}...`);
      } catch (err: any) {
        console.error(`   Card error: ${err.message}`);
      }
    }
  } catch (err: any) {
    console.error(`   Knowledge error: ${err.message}`);
  }

  // 4. Summon CoC Chains
  console.log('\n4. Summoning Chains of Collaboration...');
  const chainGoals = [
    {
      goal: 'Diagnose rare neurological condition in Patient #RD-2024-0847: progressive ataxia, optic atrophy, onset age 6',
      template: 'rare_disease_diagnosis',
      priority: 'critical' as const,
    },
    {
      goal: 'Cross-reference novel POLG2 variant (p.Arg369Gly) with consortium genomic database and functional prediction tools',
      priority: 'high' as const,
    },
    {
      goal: 'Review treatment protocols for vascular Ehlers-Danlos syndrome — update guidelines with latest evidence',
      priority: 'normal' as const,
    },
  ];

  for (const cg of chainGoals) {
    try {
      const chain = await lead.summon({
        goal: cg.goal,
        roomId: ROOM,
        template: cg.template,
        priority: cg.priority,
      });
      console.log(`   Chain [${cg.priority}]: ${chain.id} — ${cg.goal.slice(0, 60)}...`);

      // Log the steps
      if (chain.steps?.length > 0) {
        console.log(`     ${chain.steps.length} steps created`);
      }
    } catch (err: any) {
      // GossipSub self-delivery can cause duplicate step inserts — non-fatal
      if (err.message?.includes('UNIQUE constraint')) {
        console.log(`   Chain [${cg.priority}]: created (with GossipSub dup warning)`);
      } else {
        console.error(`   Chain error: ${err.message}`);
      }
    }
    await sleep(500); // Avoid rapid-fire GossipSub conflicts
  }

  // 5. Start a Mission
  console.log('\n5. Starting research mission...');
  try {
    const mission = await lead.startMission({
      roomId: ROOM,
      goal: 'Continuous monitoring of rare disease literature for novel POLG2, MTHFR, and COL3A1 variant discoveries',
      missionType: 'scientific_research',
      templateId: 'research_monitor',
      mode: 'continuous',
      cadenceMs: 300_000,
      policy: {
        autonomy: 'semiautonomous',
        approvalGates: ['publish', 'external_write'],
        swarm: {
          minWorkers: 2,
          maxWorkers: 6,
          targetUtilization: 0.7,
          leaseMs: 120_000,
          rebalanceIntervalMs: 30_000,
        },
        retry: {
          maxStepRetries: 3,
          maxMissionReplans: 10,
          cooldownMs: 60_000,
        },
      },
      research: {
        sources: ['arxiv', 'pubmed', 'crossref'],
        subdomainsPerCycle: 3,
        requireDualReview: true,
        requireCitationExtraction: true,
        requireContradictionScan: true,
        synthesisIntervalMs: 600_000,
      },
      knowledge: {
        autoIndex: true,
      },
    });
    console.log(`   Mission started: ${mission.missionId}`);
  } catch (err: any) {
    console.error(`   Mission error: ${err.message}`);
  }

  // Wait for GossipSub peer discovery
  console.log('\n6. Waiting for P2P discovery...');
  await sleep(3000);

  // 7. Summary
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  Scenario Ready — Open Dashboard to View     ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  3 Hospital agents  (São Paulo, Tokyo, Berlin)');
  console.log('║  1 Federation       (Rare Disease Consortium) ');
  console.log('║  6 Knowledge cards  (facts, hypotheses, SOPs) ');
  console.log('║  3 CoC Chains       (diagnosis, review, update)');
  console.log('║  1 Research Mission (literature monitoring)   ');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Dashboard: http://localhost:4201             ');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('\nPress Ctrl+C to stop.\n');

  // Keep alive
  const shutdown = async () => {
    console.log('\nShutting down hospitals...');
    for (const c of clients) {
      try { await c.disconnect(); } catch {}
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
