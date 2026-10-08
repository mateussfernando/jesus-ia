# Parte 8 — Holograma e interface

> [Índice da documentação](README.md) · Parte 8 de 10 · as seções seguem a numeração 8.x

## 8.1 A ideia

Inspirado nos hologramas do filme (esfera de partículas com anéis e fragmentos de arco; HUD circular do JARVIS), mas **branco-prateado** e **informativo**: cada elemento visual representa um dado real.

## 8.2 Gramática visual

| O que você vê | O que significa |
|---|---|
| Tamanho da esfera | quanto do contexto está em uso |
| Contorno tracejado | limite de contexto do modelo atual |
| Marcas no anel externo | porcentagem do contexto (preenchem no sentido horário a partir do topo) |
| Satélites em órbita | contas conectadas; **anel simples = só leitura, anel duplo = leitura e escrita** |
| Fios entre a esfera e os satélites | canais por onde passam as ações |
| **Losango no fio** | o Porteiro: toda ação passa por ele |
| Pulsos de luz | ferramenta em uso: **indo = ação**, **voltando = dados** |
| Chiado cinza nas partículas | a tarefa leu conteúdo externo (contaminada) |
| Superfície ondulando | o Jesus falando (sincronizado com o áudio) |
| Ondas na frente da esfera | ele está ouvindo você |
| Núcleo girando rápido, anéis acelerados | ele está pensando |
| Anel de gasto | custo do dia comparado ao seu limite |
| Colapso para o núcleo | compactação de contexto (automática: o Jesus limpa saídas antigas e compacta sozinho perto do limite) |
| Estrelas no fundo | memórias de longo prazo (as que o Jesus só deduz entram depois que você revisa) |
| Esfera se dividindo | subagentes trabalhando em paralelo |
| Código grande no centro | login por *device flow* (ex.: GitHub) |

## 8.3 Estados

Ocioso (respiração lenta) · ouvindo · pensando · falando · executando · aguardando você (âmbar) · bloqueado (vermelho, rápido) · compactando · offline (cinza, sem rotação).

## 8.4 Política de cor

- **Prateado é o normal** (branco frio com brilho).
- **Cor só aparece quando há risco:** âmbar = precisa de você; vermelho = bloqueado.
- Como o Jesus normalmente não tem cor, você percebe na hora quando ela aparece.
- **Paleta sugerida:** núcleo `#FFFFFF`; prata `#D3DCE6`; prata escura `#8693A2`; fundo `#04060A`; âmbar `#F0AD4A`; vermelho `#FF5B52`.

## 8.5 Modos de janela

- **Mini:** holograma pequeno no canto da tela, janela transparente e sempre no topo, com o clique atravessando; mostra o estado e a cor de alerta.
- **Central de comando:** tela cheia, estilo filme: holograma no centro, chat, registro do Porteiro, satélites com nomes e painel de memória.
- **Bandeja:** ícone com o status e o atalho de emergência.

## 8.6 Implementação

- **Three.js / React Three Fiber.** Esfera de 5 a 8 mil partículas (distribuição de Fibonacci) num `ShaderMaterial` com mistura aditiva. As deformações ficam no *vertex shader*, controladas por *uniforms* (`raio`, `fala`, `escuta`, `pensamento`, `turbulencia`, `compactacao`, `contaminacao`, `alerta`).
- **Brilho:** pós-processamento *bloom* (`UnrealBloomPass` ou `@react-three/postprocessing`).
- **Fala sincronizada:** um `AnalyserNode` da Web Audio no áudio do TTS fornece amplitude e bandas de frequência para os *uniforms*.
- **Desempenho:** limitar o *pixel ratio* a 2; pausar quando minimizado; reduzir partículas na bateria; alvo de 60 fps em GPU integrada.
- **Acessibilidade:** respeitar a configuração "reduzir movimento"; tudo o que o holograma mostra também existe em texto (registro e painel).

## 8.7 Interface segura

Resumo da seção [3.12](03-seguranca.md): cartões de confirmação num componente confiável, nenhuma imagem remota carregada sozinha, markdown sanitizado.

## 8.8 Protótipo da fase 0

