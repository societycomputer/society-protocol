/**
 * Collaboration Simulation Engine
 *
 * Drives a realistic multi-agent rare disease diagnosis scenario.
 * Emits events (messages, step updates, presence) over time to
 * make the dashboard come alive with agent activity.
 */

import type { SocietyClient } from 'society-core/sdk';
import type { RpcNotification } from '../shared/types.js';

interface Agent {
  did: string;
  name: string;
  role: string;
  specialty: string;
  status: 'online' | 'busy' | 'running';
}

interface SimEvent {
  delayMs: number;
  action: () => void;
}

export class CollaborationSimulation {
  private client: SocietyClient;
  private broadcast: (n: RpcNotification) => void;
  running = false;
  private timeouts: ReturnType<typeof setTimeout>[] = [];
  agents: Agent[] = [];
  messages: Record<string, unknown>[] = [];
  private messageId = 0;
  private roomId: string;

  constructor(
    client: SocietyClient,
    broadcast: (n: RpcNotification) => void,
    roomId: string,
  ) {
    this.client = client;
    this.broadcast = broadcast;
    this.roomId = roomId;

    // Simulated agents in the network
    this.agents = [
      { did: 'did:key:hospital-sp-001', name: 'Hospital-SaoPaulo', role: 'clinical', specialty: 'neurology', status: 'online' },
      { did: 'did:key:hospital-tk-002', name: 'Hospital-Tokyo', role: 'clinical', specialty: 'genetics', status: 'online' },
      { did: 'did:key:hospital-be-003', name: 'Hospital-Berlin', role: 'clinical', specialty: 'metabolism', status: 'online' },
      { did: 'did:key:ai-diag-004', name: 'AI-Diagnostics', role: 'ai', specialty: 'deep-phenotyping', status: 'online' },
      { did: 'did:key:genomics-005', name: 'Genomics-Lab', role: 'research', specialty: 'wes-analysis', status: 'online' },
      { did: 'did:key:lit-agent-006', name: 'Literature-Agent', role: 'research', specialty: 'pubmed-mining', status: 'online' },
    ];
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('Simulation started: Rare Disease Collaboration');

    // Broadcast all agents coming online
    for (const agent of this.agents) {
      this.emitPeerConnected(agent);
    }

    // Run the scenario
    this.runScenario();
  }

  stop(): void {
    this.running = false;
    for (const t of this.timeouts) clearTimeout(t);
    this.timeouts = [];
    console.log('Simulation stopped');
  }

  private schedule(delayMs: number, fn: () => void): void {
    if (!this.running) return;
    const t = setTimeout(() => {
      if (this.running) fn();
    }, delayMs);
    this.timeouts.push(t);
  }

  private emitMessage(
    agent: Agent,
    text: string,
    type: 'chat' | 'system' | 'negotiation' | 'step' | 'discovery' = 'chat',
    metadata?: Record<string, unknown>,
  ): void {
    const params = {
      id: `msg_${++this.messageId}_${Date.now()}`,
      roomId: this.roomId,
      from: agent.did,
      fromName: agent.name,
      fromRole: agent.role,
      text,
      type,
      timestamp: Date.now(),
      metadata,
    };
    this.messages.push(params);
    this.broadcast({ jsonrpc: '2.0', method: 'event.message', params });
  }

  private emitSystemMessage(text: string): void {
    const params = {
      id: `msg_${++this.messageId}_${Date.now()}`,
      roomId: this.roomId,
      from: 'system',
      fromName: 'System',
      fromRole: 'system',
      text,
      type: 'system' as const,
      timestamp: Date.now(),
    };
    this.messages.push(params);
    this.broadcast({ jsonrpc: '2.0', method: 'event.message', params });
  }

  private emitPeerConnected(agent: Agent): void {
    this.broadcast({
      jsonrpc: '2.0',
      method: 'event.peer.connected',
      params: {
        did: agent.did,
        peerId: agent.did,
        name: agent.name,
        status: agent.status,
        reputation: 0.85 + Math.random() * 0.15,
        specialties: [agent.specialty],
        capabilities: [agent.role],
      },
    });
  }

  private emitPresence(agent: Agent, status: 'online' | 'busy' | 'running'): void {
    agent.status = status;
    this.broadcast({
      jsonrpc: '2.0',
      method: 'event.presence',
      params: {
        did: agent.did,
        status,
        load: status === 'busy' ? 0.8 : status === 'running' ? 0.6 : 0.2,
        capabilities: [agent.role],
      },
    });
  }

