import type { Request } from 'express';

/** Authenticated user as attached to the request by the JWT strategy. */
export interface AuthenticatedUser {
  id: string;
  email: string;
}

/** Express request enriched with per-request context set by this service. */
export interface RequestWithContext extends Request {
  requestId?: string;
  user?: AuthenticatedUser;
}
