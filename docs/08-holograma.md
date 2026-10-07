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
| Colapso para o núcleo + estrelas no fundo | compactação de contexto, que vira memória de longo prazo |
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
