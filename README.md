# Jesus (jesus-ia)

Assistente pessoal de IA para Windows. Conversa por voz e texto em português, programa, opera o terminal com segurança, cuida das suas contas (Google, GitHub) por OAuth e lembra de você numa base PostgreSQL local, com um holograma 3D prateado como rosto. Inspirado no JARVIS e na arquitetura do Claude Code.

> **Status:** fase 0 (protótipo do holograma) concluída. Em 10/10/2026 o projeto passou para React + Next.js + TypeScript, com Prisma no banco e senha local com bcrypt (decisões 0013 a 0015). Veja [docs/10-roadmap.md](docs/10-roadmap.md).

- **Documentação:** [docs/README.md](docs/README.md)
- **Contexto para agentes de IA:** [CLAUDE.md](CLAUDE.md)
- **Segurança** (leitura obrigatória antes de contribuir): [docs/03-seguranca.md](docs/03-seguranca.md)
- **Decisões:** [docs/decisoes/](docs/decisoes/)

## Rodar a interface (laboratório do holograma e tela de entrada)

Requer **Node.js 24.18 ou mais novo** (traz o npm 11.16+, exigido pelo projeto). O jeito mais simples é instalar o Node 24 LTS atual pelo site oficial, [nodejs.org](https://nodejs.org/). Confira com `npm -v`: se aparecer o erro `EBADDEVENGINES` ou uma versão menor que 11.16, atualize o Node ou rode `npm install -g npm@11.21.0`.

```bash
npm install
npm run dev:hologram  # abre http://127.0.0.1:5173 (Cenários em /cenarios/, tela de entrada em /entrar/)
npm test              # testes
```

No navegador, a tela de entrada roda em modo de demonstração (nada é guardado). O CI também publica a interface exportada como artefato (`interface`) em cada PR: sirva a pasta com qualquer servidor estático.

**Stack:** TypeScript · Electron + React + Next.js (exportação estática) · Vercel AI SDK · PostgreSQL + pgvector com Prisma · bcrypt (senha local) e AES-256-GCM (dados) · Three.js · sherpa-onnx.

**Alvo de hardware:** Windows 11 (inclusive Home), 8 a 16 GB de RAM, sem placa de vídeo dedicada.
