# Referências

> [Índice da documentação](README.md) · referenciado como Apêndice D nos outros documentos


Consultadas em outubro de 2026.

**Anthropic / Claude**

- [Claude Code auto mode: a safer way to skip permissions](https://www.anthropic.com/engineering/claude-code-auto-mode) — Anthropic Engineering, 25/03/2026
- [Auto mode for Claude Code](https://claude.com/blog/auto-mode) — anúncio
- [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)
- [Tools reference](https://code.claude.com/docs/en/tools-reference)
- [Configure permissions](https://code.claude.com/docs/en/permissions)
- [Choose a permission mode](https://code.claude.com/docs/en/permission-modes)
- [Security](https://code.claude.com/docs/en/security)
- [Sandboxing](https://code.claude.com/docs/en/sandboxing) · [Claude Code sandboxing (Engineering)](https://www.anthropic.com/engineering/claude-code-sandboxing) · [sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime)
- [Hooks](https://code.claude.com/docs/en/hooks)
- [Memory (CLAUDE.md e memória automática)](https://code.claude.com/docs/en/memory)
- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Claude for Chrome](https://claude.com/blog/claude-for-chrome) — ago–dez/2025
- [Mitigating the risk of prompt injections in browser use](https://www.anthropic.com/research/prompt-injection-defenses) — nov/2025

**Pesquisa sobre segurança de agentes**

- Simon Willison — [The lethal trifecta for AI agents](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) (jun/2025)
- Meta — [Agents Rule of Two: A Practical Approach to AI Agent Security](https://ai.meta.com/blog/practical-ai-agent-security/) (out/2025)
- Nasr, Carlini et al. — [The Attacker Moves Second](https://arxiv.org/abs/2510.09023) (out/2025)
- Debenedetti et al. — [Defeating Prompt Injections by Design (CaMeL)](https://arxiv.org/abs/2503.18813) · [código](https://github.com/google-research/camel-prompt-injection)
- Beurer-Kellner et al. — [Design Patterns for Securing LLM Agents against Prompt Injections](https://arxiv.org/abs/2506.08837)
- Hines et al. (Microsoft) — [Defending Against Indirect Prompt Injection Attacks With Spotlighting](https://arxiv.org/abs/2403.14720)
- Debenedetti et al. — [AgentDojo](https://arxiv.org/abs/2406.13352) · [GitHub](https://github.com/ethz-spylab/agentdojo)
- OWASP — [Top 10 for LLM Applications 2025](https://genai.owasp.org/2024/11/17/owasp-reveals-updated-2025-top-10-risks-for-llms-announces-new-llm-project-sponsorship-program-and-inaugural-sponsors/)
- OWASP — [Top 10 for Agentic Applications for 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)
- Model Context Protocol — [Security Best Practices](https://modelcontextprotocol.io/specification/latest/basic/security_best_practices)
- Invariant Labs — [MCP Security Notification: Tool Poisoning Attacks](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks)
- Cloud Security Alliance — [MCP Tool Poisoning (nota de pesquisa)](https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-ai-agent-exfiltration-2/)

**Incidentes**

- Rehberger e o modo automático (ago/2026): [BankInfoSecurity](https://www.bankinfosecurity.com/hidden-attack-slips-past-claude-code-auto-mode-a-32693) · [análise "Auto Mode Is Not a Security Boundary"](https://blakecrosley.com/blog/auto-mode-is-not-a-boundary)
- Nx "s1ngularity" (ago/2025): [GitGuardian](https://blog.gitguardian.com/the-nx-s1ngularity-attack-inside-the-credential-leak/)
- Shai-Hulud (set/2025): [Sysdig](https://sysdig.com/blog/shai-hulud-the-novel-self-replicating-worm-infecting-hundreds-of-npm-packages)
- LiteLLM no PyPI (mar/2026): [Datadog Security Labs](https://securitylabs.datadoghq.com/articles/litellm-compromised-pypi-teampcp-supply-chain-campaign/)

**Plataforma, OAuth e Windows**

- Electron — [Security](https://electronjs.org/docs/latest/tutorial/security) · [safeStorage](https://electronjs.org/docs/latest/api/safe-storage) · [utilityProcess](https://electronjs.org/docs/latest/api/utility-process) · [Releases](https://electronjs.org/docs/latest/tutorial/electron-timelines)
- Node.js — [Releases](https://nodejs.org/about/releases/)
- Google — [OAuth 2.0 para apps de desktop](https://developers.google.com/identity/protocols/oauth2/native-app) · [bloqueio em webviews embutidas](https://developers.googleblog.com/en/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/) · [expiração em modo de teste](https://support.google.com/cloud/answer/15549945) · [preparação para produção](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)
- IETF — [RFC 8252: OAuth 2.0 for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252) · [RFC 7636: PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- GitHub — [Generating a user access token for a GitHub App (inclui device flow)](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)

**Bibliotecas e modelos**

- [AI SDK — Tool approvals](https://ai-sdk.dev/docs/agents/tool-approvals)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Pydantic AI — Deferred tools](https://ai.pydantic.dev/deferred-tools)
- [OpenCode](https://opencode.ai/) · [permissões](https://opencode.ai/docs/permissions/)
- [Prisma ORM 7 (cliente sem motor nativo, adaptadores de driver)](https://www.prisma.io/changelog/2025-11-19) · [Drizzle ORM — extensões do PostgreSQL (pgvector)](https://orm.drizzle.team/docs/extensions/pg) (alternativa da seção 4.3 antes da decisão 0014)
- [Next.js — Content Security Policy](https://nextjs.org/docs/app/guides/content-security-policy) (nonces exigem renderização dinâmica; a exportação estática usa hashes, decisão 0013)
- [bcrypt.js (`bcryptjs`)](https://github.com/dcodeIO/bcrypt.js) · [OWASP — Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) (limite de 72 bytes do bcrypt; decisão 0015)
- [pgvector](https://github.com/pgvector/pgvector) · [PostgreSQL 19 Beta 4](https://www.postgresql.org/about/news/postgresql-19-beta-4-3386/)
- [PGlite — extensões](https://pglite.dev/extensions/) · [embedded-postgres](https://npmjs.com/package/embedded-postgres)
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
- Picovoice — [Porcupine para Node.js](https://picovoice.ai/docs/quick-start/porcupine-nodejs/) · [planos](https://picovoice.ai/pricing)
- [Piper (piper1-gpl)](https://github.com/OHF-Voice/piper1-gpl) · [vozes](https://huggingface.co/rhasspy/piper-voices) · [Kokoro](https://github.com/hexgrad/kokoro)
- [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) · [Whisper large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo)
- [Handy — melhores modelos de STT para português](https://models.handy.computer/languages/pt)
