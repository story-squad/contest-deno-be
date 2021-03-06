import { IRouter, Router } from '../../../../deps.ts';
import leaderboard from './leaderboard.ts';
import votes from './votes.ts';

export default (app: IRouter) => {
  console.log('Loading contest routers...');
  const contestRouter = Router();
  app.use('/contest', contestRouter);

  votes(contestRouter);
  leaderboard(contestRouter);

  console.log('Contest routers loaded.');
};