  private emitStepUpdate(chainId: string, stepId: string, status: string, assignee?: string, assigneeName?: string): void {
    this.broadcast({
      jsonrpc: '2.0',
      method: status === 'assigned' ? 'event.step.assigned' : 'event.step.unlocked',
      params: { chainId, stepId, status, assignee, assigneeName },
    });
  }

  private runScenario(): void {
    const sp = this.agents[0]; // Hospital-SaoPaulo
    const tk = this.agents[1]; // Hospital-Tokyo
    const be = this.agents[2]; // Hospital-Berlin
    const ai = this.agents[3]; // AI-Diagnostics
    const gen = this.agents[4]; // Genomics-Lab
    const lit = this.agents[5]; // Literature-Agent

    // Get the chain ID (first running chain)
    let chainId: string | null = null;
    try {
      const chains = this.client.listChains(this.roomId);
      const diag = chains.find((c: any) => c.goal?.includes('Diagnose rare'));
      if (diag) chainId = diag.id;
    } catch {}

    let t = 0;
    const delay = (ms: number) => { t += ms; return t; };

    // === Phase 1: Case Presentation ===
    this.schedule(delay(1500), () => {
      this.emitSystemMessage('New diagnostic case referred to consortium: Patient #RD-2024-0847');
    });

    this.schedule(delay(2000), () => {
      this.emitMessage(sp, 'Case intake complete for Patient #RD-2024-0847. 6-year-old male presenting with progressive ataxia, optic atrophy, onset age 6. Parents are second cousins. Initial metabolic panel unremarkable.', 'chat');
    });

    this.schedule(delay(3000), () => {
      this.emitMessage(ai, 'Running deep phenotyping analysis on clinical features... HPO terms extracted: HP:0001251 (Cerebellar ataxia), HP:0000648 (Optic atrophy), HP:0012758 (Neurodevelopmental delay). Checking phenotype similarity against 7,000+ rare disease profiles.', 'chat');
      this.emitPresence(ai, 'busy');
    });

    this.schedule(delay(4000), () => {
      this.emitMessage(ai, 'Phenotype match results (top 5):\n1. Friedreich ataxia (87% match)\n2. POLG-related disorders (82% match)\n3. Wolfram syndrome (78% match)\n4. Spinocerebellar ataxia type 7 (74% match)\n5. Leigh syndrome (71% match)\nConsanguinity strongly suggests autosomal recessive. Recommending targeted gene panel.', 'discovery');
      this.emitPresence(ai, 'online');
    });

    // === Phase 2: Negotiation — Who Takes Which Steps ===
    this.schedule(delay(3500), () => {
      this.emitSystemMessage('Chain of Collaboration initiated — assigning diagnostic steps');
    });

    this.schedule(delay(2000), () => {
      this.emitMessage(gen, 'I can run the targeted rare disease gene panel (500 genes). My lab has the Illumina NovaSeq ready. Estimated turnaround: 48h for data, 24h for variant calling.', 'negotiation');
    });

    this.schedule(delay(2500), () => {
      this.emitMessage(tk, 'We have experience with POLG-related mitochondrial disorders. I\'ll take the genetics specialist analysis step. We\'ve seen 3 similar cases this year with our POLG2 cohort.', 'negotiation');
    });

    this.schedule(delay(2000), () => {
      this.emitMessage(sp, 'I\'ll handle the neurology specialist review. The patient is in our facility — I can order additional electrophysiology studies (EMG/NCS, VEP) if needed.', 'negotiation');
    });

    this.schedule(delay(2500), () => {
      this.emitMessage(be, 'Taking the metabolic specialist analysis. We\'ll repeat the metabolic panel with expanded amino acids and organic acids. Our lab can also do mitochondrial respiratory chain enzyme analysis.', 'negotiation');
    });

    this.schedule(delay(2000), () => {
      this.emitMessage(lit, 'I\'ll scan PubMed, ClinVar, and OMIM for the latest publications on the candidate genes. Starting continuous monitoring for any new POLG/POLG2 variant reports.', 'negotiation');
    });

    // === Phase 3: Step Execution ===
    this.schedule(delay(3000), () => {
      this.emitSystemMessage('All steps assigned. Beginning collaborative diagnosis workflow.');
      if (chainId) {
        // Try to update steps
        try {
          const chain = this.client.getChain(chainId);
          if (chain?.steps?.length > 0) {
            const step0 = chain.steps[0];
            this.emitStepUpdate(chainId, step0.id, 'assigned', sp.did, sp.name);
          }
        } catch {}
      }
    });

    // Literature scan
    this.schedule(delay(4000), () => {
      this.emitPresence(lit, 'busy');
      this.emitMessage(lit, 'Scanning literature... Querying PubMed: ("POLG" OR "POLG2" OR "Friedreich" OR "Wolfram") AND ("ataxia" AND "optic atrophy" AND "pediatric"). Found 342 relevant papers in last 5 years.', 'step');
    });

    this.schedule(delay(5000), () => {
      this.emitMessage(lit, 'KEY FINDING: Recent paper (Chen et al., 2025, Nature Genetics) reports a novel POLG2 variant (p.Arg369Gly) in 3 unrelated patients with PEO and childhood-onset ataxia. This matches our patient\'s phenotype closely. The variant was found in consanguineous families.', 'discovery');
      this.emitPresence(lit, 'online');
    });

    // Genomics analysis
    this.schedule(delay(4000), () => {
      this.emitPresence(gen, 'busy');
      this.emitMessage(gen, 'Gene panel sequencing complete. Running variant calling pipeline (GATK HaplotypeCaller). Mean coverage: 245x. 99.8% of target bases covered at >20x.', 'step');
    });

    this.schedule(delay(6000), () => {
      this.emitMessage(gen, 'Variant filtering results:\n- 12,847 total variants called\n- 234 rare variants (MAF < 0.01)\n- 18 coding/splicing variants in candidate genes\n- 3 variants flagged as high-impact:\n  1. POLG2 c.1105C>G p.(Arg369Gly) — homozygous\n  2. FXN intron 1 GAA expansion — heterozygous (carrier)\n  3. WFS1 c.2002G>A p.(Gly668Ser) — VUS, heterozygous', 'discovery');
      this.emitPresence(gen, 'online');
    });

    // Specialist analyses
    this.schedule(delay(3000), () => {
      this.emitPresence(tk, 'busy');
      this.emitMessage(tk, 'Analyzing the POLG2 p.Arg369Gly variant. This is the SAME variant we found in our Tokyo cohort! Cross-referencing with our functional data...', 'step');
    });

    this.schedule(delay(5000), () => {
      this.emitMessage(tk, 'CRITICAL: Our in vitro assays show POLG2 p.Arg369Gly reduces DNA polymerase gamma processivity by 40%. In our 3 patients, this variant caused progressive external ophthalmoplegia with cerebellar ataxia. The homozygous state in Patient #RD-2024-0847 likely explains the more severe childhood-onset phenotype.', 'discovery');
      this.emitPresence(tk, 'online');
    });

    this.schedule(delay(3000), () => {
      this.emitPresence(sp, 'busy');
      this.emitMessage(sp, 'Neurology review: EMG/NCS shows mild sensorimotor axonal neuropathy. VEP confirms bilateral optic nerve dysfunction. Brain MRI reveals mild cerebellar atrophy. Clinical findings are consistent with mitochondrial disorder.', 'step');
      this.emitPresence(sp, 'online');
    });

    this.schedule(delay(4000), () => {
      this.emitPresence(be, 'busy');
      this.emitMessage(be, 'Metabolic workup update: Lactate mildly elevated (2.8 mmol/L, ref <2.2). Muscle biopsy shows COX-negative fibers (15% of fibers). Respiratory chain enzyme analysis: Complex I and IV activity reduced to 45% and 52% of normal. Findings strongly support mitochondrial dysfunction.', 'step');
      this.emitPresence(be, 'online');
    });

    // === Phase 4: Cross-Specialist Correlation ===
    this.schedule(delay(4000), () => {
      this.emitSystemMessage('Cross-specialist correlation phase initiated');
    });

    this.schedule(delay(3000), () => {
      this.emitMessage(ai, 'Integrating all specialist findings... Running correlation analysis across:\n- Genomics: POLG2 p.Arg369Gly (homozygous)\n- Neurology: ataxia + optic atrophy + neuropathy\n- Metabolism: mitochondrial respiratory chain defects\n- Literature: matching phenotype in Tokyo cohort\n\nDiagnostic confidence: 94%', 'step');
    });

    this.schedule(delay(4000), () => {
      this.emitMessage(ai, 'CORRELATION COMPLETE:\nAll evidence converges on POLG2-related mitochondrial disorder:\n\u2713 Genetic: causative variant confirmed (POLG2 p.Arg369Gly, homozygous)\n\u2713 Functional: 40% reduced processivity (Tokyo lab data)\n\u2713 Biochemical: Complex I/IV deficiency (Berlin lab)\n\u2713 Clinical: progressive ataxia + optic atrophy (S\u00e3o Paulo)\n\u2713 Literature: 3 independent cases with same variant\n\nRecommending consensus diagnosis.', 'discovery');
    });

    // === Phase 5: Consensus & Report ===
    this.schedule(delay(4000), () => {
      this.emitSystemMessage('Multi-disciplinary consensus review');
    });

    this.schedule(delay(3000), () => {
      this.emitMessage(sp, 'I concur with the diagnosis. The consanguinity, autosomal recessive inheritance, and clinical phenotype all fit. We should also screen the siblings.', 'chat');
    });

    this.schedule(delay(2000), () => {
      this.emitMessage(tk, 'Agreed. We\'re preparing the ClinVar submission for this variant with the new functional evidence. This will be the 4th independent confirmation of pathogenicity.', 'chat');
    });

    this.schedule(delay(2000), () => {
      this.emitMessage(be, 'Concur. I recommend starting CoQ10 supplementation and idebenone as supportive therapy. We should also discuss eligibility for the ongoing AAV-POLG2 gene therapy trial (NCT-2025-POLG2-001).', 'chat');
    });

    this.schedule(delay(3000), () => {
      this.emitMessage(ai, 'Generating final diagnostic report...\n\nDIAGNOSIS: POLG2-related mitochondrial disorder\nVariant: NM_007215.4:c.1105C>G p.(Arg369Gly) — homozygous\nClassification: Pathogenic (PS3, PM2, PP1, PP3, PP4)\nInheritance: Autosomal recessive\nRecommendations:\n1. Genetic counseling for family\n2. Sibling screening\n3. CoQ10 + Idebenone supplementation\n4. Gene therapy trial evaluation\n5. Longitudinal follow-up every 6 months', 'step');
    });

    this.schedule(delay(3000), () => {
      this.emitSystemMessage('DIAGNOSIS COMPLETE \u2014 Chain of Collaboration resolved successfully');
      this.emitMessage(lit, 'Creating knowledge card: "POLG2 p.Arg369Gly \u2014 Confirmed Pathogenic in Pediatric Ataxia-Optic Atrophy Syndrome". Indexing in consortium knowledge base. 4th independent confirmation across 3 continents.', 'discovery');
    });

    this.schedule(delay(3000), () => {
      this.emitMessage(gen, 'This is exactly why federated collaboration works. None of us could have reached this diagnosis alone \u2014 it took genomics, functional data, clinical correlation, AND the Tokyo cohort data. Time from referral to diagnosis: 72 hours vs. typical 5-7 year diagnostic odyssey.', 'chat');
    });

    this.schedule(delay(2500), () => {
      this.emitMessage(sp, 'Patient family has been informed. They are incredibly relieved to finally have an answer. The mother is crying \u2014 they\'ve been searching for 4 years. Scheduling genetic counseling and starting treatment protocol.', 'chat');
    });

    // === Phase 6: Post-diagnosis monitoring ===
    this.schedule(delay(4000), () => {
      this.emitSystemMessage('Research mission continuing: monitoring for new POLG2 variant discoveries');
    });

    this.schedule(delay(3000), () => {
      this.emitMessage(lit, 'Setting up continuous PubMed alerts for POLG2 variants. Also monitoring ClinGen for classification updates. Will notify consortium of any new findings.', 'chat');
    });

    this.schedule(delay(3000), () => {
      this.emitMessage(tk, 'Updating our POLG2 variant database. We now have functional data for 12 variants. Preparing manuscript for submission to AJHG: "Expanding the POLG2 mutational spectrum: functional characterization of 12 novel variants."', 'chat');
    });

    this.schedule(delay(4000), () => {
      this.emitMessage(ai, 'Updating diagnostic model with this case. The POLG2 phenotype signature has been added to the training set. Next phenotype similarity analysis will include this pattern, potentially helping future patients.', 'chat');
    });

    this.schedule(delay(3000), () => {
      this.emitSystemMessage('Collaboration session complete. All agents returning to standby monitoring mode.');
    });
  }
}
