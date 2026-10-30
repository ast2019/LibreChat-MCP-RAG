import { PersianTools } from 'librechat-data-provider';
import { tool } from '@librechat/agents/langchain/tools';
import type { StructuredToolInterface } from '@librechat/agents/langchain/tools';
import type { CalendarInput, NormalizeInput, ToolOutcome } from './service';
import type { ServerRequest } from '~/types';
import { persianToolDefinitions } from './definitions';
import { runCalendar, runNormalize } from './service';
import { getPersianConfig } from './config';

function toText(outcome: ToolOutcome<Record<string, unknown>>): string {
  return outcome.ok ? JSON.stringify(outcome.value) : `Error: ${outcome.error}`;
}

/** The Persian calendar and spelling tools; both are local and never call a provider. */
export function createPersianTools(
  { req, toolNames }: { req: ServerRequest; toolNames: readonly string[] },
  { now = () => new Date() }: { now?: () => Date } = {},
): StructuredToolInterface[] {
  const builders: Record<PersianTools, () => StructuredToolInterface> = {
    [PersianTools.calendar]: () =>
      tool(
        async (input: CalendarInput) =>
          toText(runCalendar(input, { now: now(), config: getPersianConfig(req.config) })),
        { ...persianToolDefinitions[PersianTools.calendar] } as never,
      ) as unknown as StructuredToolInterface,
    [PersianTools.normalize]: () =>
      tool(async (input: NormalizeInput) => toText(runNormalize(input)), {
        ...persianToolDefinitions[PersianTools.normalize],
      } as never) as unknown as StructuredToolInterface,
  };
  return toolNames
    .filter((name): name is PersianTools => name in builders)
    .map((name) => builders[name]());
}
