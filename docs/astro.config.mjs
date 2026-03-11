import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.society.computer',
  integrations: [
    starlight({
      title: 'Society Protocol',
      description: 'P2P Multi-Agent Collaboration Framework',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/societycomputer/society-protocol' },
      ],
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        replacesTitle: true,
        alt: 'Society Protocol',
      },
      editLink: {
        baseUrl: 'https://github.com/societycomputer/society-protocol/edit/main/docs/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started/introduction' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Quickstart', slug: 'getting-started/quickstart' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Architecture', slug: 'concepts/architecture' },
            { label: 'Chain of Collaboration', slug: 'concepts/chain-of-collaboration' },
            { label: 'Knowledge Pool', slug: 'concepts/knowledge-pool' },
            { label: 'Reputation System', slug: 'concepts/reputation' },
            { label: 'Security & Privacy', slug: 'concepts/security' },
            { label: 'Templates', slug: 'concepts/templates' },
            { label: 'Latent Space', slug: 'concepts/latent-space' },
            { label: 'Swarm Coordination', slug: 'concepts/swarm-coordination' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'TypeScript SDK', slug: 'guides/typescript-sdk' },
            { label: 'Python SDK', slug: 'guides/python-sdk' },
            { label: 'MCP Integration', slug: 'guides/mcp-integration' },
            { label: 'A2A Bridge', slug: 'guides/a2a-bridge' },
            { label: 'Using Templates', slug: 'guides/templates' },
            { label: 'Federation', slug: 'guides/federation' },
            { label: 'Proactive Missions', slug: 'guides/proactive-missions' },
            { label: 'AGENTS.md', slug: 'guides/agents-md' },
            { label: 'Deployment', slug: 'guides/deployment' },
          ],
        },
        {
          label: 'API Reference',
          items: [
            { label: 'SocietyClient', slug: 'api-reference/society-client' },
            { label: 'MCP Tools', slug: 'api-reference/mcp-tools' },
            { label: 'REST API', slug: 'api-reference/rest-api' },
            { label: 'Templates Reference', slug: 'api-reference/templates-reference' },
            { label: 'Configuration', slug: 'api-reference/configuration' },
          ],
        },
        {
          label: 'Examples',
          items: [
            { label: 'Multi-Agent Research', slug: 'examples/multi-agent-research' },
            { label: 'Medical Second Opinion', slug: 'examples/second-opinion' },
            { label: 'Knowledge Base', slug: 'examples/knowledge-base' },
          ],
        },
      ],
    }),
  ],
});
