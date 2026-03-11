---
skill:
  name: "research-synthesis"
  version: "1.0.0"
  description: "Parallel research investigation with expert synthesis for comprehensive topic analysis"
  author: "Society Team"
  license: "MIT"

triggers:
  - type: manual
    description: "User-initiated research request"
  - type: schedule
    cron: "0 9 * * 1"  # Every Monday at 9 AM

society:
  template: "research_swarm"
  room: "${env.SOCIETY_ROOM || 'research'}"
  priority: "normal"
  chain_config:
    timeout_ms: 3600000  # 1 hour
    consensus: "single"

inputs:
  - name: topic
    type: "string"
    required: true
    description: "Research topic or question to investigate"
    validation:
      min: 10
      max: 500
  
  - name: domains
    type: "number"
    required: false
    default: 3
    description: "Number of parallel research domains"
    validation:
      min: 2
      max: 5
  
  - name: sources
    type: "json"
    required: false
    description: "Preferred sources (arxiv, papers, web, etc.)"
    default: ["academic", "industry", "news"]
  
  - name: output_format
    type: "string"
    required: false
    default: "executive_summary"
    validation:
      options: ["executive_summary", "detailed_report", "literature_review", "presentation"]

outputs:
  - name: research_report
    type: "markdown"
    description: "Comprehensive research report with findings"
    path: "./research/{topic_slug}.md"
  
  - name: key_findings
    type: "json"
    description: "Structured key findings with citations"
  
  - name: bibliography
    type: "file"
    description: "Bibliography in BibTeX format"

adapters:
  - runtime: "claude-code"
    specialties: ["research", "analysis", "synthesis"]
    min_reputation: 0.75
    count: 3

hooks:
  on_init: "log_research_start"
  on_complete: "notify_stakeholders"
  on_after_step: "progress_update"

config:
  env:
    SOCIETY_ROOM: "research"
    MAX_SOURCES_PER_DOMAIN: "10"
---

# Research Synthesis Skill

Performs comprehensive parallel research on a topic using multiple specialized agents, then synthesizes findings into actionable insights.

## How It Works

### Phase 1: Domain Decomposition
The topic is automatically broken down into N distinct research domains based on:
- Academic literature
- Industry reports
- News and media
- Technical documentation
- Expert opinions

### Phase 2: Parallel Investigation
Each domain is assigned to a specialized research agent that:
- Searches relevant sources
- Extracts key findings
- Evaluates credibility
- Summarizes insights

### Phase 3: Cross-Domain Synthesis
A senior analyst synthesizes all findings:
- Identifies patterns and conflicts
- Assesses confidence levels
- Creates coherent narrative
- Generates recommendations

### Phase 4: Quality Assurance
Final review for:
- Factual accuracy
- Source credibility
- Logical consistency
- Actionability

## Output Formats

### Executive Summary
- One-page overview
- Key findings (bullet points)
- Strategic recommendations
- Risk assessment

### Detailed Report
- 10-20 pages
- Comprehensive analysis
- Full citations
- Appendix with sources

### Literature Review
- Academic format
- Methodology section
- Gap analysis
- Future research directions

### Presentation
- Slide deck structure
- Visual summaries
- Talking points
- Q&A preparation

## Example Usage

```typescript
const result = await executeSkill('research-synthesis', {
  topic: "Emerging trends in quantum computing for drug discovery",
  domains: 4,
  sources: ["academic", "industry", "patents"],
  output_format: "executive_summary"
});

// Access structured findings
console.log(result.key_findings.confidence_level);
console.log(result.key_findings.recommendations);
```

## Sample Output

```markdown
# Research Report: Quantum Computing in Drug Discovery

## Executive Summary

**Confidence Level:** High (8.5/10)

### Key Findings

1. **Market Readiness**: 3-5 years to practical applications
2. **Key Players**: IBM, Google, Roche, Merck investing heavily
3. **Technical Barriers**: Error correction, qubit stability
4. **Regulatory**: FDA preparing framework for QC-designed drugs

### Recommendations

1. **Short-term** (1-2 years): Monitor partnerships, build expertise
2. **Medium-term** (3-5 years): Pilot projects with quantum startups
3. **Long-term** (5+ years): Full integration into R&D pipeline

### Risk Assessment

- **Technical Risk**: High - hardware limitations
- **Competitive Risk**: Medium - early movers advantage
- **Regulatory Risk**: Low - supportive environment

## Detailed Analysis

[Full 15-page report with citations...]
```
