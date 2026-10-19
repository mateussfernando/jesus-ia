import type { AuditEvent } from '@jesus/shared/audit';
import type { SpendDay, SpendReply, SpendRequest } from '../bridge/protocol';
import type { DailySpend } from './egress/spend';
import { isValidDailyLimit } from './egress/spend';

/**
 * Pedidos do servidor da interface sobre o teto de gasto do dia (decisão 0023). O principal decide: confere a faixa,
 * grava a mudança no registro de auditoria e só então aplica. O registro é a fonte do teto (o último `spend.limit_set`
 * vale na próxima abertura), então uma mudança que não grava não vale: o teto fica como estava.
 */

export type SpendResult = Omit<SpendReply, 'type' | 'id'>;
type SpendLike = Pick<DailySpend, 'snapshot' | 'setLimit'>;

function day(spend: SpendLike): SpendDay {
  const snapshot = spend.snapshot();
  return {
    dayKey: snapshot.dayKey,
    spentPUsd: snapshot.settledPUsd,
    reservedPUsd: snapshot.reservedPUsd,
    limitPUsd: snapshot.limitPUsd,
  };
}

export async function handleSpendRequest(
  request: SpendRequest,
  spend: SpendLike,
  record: (event: AuditEvent) => Promise<unknown>,
): Promise<SpendResult> {
  if (request.op === 'status') return { ok: true, day: day(spend) };
  const limit = request.limitPUsd;
  if (!isValidDailyLimit(limit)) return { ok: false, day: day(spend), problem: 'range' };
  const previous = spend.snapshot().limitPUsd;
  try {
    await record({ type: 'spend.limit_set', limit_pusd: limit, previous_pusd: previous });
  } catch {
    return { ok: false, day: day(spend), problem: 'audit' };
  }
  spend.setLimit(limit);
  return { ok: true, day: day(spend) };
}
