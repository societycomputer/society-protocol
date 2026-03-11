/**
 * Populates the dashboard with rare disease scenario data
 * by sending JSON-RPC commands to the dashboard's WebSocket API.
 *
 * This ensures all data goes through the dashboard's embedded node.
 *
 * Usage: npx tsx scripts/populate-dashboard.ts
 */

import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:4200/ws';

let reqId = 1;

function rpc(ws: WebSocket, method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = reqId++;
    const timeout = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 10000);

    const handler = (data: any) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        ws.off('message', handler);
        clearTimeout(timeout);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Populating Dashboard — Rare Disease Scenario ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const ws = new WebSocket(WS_URL);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  // Skip the initial snapshot message
  await new Promise(r => ws.once('message', r));
  console.log('Connected to dashboard WebSocket.\n');

  // 1. Get node info
  const nodeInfo = await rpc(ws, 'node.info');
  console.log(`Dashboard node: ${nodeInfo.name} (${nodeInfo.did.slice(0, 40)}...)\n`);

  // 2. Create Federation
  console.log('1. Creating federation...');
  try {
    const fed = await rpc(ws, 'federation.create', {
      name: 'Rare Disease Research Consortium',
      description: 'Multi-hospital federation for collaborative diagnosis and research of rare diseases. Members share anonymized case data, genomic findings, and treatment protocols across São Paulo, Tokyo, and Berlin.',
      visibility: 'public',
    });
    console.log(`   Federation: ${fed.id} — "${fed.name}"`);
  } catch (err: any) {
    console.error(`   Federation error: ${err.message}`);
  }

  // 3. Create Knowledge Space + Cards
  console.log('\n2. Creating knowledge space + cards...');
  let spaceId: string | null = null;
  try {
    const space = await rpc(ws, 'knowledge.space.create', {
      name: 'Rare Disease Knowledge Base',
      description: 'Shared repository for rare disease case studies, genetic variants, diagnostic protocols, and treatment evidence.',
      type: 'team',
    });
    spaceId = space.id;
    console.log(`   Space: ${space.id}`);
  } catch (err: any) {
    console.error(`   Space error: ${err.message}`);
  }

  if (spaceId) {
    const cards = [
      {
        type: 'fact', title: 'Ehlers-Danlos Syndrome — Vascular Type (vEDS)',
        content: 'Vascular EDS (vEDS) caused by COL3A1 mutations. Prevalence: 1 in 50,000-200,000. Diagnosis requires genetic testing. Life-threatening due to arterial, intestinal, and uterine fragility. Median survival 51 years.',
        options: { summary: 'COL3A1 mutations cause vascular EDS; prevalence 1:50k-200k; median survival 51y', tags: ['eds', 'collagen', 'COL3A1', 'vascular'], domain: ['genetics', 'rare-diseases'], confidence: 0.95 },
      },
      {
        type: 'hypothesis', title: 'Novel MTHFR Compound Variant — Neurological Impact',
        content: 'Patient cohort (n=12) across 3 hospitals presents with progressive ataxia, cognitive decline, and a novel MTHFR variant (c.1298A>C homozygous + c.677C>T heterozygous compound). Hypothesis: this compound variant disrupts folate-methionine cycling more severely than known single variants.',
        options: { summary: 'Novel compound MTHFR variant may explain neurological symptoms in 12 patients', tags: ['mthfr', 'folate', 'neurology', 'compound-variant', 'ataxia'], domain: ['genetics', 'neurology'], confidence: 0.6 },
      },
      {
        type: 'evidence', title: 'CYP2D6 Poor Metabolizer Prevalence in Gaucher Disease',
        content: 'Pharmacogenomics analysis of 847 Gaucher disease patients: 23% are CYP2D6 poor metabolizers vs. 7% general population (p<0.001, OR=3.98). Implications for ERT dosing and substrate reduction therapy selection.',
        options: { summary: 'Gaucher patients show 3.98x higher CYP2D6 poor metabolizer rate', tags: ['gaucher', 'cyp2d6', 'pharmacogenomics', 'ERT'], domain: ['pharmacogenomics', 'metabolism'], confidence: 0.85 },
      },
      {
        type: 'sop', title: 'Cross-Hospital Rare Disease Diagnostic Protocol v2.1',
        content: '1. Initial clinical assessment + deep phenotyping (HPO terms)\n2. Targeted gene panel (500 rare disease genes)\n3. Whole exome sequencing if panel negative\n4. Trio analysis (proband + parents) for de novo variants\n5. Cross-reference consortium database (anonymized)\n6. Multi-disciplinary virtual tumor board (genetics, neurology, immunology, metabolism)\n7. Functional validation of VUS (variants of uncertain significance)\n8. Consensus diagnosis + treatment protocol\n9. Longitudinal follow-up registration',
        options: { summary: '9-step diagnostic protocol for rare diseases across consortium hospitals', tags: ['protocol', 'diagnostic', 'WES', 'gene-panel', 'HPO'], domain: ['rare-diseases', 'clinical'], confidence: 0.92 },
      },
      {
        type: 'finding', title: 'Novel POLG2 Variant (p.Arg369Gly) in Progressive External Ophthalmoplegia',
        content: 'Berlin and Tokyo labs independently identified a novel POLG2 variant (p.Arg369Gly) in 3 unrelated patients with progressive external ophthalmoplegia (PEO) and mtDNA depletion. In vitro: 40% reduction in polymerase gamma processivity. ClinVar submission pending.',
        options: { summary: 'Novel POLG2 p.Arg369Gly variant in 3 PEO patients; 40% reduced processivity', tags: ['polg2', 'mitochondrial', 'PEO', 'novel-variant', 'mtDNA'], domain: ['genetics', 'neurology', 'mitochondrial'], confidence: 0.78 },
      },
      {
        type: 'paper', title: 'AI-Assisted Rare Disease Diagnosis: Systematic Review (2024)',
        content: 'Meta-analysis of 42 studies. Deep phenotyping + NLP achieves 78% concordance with expert geneticists. Image-based models (facial dysmorphology): 91% specificity. Key limitation: 87% of training data from European populations. Recommendation: federated learning across consortium hospitals.',
        options: { summary: 'AI tools show 78% concordance; 91% facial specificity; population bias exists', tags: ['ai', 'machine-learning', 'deep-phenotyping', 'NLP', 'facial'], domain: ['bioinformatics', 'rare-diseases', 'ai'], confidence: 0.82 },
      },
    ];

    for (const card of cards) {
      try {
        await rpc(ws, 'knowledge.card.create', {
          spaceId,
          type: card.type,
          title: card.title,
          content: card.content,
          options: card.options,
        });
        console.log(`   [${card.type}] ${card.title.slice(0, 55)}...`);
      } catch (err: any) {
        console.error(`   Card error: ${err.message}`);
      }
    }
  }

  // 4. Summon CoC Chain (rare disease diagnosis)
  console.log('\n3. Summoning Chain of Collaboration...');
  try {
    const chain = await rpc(ws, 'coc.summon', {
      goal: 'Diagnose rare neurological condition in Patient #RD-2024-0847: progressive ataxia, optic atrophy, onset age 6, family history of consanguinity',
      roomId: 'rare-disease-dx',
      template: 'rare_disease_diagnosis',
      priority: 'critical',
    });
    console.log(`   Chain: ${chain.id} — ${chain.steps?.length || 0} steps`);
    if (chain.steps?.length > 0) {
      for (const s of chain.steps.slice(0, 5)) {
        console.log(`     [${s.status}] ${s.title}`);
      }
      if (chain.steps.length > 5) console.log(`     ... and ${chain.steps.length - 5} more`);
    }
  } catch (err: any) {
    console.error(`   Chain error: ${err.message}`);
  }

  // 5. Start Research Mission
  console.log('\n4. Starting research mission...');
  try {
    const mission = await rpc(ws, 'mission.start', {
      spec: {
        roomId: 'rare-disease-dx',
        goal: 'Continuous monitoring of rare disease literature for POLG2, MTHFR, COL3A1 variant discoveries and treatment advances',
        missionType: 'scientific_research',
        templateId: 'research_monitor',
        mode: 'continuous',
        cadenceMs: 300_000,
        policy: {
          autonomy: 'semiautonomous',
          approvalGates: ['publish', 'external_write'],
          swarm: { minWorkers: 2, maxWorkers: 6, targetUtilization: 0.7, leaseMs: 120_000, rebalanceIntervalMs: 30_000 },
          retry: { maxStepRetries: 3, maxMissionReplans: 10, cooldownMs: 60_000 },
        },
        research: {
          sources: ['arxiv', 'pubmed', 'crossref'],
          subdomainsPerCycle: 3,
          requireDualReview: true,
          requireCitationExtraction: true,
          requireContradictionScan: true,
          synthesisIntervalMs: 600_000,
        },
        knowledge: { autoIndex: true },
      },
    });
    console.log(`   Mission: ${mission.missionId} — status: ${mission.status}`);
  } catch (err: any) {
    console.error(`   Mission error: ${err.message}`);
  }

  // 6. Start Collaboration Simulation
  console.log('\n5. Starting collaboration simulation...');
  try {
    await rpc(ws, 'simulation.start');
    console.log('   Simulation started! Agents are now collaborating...');
  } catch (err: any) {
    console.error(`   Simulation error: ${err.message}`);
  }

  // Done
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  Dashboard populated! Open http://localhost:4201  ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  1 Federation  (Rare Disease Consortium)          ║');
  console.log('║  6 Knowledge Cards (genetics, diagnostics)        ║');
  console.log('║  1 CoC Chain   (rare disease diagnosis)           ║');
  console.log('║  1 Mission     (literature monitoring)            ║');
  console.log('║  6 Agents      (collaborating in real-time)       ║');
  console.log('║                                                   ║');
  console.log('║  Go to Chat panel to watch agents collaborate!    ║');
  console.log('╚══════════════════════════════════════════════════╝');

  ws.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
