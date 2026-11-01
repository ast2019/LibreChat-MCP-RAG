import { logger } from '@librechat/data-schemas';
import type {
  TDebugTrace,
  TDebugModeResponse,
  TDebugTraceSummary,
  TDebugSystemLogResponse,
  TDebugTraceListResponse,
} from 'librechat-data-provider';
import type {
  DebugTraceDetail,
  DebugTraceListRow,
  DebugTraceListParams,
} from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { DebugMode } from './mode';
import { isDebugLogLevel } from './mode';

export interface DebugTraceStore {
  listDebugTraces(
    params: DebugTraceListParams,
  ): Promise<{ total: number; entries: DebugTraceListRow[] }>;
  getDebugTrace(traceId: string): Promise<DebugTraceDetail | null>;
  clearDebugTraces(): Promise<number>;
}

export interface DebugAdminDeps {
  debugMode: DebugMode;
  traces: DebugTraceStore;
  /** This process's recent log lines */
  getSystemLog: () => TDebugSystemLogResponse;
}

type AdminRequest = Request & { user?: { id?: string; email?: string } };
type Handler = (req: AdminRequest, res: Response) => Promise<unknown> | unknown;

export interface DebugAdminHandlers {
  getDebugMode: Handler;
  updateDebugMode: Handler;
  listTraces: Handler;
  getTrace: Handler;
  clearTraces: Handler;
  getLogs: Handler;
}

const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);

function toSummary(row: DebugTraceListRow): TDebugTraceSummary {
  return { ...row, startedAt: iso(row.startedAt) };
}

/**
 * Admin «دیباگ»: the debug switch, the chat requests it traced and this server's recent log
 * lines. Reading needs the config read capability; switching it and clearing traces need
 * the config manage capability.
 */
export function createDebugAdminHandlers({
  debugMode,
  traces,
  getSystemLog,
}: DebugAdminDeps): DebugAdminHandlers {
  const withLines = async (): Promise<TDebugModeResponse> => ({
    ...(await debugMode.getState()),
    systemLogLines: getSystemLog().lines.length,
  });

  async function getDebugMode(_req: Request, res: Response) {
    try {
      res.status(200).json(await withLines());
    } catch (error) {
      logger.error('[admin/debug] Failed to read debug mode', error);
      res.status(500).json({ error: 'Failed to read debug mode' });
    }
  }

  async function updateDebugMode(req: AdminRequest, res: Response) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.enabled !== 'boolean') {
      return res.status(400).json({ error: '`enabled` must be true or false' });
    }
    if (body.level !== undefined && !isDebugLogLevel(body.level)) {
      return res.status(400).json({ error: 'Unknown log level' });
    }
    if (body.minutes !== undefined && (typeof body.minutes !== 'number' || body.minutes <= 0)) {
      return res.status(400).json({ error: '`minutes` must be a positive number' });
    }
    try {
      const adminId = req.user?.id ?? 'unknown';
      if (body.enabled) {
        await debugMode.enable({
          minutes: body.minutes as number | undefined,
          level: body.level as Parameters<DebugMode['enable']>[0]['level'],
          by: req.user?.email || adminId,
        });
      } else {
        await debugMode.disable();
      }
      logger.warn(
        `[admin/debug] Debug mode turned ${body.enabled ? 'on' : 'off'} by admin ${adminId}`,
      );
      res.status(200).json(await withLines());
    } catch (error) {
      logger.error('[admin/debug] Failed to change debug mode', error);
      res.status(500).json({ error: 'Failed to change debug mode' });
    }
  }

  async function listTraces(req: Request, res: Response) {
    const query = req.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(1, Number.parseInt(query.limit ?? '', 10) || 25), 100);
    const offset = Math.max(0, Number.parseInt(query.offset ?? '', 10) || 0);
    try {
      const { total, entries } = await traces.listDebugTraces({
        search: typeof query.search === 'string' ? query.search : undefined,
        problems: query.problems === 'true',
        limit,
        offset,
      });
      const body: TDebugTraceListResponse = {
        total,
        limit,
        offset,
        entries: entries.map(toSummary),
      };
      res.status(200).json(body);
    } catch (error) {
      logger.error('[admin/debug] Failed to list debug traces', error);
      res.status(500).json({ error: 'Failed to list debug traces' });
    }
  }

  async function getTrace(req: Request, res: Response) {
    try {
      const trace = await traces.getDebugTrace(String(req.params.id ?? ''));
      if (!trace) {
        return res.status(404).json({ error: 'Trace not found' });
      }
      const body: TDebugTrace = {
        ...toSummary(trace),
        stages: trace.stages.map((stage) => ({ ...stage, at: iso(stage.at) })),
        logs: trace.logs.map((line) => ({ ...line, at: iso(line.at) })),
      };
      res.status(200).json(body);
    } catch (error) {
      logger.error('[admin/debug] Failed to read a debug trace', error);
      res.status(500).json({ error: 'Failed to read the debug trace' });
    }
  }

  async function clearTraces(req: AdminRequest, res: Response) {
    try {
      const deleted = await traces.clearDebugTraces();
      logger.warn(`[admin/debug] ${deleted} debug traces cleared by admin ${req.user?.id}`);
      res.status(200).json({ deleted });
    } catch (error) {
      logger.error('[admin/debug] Failed to clear debug traces', error);
      res.status(500).json({ error: 'Failed to clear debug traces' });
    }
  }

  function getLogs(_req: Request, res: Response) {
    res.status(200).json(getSystemLog());
  }

  return { getDebugMode, updateDebugMode, listTraces, getTrace, clearTraces, getLogs };
}