**Status (08/10/2026):** aprovado pelo dono do projeto: 75 fps (o máximo da tela) num PC de 8 GB com placa de vídeo dedicada. Em GPU integrada ainda não foi medido; o modo leve automático continua valendo para esse caso.

### Onde está

| Caminho | O quê |
|---|---|
| `packages/hologram` | o componente `<Hologram snapshot={…} />`, reaproveitado depois pela janela do Electron |
| `packages/hologram/src/model.ts` | o **snapshot**: tudo o que o holograma mostra, validado com Zod (na fase 1 ele chega por IPC) |
| `packages/hologram/src/visual.ts` | lógica pura: estado → velocidades, cores e deformações; contexto → raio; gasto → nível; pulsos; suavização |
| `packages/hologram/src/shaders.ts` | shaders GLSL das partículas, dos anéis e das estrelas |
| `packages/hologram/src/describe.ts` | o mesmo conteúdo em texto (pt-BR), para o painel e leitores de tela |
| `apps/hologram-lab` | o laboratório: painel de controles, cenários roteirizados com legenda e medidor de fps |

### Como a gramática da seção 8.2 virou código

| Elemento | Implementação |
|---|---|
| Esfera e núcleo | 4.400 partículas em espiral de Fibonacci + 600 no núcleo, mistura aditiva, bloom em meia resolução |
| Tamanho = contexto | raio proporcional à raiz cúbica do contexto em uso (o **volume** acompanha o contexto), com piso para não sumir |
| Contorno tracejado | anel tracejado no raio máximo: a esfera encosta nele em 100% |
| Marcas no anel externo | 100 marcas; acendem no sentido horário a partir do topo |
| Satélites | órbita levemente inclinada; anel simples = leitura, duplo = leitura e escrita; rótulo com o nome |
| Fios, losango e pulsos | pulso branco indo (ação) ou voltando (dados); pulso **barrado** para no losango, que acende em vermelho |
| Chiado de contaminação | parte das partículas fica cinza, treme e pisca fora de fase; mais forte quando a tarefa está "suspeita" |
| Estados | perfis em `visual.ts` (rotação, respiração, ondas, redemoinho, agitação, colapso), com transição suave entre eles |
| Anel de gasto | arco externo; fica âmbar em 80% e vermelho em 100% do limite do dia |
| Compactação | colapso em espiral para o núcleo; as memórias novas acendem como estrelas no fundo |
| Subagentes | esferas menores que brotam da principal |
| *Device flow* | código grande no centro, com a esfera esmaecida atrás |

### Desempenho e acessibilidade

- *Pixel ratio* limitado a 2 (1 no modo leve); renderização pausada quando a aba ou janela fica oculta.
- **Modo leve automático:** cai para 2.400 partículas e bloom em 35% da resolução quando a taxa fica abaixo de 42 fps por 3 segundos seguidos, ou quando o aparelho informa que está na bateria.
- "Reduzir movimento" do sistema: animações a 25% da velocidade, sem pisca do alerta e sem paralaxe da câmera.
- Modo mini: fundo transparente (sem bloom, que apagaria a transparência), sem satélites, rótulos, estrelas nem anel de gasto.
- CSP restritiva no build (`script-src 'self'`, nada remoto).

### Como avaliar (no seu PC)

1. `npm install` e `npm run dev:hologram` (Node 24.18 ou mais novo, que traz o npm 11.16+; veja o README); abra `http://localhost:5173` no Chrome ou Edge. Ou baixe o artefato `hologram-lab` do CI e sirva a pasta com qualquer servidor estático.
2. Rode os cenários do painel: **Marcar dentista** (seção 6.7), **Ataque bloqueado**, **Convite precisa de você**, **Contexto cheio e compactação automática**, **Disjuntor da compactação**, **Subagentes**, **Login no GitHub** e **Orçamento do dia**.
3. Confira o medidor no canto superior esquerdo: o critério é **60 fps em GPU integrada** no modo completo. Ele também mostra se o modo leve entrou sozinho.
4. Diga o que mudar: cores, tamanho, velocidade, brilho, densidade, o que sobra ou falta.

**Limite do teste na nuvem:** o servidor da sessão não tem GPU, então lá o Chromium roda o WebGL por software (cerca de 6 fps). Os 60 fps só podem ser medidos no seu PC.
