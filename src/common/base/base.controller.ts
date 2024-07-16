import { AuthenticatedRequest, Context } from '../types';

export abstract class BaseController {
  protected getContext(req: AuthenticatedRequest): Context {
    return {
      user: req.user,
    };
  }
}
