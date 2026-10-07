import {
  accessLabels,
  describeSnapshot,
  formatPercent,
  formatTokens,
  formatUsd,
  Hologram,
  hologramStates,
  stateLabels,
  taintLabels,
} from '@jesus/hologram';
import type { PulseKind, QualityLevel, QualityPreference, Taint } from '@jesus/hologram';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { satelliteCatalog, scenarios } from './scenarios';
import { useLabStore } from './store';

const contextLimits = [128_000, 200_000, 1_000_000] as const;
const taints: readonly Taint[] = ['clean', 'tainted', 'suspicious'];
const taintShort: Record<Taint, string> = { clean: 'Limpa', tainted: 'Contaminada', suspicious: 'Suspeita' };
const pulseButtons: readonly { kind: PulseKind; label: string; title: string }[] = [
  { kind: 'action', label: 'ação →', title: 'Pulso indo: o Jesus age na conta' },
  { kind: 'data', label: '← dados', title: 'Pulso voltando: dados chegando da conta' },
  { kind: 'blocked', label: 'barrar', title: 'Ação barrada no losango do Porteiro' },
];
const qualityLabels: Record<QualityPreference, string> = { auto: 'Automático', full: 'Completo', light: 'Leve' };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function App() {
  const snapshot = useLabStore((s) => s.snapshot);
  const caption = useLabStore((s) => s.caption);
  const running = useLabStore((s) => s.runningScenario);
  const dispatch = useLabStore((s) => s.dispatch);
  const runScenario = useLabStore((s) => s.runScenario);
  const stopScenario = useLabStore((s) => s.stopScenario);
  const reset = useLabStore((s) => s.reset);
  const prune = useLabStore((s) => s.prune);

  const [quality, setQuality] = useState<QualityPreference>('auto');
  const [activeQuality, setActiveQuality] = useState<QualityLevel>('full');
  const [variant, setVariant] = useState<'full' | 'mini'>('full');
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const id = setInterval(prune, 500);
    return () => clearInterval(id);
  }, [prune]);

  const handleFps = useCallback((value: number) => setFps(Math.round(value)), []);

  const contextPercent = Math.round((snapshot.context.usedTokens / snapshot.context.limitTokens) * 100);
  const available = satelliteCatalog.filter((c) => !snapshot.satellites.some((s) => s.id === c.id));

  return (
    <div className="lab">
      <main className={`stage stage-${variant}`}>
        <Hologram
          snapshot={snapshot}
          quality={quality}
          variant={variant}
          onFps={handleFps}
          onQualityChange={setActiveQuality}
          className="hologram"
        />
        <div className="hud-badge" aria-live="off">
          <span className={fps > 0 && fps < 50 ? 'warn' : ''}>{fps > 0 ? `${fps} fps` : '— fps'}</span>
          <span>{activeQuality === 'light' ? 'modo leve' : 'completo'}</span>
        </div>
        {caption !== null && (
          <p className="caption" aria-live="polite">
            {caption}
          </p>
        )}
      </main>

      <aside className="panel">
        <header className="panel-header">
          <h1>
            Jesus <span>holograma · fase 0</span>
          </h1>
          <button type="button" className="ghost" onClick={reset}>
            Reiniciar
          </button>
        </header>

        <Section title="Cenários">
          <div className="scenarios">
            {scenarios.map((scenario) => (
              <button
                type="button"
                key={scenario.id}
                className={`scenario ${running === scenario.id ? 'active' : ''}`}
                onClick={() => (running === scenario.id ? stopScenario() : runScenario(scenario.id))}
                aria-pressed={running === scenario.id}
              >
                <strong>{scenario.title}</strong>
                <span>{scenario.description}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Estado">
          <div className="chips">
            {hologramStates.map((state) => (
              <button
                type="button"
                key={state}
                className={`chip chip-${state} ${snapshot.state === state ? 'on' : ''}`}
                aria-pressed={snapshot.state === state}
                onClick={() => dispatch({ type: 'state', state })}
              >
                {stateLabels[state]}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Contexto">
          <label className="slider">
            <span>
              {formatPercent(contextPercent / 100)} · {formatTokens(snapshot.context.usedTokens)} de {formatTokens(snapshot.context.limitTokens)}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={contextPercent}
              onChange={(e) =>
                dispatch({ type: 'context', usedTokens: (Number(e.target.value) / 100) * snapshot.context.limitTokens })
              }
            />
          </label>
          <div className="chips">
            {contextLimits.map((limit) => (
              <button
                type="button"
                key={limit}
                className={`chip ${snapshot.context.limitTokens === limit ? 'on' : ''}`}
                aria-pressed={snapshot.context.limitTokens === limit}
                onClick={() => dispatch({ type: 'contextLimit', limitTokens: limit })}
              >
                limite {formatTokens(limit)}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Gasto do dia">
          <label className="slider">
            <span>
              {formatUsd(snapshot.spend.todayUsd)} de {formatUsd(snapshot.spend.limitUsd)}
            </span>
            <input
              type="range"
              min={0}
              max={snapshot.spend.limitUsd}
              step={0.05}
              value={snapshot.spend.todayUsd}
              onChange={(e) => dispatch({ type: 'spend', todayUsd: Number(e.target.value) })}
            />
          </label>
        </Section>

        <Section title="Contaminação da tarefa">
          <div className="chips">
            {taints.map((taint) => (
              <button
                type="button"
                key={taint}
                title={taintLabels[taint]}
                className={`chip ${snapshot.taint === taint ? 'on' : ''}`}
                aria-pressed={snapshot.taint === taint}
                onClick={() => dispatch({ type: 'taint', taint })}
              >
                {taintShort[taint]}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Contas (satélites)">
          <ul className="accounts">
            {snapshot.satellites.map((satellite) => (
              <li key={satellite.id}>
                <div className="account-row">
                  <strong>{satellite.label}</strong>
                  <button
                    type="button"
                    className="ghost small"
                    title="Alternar acesso"
                    onClick={() => dispatch({ type: 'toggleAccess', satelliteId: satellite.id })}
                  >
                    {satellite.access === 'read' ? '◯' : '◎'} {accessLabels[satellite.access]}
                  </button>
                  <button
                    type="button"
                    className="ghost small"
                    aria-label={`Desconectar ${satellite.label}`}
                    onClick={() => dispatch({ type: 'removeSatellite', satelliteId: satellite.id })}
                  >
                    ✕
                  </button>
                </div>
                <div className="chips">
                  {pulseButtons.map((pulse) => (
                    <button
                      type="button"
                      key={pulse.kind}
                      title={pulse.title}
                      className={`chip small pulse-${pulse.kind}`}
                      onClick={() => dispatch({ type: 'pulse', satelliteId: satellite.id, kind: pulse.kind })}
                    >
                      {pulse.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {available.length > 0 && (
            <select
              className="select"
              value=""
              aria-label="Conectar conta"
              onChange={(e) => {
                const satellite = available.find((s) => s.id === e.target.value);
                if (satellite) dispatch({ type: 'addSatellite', satellite });
              }}
            >
              <option value="">+ conectar conta…</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
        </Section>

        <Section title="Subagentes, memória e login">
          <div className="chips">
            {[0, 1, 2, 3, 4].map((count) => (
              <button
                type="button"
                key={count}
                className={`chip ${snapshot.subagents === count ? 'on' : ''}`}
                aria-pressed={snapshot.subagents === count}
                onClick={() => dispatch({ type: 'subagents', count })}
              >
                {count === 0 ? 'sem subagentes' : `${count}`}
              </button>
            ))}
          </div>
          <div className="chips">
            <button type="button" className="chip" onClick={() => dispatch({ type: 'memories', add: 3 })}>
              +3 memórias ({snapshot.memoryCount})
            </button>
            <button
              type="button"
              className={`chip ${snapshot.deviceCode !== null ? 'on' : ''}`}
              aria-pressed={snapshot.deviceCode !== null}
              onClick={() => dispatch({ type: 'deviceCode', code: snapshot.deviceCode === null ? 'WDJB-MJHT' : null })}
            >
              código de login
            </button>
          </div>
        </Section>

        <Section title="Exibição">
          <div className="chips">
            {(Object.keys(qualityLabels) as QualityPreference[]).map((q) => (
              <button
                type="button"
                key={q}
                className={`chip ${quality === q ? 'on' : ''}`}
                aria-pressed={quality === q}
                onClick={() => setQuality(q)}
              >
                {qualityLabels[q]}
              </button>
            ))}
          </div>
          <div className="chips">
            {(['full', 'mini'] as const).map((v) => (
              <button
                type="button"
                key={v}
                className={`chip ${variant === v ? 'on' : ''}`}
                aria-pressed={variant === v}
                onClick={() => setVariant(v)}
              >
                {v === 'full' ? 'Central de comando' : 'Mini'}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Em texto">
          <ul className="describe" aria-live="polite">
            {describeSnapshot(snapshot).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>
      </aside>
    </div>
  );
}
