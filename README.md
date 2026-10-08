# Jesus (jesus-ia)

Assistente pessoal de IA para Windows. Conversa por voz e texto em português, programa, opera o terminal com segurança, cuida das suas contas (Google, GitHub) por OAuth e lembra de você numa base PostgreSQL local, com um holograma 3D prateado como rosto. Inspirado no JARVIS e na arquitetura do Claude Code.

> **Status:** fase 0 (protótipo do holograma) pronta para avaliação. Veja [docs/10-roadmap.md](docs/10-roadmap.md).

- **Documentação:** [docs/README.md](docs/README.md)
- **Contexto para agentes de IA:** [CLAUDE.md](CLAUDE.md)
- **Segurança** (leitura obrigatória antes de contribuir): [docs/03-seguranca.md](docs/03-seguranca.md)
- **Decisões:** [docs/decisoes/](docs/decisoes/)

## Rodar o protótipo do holograma

Requer **Node.js 24.18 ou mais novo** (traz o npm 11.16+, exigido pelo projeto). O jeito mais simples é instalar o Node 24 LTS atual pelo site oficial, [nodejs.org](https://nodejs.org/). Confira com `npm -v`: se aparecer o erro `EBADDEVENGINES` ou uma versão menor que 11.16, atualize o Node ou rode `npm install -g npm@11.21.0`.

```bash
npm install
npm run dev:hologram  # abre http://localhost:5173
npm test              # testes
```

O CI também publica o build do protótipo como artefato (`hologram-lab`) em cada PR.

**Stack planejada:** TypeScript · Electron · Vercel AI SDK · PostgreSQL + pgvector · Three.js · sherpa-onnx.

**Alvo de hardware:** Windows 11 (inclusive Home), 8 a 16 GB de RAM, sem placa de vídeo dedicada.
