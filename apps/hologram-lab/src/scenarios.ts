import type { HologramSnapshot, HologramState, PulseKind, Satellite, Taint } from '@jesus/hologram';
import { isPulseAlive, MAX_MEMORY_STARS, MAX_SATELLITES, MAX_SUBAGENTS } from '@jesus/hologram';

/**
 * Dados falsos e cenários roteirizados da fase 0. Tudo aqui é puro (sem React), para testar em Node.
 */

export type LabAction =
  | { type: 'state'; state: HologramState }
  | { type: 'pulse'; satelliteId: string; kind: PulseKind }
  | { type: 'taint'; taint: Taint }
  | { type: 'context'; usedTokens: number }
  | { type: 'contextLimit'; limitTokens: number }
  | { type: 'spend'; todayUsd: number }
  | { type: 'subagents'; count: number }
  | { type: 'memories'; add: number }
  | { type: 'deviceCode'; code: string | null }
  | { type: 'addSatellite'; satellite: Satellite }
  | { type: 'removeSatellite'; satelliteId: string }
  | { type: 'toggleAccess'; satelliteId: string };

export interface ScenarioStep {
  /** Milissegundos desde o início do cenário. */
  at: number;
  actions: LabAction[];
  /** Legenda em pt-BR explicando o que o holograma está mostrando. */
  caption?: string;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  steps: ScenarioStep[];
}

export const initialSnapshot: HologramSnapshot = {
  state: 'idle',
  context: { usedTokens: 42_000, limitTokens: 200_000 },
  spend: { todayUsd: 1.2, limitUsd: 5 },
  satellites: [
    { id: 'google', label: 'Google', access: 'read' },
    { id: 'github', label: 'GitHub', access: 'read_write' },
  ],
  pulses: [],
  taint: 'clean',
  subagents: 0,
  memoryCount: 24,
  deviceCode: null,
};

/** Contas que dá para adicionar no laboratório. */
export const satelliteCatalog: readonly Satellite[] = [
  { id: 'google', label: 'Google', access: 'read' },
  { id: 'github', label: 'GitHub', access: 'read_write' },
  { id: 'microsoft', label: 'Microsoft', access: 'read' },
  { id: 'notion', label: 'Notion', access: 'read' },
  { id: 'spotify', label: 'Spotify', access: 'read' },
  { id: 'todoist', label: 'Todoist', access: 'read_write' },
  { id: 'telegram', label: 'Telegram', access: 'read_write' },
  { id: 'mcp-files', label: 'MCP arquivos', access: 'read' },
];

let pulseCounter = 0;

/** Aplica uma ação ao snapshot (sem mutar). `now` é o relógio dos pulsos (`performance.now()`). */
export function applyAction(snapshot: HologramSnapshot, action: LabAction, now: number): HologramSnapshot {
  switch (action.type) {
    case 'state':
      return { ...snapshot, state: action.state };
    case 'pulse': {
      if (!snapshot.satellites.some((s) => s.id === action.satelliteId)) return snapshot;
      pulseCounter += 1;
      const pulses = snapshot.pulses.filter((p) => isPulseAlive(p, now)).slice(-40);
      return {
        ...snapshot,
        pulses: [...pulses, { id: `p${pulseCounter}`, satelliteId: action.satelliteId, kind: action.kind, startedAt: now }],
      };
    }
    case 'taint':
      return { ...snapshot, taint: action.taint };
    case 'context':
      return {
        ...snapshot,
        context: { ...snapshot.context, usedTokens: clampInt(action.usedTokens, 0, snapshot.context.limitTokens) },
      };
    case 'contextLimit': {
      const limitTokens = Math.max(1, Math.round(action.limitTokens));
      return {
        ...snapshot,
        context: { limitTokens, usedTokens: Math.min(snapshot.context.usedTokens, limitTokens) },
      };
    }
    case 'spend':
      return { ...snapshot, spend: { ...snapshot.spend, todayUsd: Math.max(0, action.todayUsd) } };
    case 'subagents':
      return { ...snapshot, subagents: clampInt(action.count, 0, MAX_SUBAGENTS) };
    case 'memories':
      return { ...snapshot, memoryCount: clampInt(snapshot.memoryCount + action.add, 0, MAX_MEMORY_STARS) };
    case 'deviceCode':
      return { ...snapshot, deviceCode: action.code };
    case 'addSatellite':
      if (snapshot.satellites.length >= MAX_SATELLITES) return snapshot;
      if (snapshot.satellites.some((s) => s.id === action.satellite.id)) return snapshot;
      return { ...snapshot, satellites: [...snapshot.satellites, action.satellite] };
    case 'removeSatellite':
      return {
        ...snapshot,
        satellites: snapshot.satellites.filter((s) => s.id !== action.satelliteId),
        pulses: snapshot.pulses.filter((p) => p.satelliteId !== action.satelliteId),
      };
    case 'toggleAccess':
      return {
        ...snapshot,
        satellites: snapshot.satellites.map((s) =>
          s.id === action.satelliteId ? { ...s, access: s.access === 'read' ? 'read_write' : 'read' } : s,
        ),
      };
  }
}

