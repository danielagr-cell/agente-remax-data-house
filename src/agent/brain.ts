import { generateWithFallback } from './llm';
import { createTools, type Repos } from './tools';
import type { Agente, Lead } from '../types';

export interface BrainDeps {
  systemPrompt: string;
  repos: Repos;
  agente: Agente;
  lead: Lead;
  onTool?: (name: string) => void;
}

export interface TurnResult {
  text: string;
  toolsUsed: string[];
  modelo: string;
}

/**
 * Corre un turno del agente. El AI SDK ejecuta el loop de tools internamente
 * (hasta stepCountIs), y la cadena de modelos aporta el fallback.
 */
export async function runAgentTurn(deps: BrainDeps, historial: any[], userContent: any): Promise<TurnResult> {
  const messages = [...historial, { role: 'user', content: userContent }];
  const tools = createTools({ agente: deps.agente, lead: deps.lead, repos: deps.repos, onTool: deps.onTool });

  const r = await generateWithFallback({ system: deps.systemPrompt, messages, tools });

  return { text: r.text, toolsUsed: nombresDeTools(r.steps), modelo: r.modelo };
}

export function nombresDeTools(steps: any[]): string[] {
  const nombres: string[] = [];
  for (const s of steps ?? []) {
    for (const c of s?.toolCalls ?? []) {
      if (c?.toolName) nombres.push(c.toolName);
    }
  }
  return nombres;
}
