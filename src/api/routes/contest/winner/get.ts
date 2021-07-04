/** URL Scope: /contest/winners */

import { Router } from 'express';
import Container from 'typedi';
import { Logger } from 'winston';
import { Submissions } from '../../../../interfaces';
import { ClashService } from '../../../../services';
import { authHandler } from '../../../middlewares';

export default function contestWinnerRoute__get(route: Router) {
  const logger: Logger = Container.get('logger');
  const clashServiceInstance = Container.get(ClashService);

  route.get<
    never, // URL parameters
    Submissions.ISubItem, // Response body
    never, // Request body
    never // Query parameters
  >('/', authHandler(), async (req, res) => {
    try {
      const subs = await clashServiceInstance.getRecentWinner();
      res.status(200).json(subs);
    } catch (err) {
      logger.error(err);
      throw err;
    }
  });
}