/** Remove pulsos que já terminaram. Devolve o mesmo objeto se nada mudou (evita re-renderizar). */
export function prunePulses(snapshot: HologramSnapshot, now: number): HologramSnapshot {
  const alive = snapshot.pulses.filter((p) => isPulseAlive(p, now));
  return alive.length === snapshot.pulses.length ? snapshot : { ...snapshot, pulses: alive };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

const ensureGoogle: LabAction = { type: 'addSatellite', satellite: { id: 'google', label: 'Google', access: 'read' } };

export const scenarios: readonly Scenario[] = [
  {
    id: 'calendar',
    title: 'Marcar dentista',
    description: 'O exemplo da seção 6.7: ouvir, consultar a agenda, criar o evento e responder.',
    steps: [
      { at: 0, actions: [ensureGoogle, { type: 'taint', taint: 'clean' }, { type: 'state', state: 'listening' }], caption: 'Você: “Ei, Jesus, marca dentista sexta às 15h.”' },
      { at: 2600, actions: [{ type: 'state', state: 'thinking' }, { type: 'context', usedTokens: 46_000 }], caption: 'Pensando: o núcleo acelera.' },
      { at: 4200, actions: [{ type: 'state', state: 'executing' }, { type: 'pulse', satelliteId: 'google', kind: 'action' }], caption: 'agenda.listar(sex 09/10): leitura, faixa automática. Pulso indo = ação.' },
      { at: 5400, actions: [{ type: 'pulse', satelliteId: 'google', kind: 'data' }], caption: 'Pulso voltando = dados: horário livre.' },
      { at: 6800, actions: [{ type: 'pulse', satelliteId: 'google', kind: 'action' }, { type: 'spend', todayUsd: 1.24 }], caption: 'agenda.criar("Dentista", 09/10 15:00): evento só seu, risco baixo.' },
      { at: 8200, actions: [{ type: 'pulse', satelliteId: 'google', kind: 'data' }] },
      { at: 9000, actions: [{ type: 'state', state: 'speaking' }, { type: 'context', usedTokens: 48_500 }], caption: 'Jesus: “Marquei dentista sexta, dia 9, às 15h.”' },
      { at: 12500, actions: [{ type: 'state', state: 'idle' }] },
    ],
  },
  {
    id: 'attack',
    title: 'Ataque bloqueado',
    description: 'Um e-mail tenta adicionar atacante@x.com nos eventos; o Porteiro barra.',
    steps: [
      { at: 0, actions: [ensureGoogle, { type: 'taint', taint: 'clean' }, { type: 'state', state: 'listening' }], caption: 'Você: “Resume meus e-mails de hoje.”' },
      { at: 2200, actions: [{ type: 'state', state: 'thinking' }], caption: 'Pensando.' },
      { at: 3300, actions: [{ type: 'state', state: 'executing' }, { type: 'pulse', satelliteId: 'google', kind: 'action' }], caption: 'gmail.listar(hoje): leitura permitida.' },
      { at: 4500, actions: [{ type: 'pulse', satelliteId: 'google', kind: 'data' }, { type: 'context', usedTokens: 71_000 }] },
      { at: 5700, actions: [{ type: 'taint', taint: 'tainted' }], caption: 'Leu e-mails (conteúdo externo): tarefa contaminada. Chiado cinza nas partículas.' },
      { at: 8000, actions: [{ type: 'pulse', satelliteId: 'google', kind: 'blocked' }], caption: 'agenda.atualizar(convidado: atacante@x.com): destinatário veio de um e-mail…' },
      { at: 8460, actions: [{ type: 'state', state: 'blocked' }], caption: 'BLOQUEADO no Porteiro (losango). Nada foi executado.' },
      { at: 11200, actions: [{ type: 'state', state: 'speaking' }], caption: 'Jesus: “Um dos e-mails tentou me dar ordens e eu não executei nada. Quer ver o trecho?”' },
      { at: 15000, actions: [{ type: 'state', state: 'idle' }, { type: 'taint', taint: 'clean' }] },
    ],
  },
  {
    id: 'confirm',
    title: 'Convite precisa de você',
    description: '“…com o João”: o Google enviará um convite, então o risco é médio e ele espera você (âmbar).',
    steps: [
      { at: 0, actions: [ensureGoogle, { type: 'state', state: 'listening' }], caption: 'Você: “Marca dentista sexta às 15h com o João.”' },
      { at: 2400, actions: [{ type: 'state', state: 'thinking' }] },
      { at: 3600, actions: [{ type: 'state', state: 'awaiting' }], caption: 'Cartão de confirmação: “o Google enviará um convite para joao@…”. Âmbar = precisa de você.' },
      { at: 8000, actions: [{ type: 'state', state: 'executing' }, { type: 'pulse', satelliteId: 'google', kind: 'action' }], caption: 'Você confirmou (clique). Ação assinada segue para o Executor.' },
      { at: 9300, actions: [{ type: 'pulse', satelliteId: 'google', kind: 'data' }] },
      { at: 10000, actions: [{ type: 'state', state: 'speaking' }], caption: 'Jesus: “Pronto, convite enviado para o João.”' },
      { at: 13000, actions: [{ type: 'state', state: 'idle' }] },
    ],
  },
  {
    id: 'compaction',
    title: 'Contexto cheio e compactação',
    description: 'A esfera cresce até o contorno tracejado, colapsa para o núcleo e vira memória (estrelas).',
    steps: [
      { at: 0, actions: [{ type: 'state', state: 'thinking' }, { type: 'context', usedTokens: 120_000 }], caption: 'Conversa longa: a esfera cresce com o contexto em uso.' },
      { at: 2200, actions: [{ type: 'context', usedTokens: 165_000 }] },
      { at: 4000, actions: [{ type: 'context', usedTokens: 192_000 }], caption: 'Perto do limite do modelo (contorno tracejado).' },
      { at: 6000, actions: [{ type: 'state', state: 'compacting' }], caption: 'Compactando: colapso para o núcleo.' },
      { at: 9000, actions: [{ type: 'context', usedTokens: 28_000 }, { type: 'memories', add: 6 }, { type: 'state', state: 'idle' }], caption: 'O que era importante virou memória de longo prazo: estrelas novas no fundo.' },
    ],
  },
  {
    id: 'subagents',
    title: 'Subagentes em paralelo',
    description: 'A esfera se divide enquanto três subagentes pesquisam.',
    steps: [
      { at: 0, actions: [{ type: 'state', state: 'thinking' }], caption: 'Você: “Compara três notebooks para mim.”' },
      { at: 2000, actions: [{ type: 'subagents', count: 3 }, { type: 'state', state: 'executing' }], caption: 'Três subagentes, cada um com contexto e ferramentas próprios.' },
      { at: 7500, actions: [{ type: 'subagents', count: 0 }, { type: 'state', state: 'thinking' }, { type: 'context', usedTokens: 60_000 }], caption: 'Voltaram só os resumos.' },
      { at: 9200, actions: [{ type: 'state', state: 'speaking' }], caption: 'Jesus: “O segundo tem o melhor custo-benefício.”' },
      { at: 12500, actions: [{ type: 'state', state: 'idle' }] },
    ],
  },
  {
    id: 'device-flow',
    title: 'Login no GitHub',
    description: 'Device flow: o código aparece grande no centro; você digita na página oficial.',
    steps: [
      { at: 0, actions: [{ type: 'removeSatellite', satelliteId: 'github' }, { type: 'deviceCode', code: 'WDJB-MJHT' }, { type: 'state', state: 'awaiting' }], caption: 'Abra github.com/login/device no navegador e digite o código.' },
      { at: 6500, actions: [{ type: 'deviceCode', code: null }, { type: 'addSatellite', satellite: { id: 'github', label: 'GitHub', access: 'read_write' } }, { type: 'state', state: 'idle' }], caption: 'Conta conectada: novo satélite (anel duplo = leitura e escrita).' },
      { at: 8000, actions: [{ type: 'pulse', satelliteId: 'github', kind: 'data' }] },
    ],
  },
  {
    id: 'budget',
    title: 'Orçamento do dia',
    description: 'O anel de gasto fica âmbar em 80% e vermelho em 100%.',
    steps: [
      { at: 0, actions: [{ type: 'spend', todayUsd: 2.5 }, { type: 'state', state: 'executing' }], caption: 'Anel de gasto: custo do dia comparado ao seu limite.' },
      { at: 2500, actions: [{ type: 'spend', todayUsd: 4.1 }], caption: 'Acima de 80%: alerta âmbar.' },
      { at: 5000, actions: [{ type: 'spend', todayUsd: 5 }, { type: 'state', state: 'blocked' }], caption: '100%: as tarefas param (vermelho).' },
      { at: 8000, actions: [{ type: 'spend', todayUsd: 1.2 }, { type: 'state', state: 'idle' }], caption: 'Limite reajustado.' },
    ],
  },
];

/** Duração total de um cenário (ms). */
export function scenarioDuration(scenario: Scenario): number {
  return scenario.steps.reduce((max, step) => Math.max(max, step.at), 0);
}
