import { logger } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { ServiceStatusService } from './service';

/** Admin routes over the status service; authorization is the router's (`ACCESS_ADMIN`). */
export function createAdminStatusHandlers(service: ServiceStatusService): {
  get: (req: Request, res: Response) => Promise<Response>;
  refresh: (req: Request, res: Response) => Promise<Response>;
} {
  const respond = async (res: Response, load: () => ReturnType<ServiceStatusService['get']>) => {
    try {
      return res.status(200).json(await load());
    } catch (error) {
      logger.error('[admin/status] Could not load service status', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      return res.status(500).json({ error: 'status_unavailable' });
    }
  };
  return {
    get: (_req, res) => respond(res, service.get),
    refresh: (_req, res) => respond(res, service.refresh),
  };
}
