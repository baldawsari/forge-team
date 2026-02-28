import jwt, { type SignOptions } from 'jsonwebtoken';

export type AuthRole = 'admin' | 'agent' | 'dashboard-viewer';

export interface TokenPayload {
  sub: string;
  role: AuthRole;
  agentId?: string;
  iat: number;
  exp: number;
}

const DEV_SECRET = 'forgeteam-dev-secret-DO-NOT-USE-IN-PRODUCTION';
const JWT_SECRET = process.env.JWT_SECRET || DEV_SECRET;
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

if (JWT_SECRET === DEV_SECRET) {
  console.warn('[Auth] WARNING: Using default dev secret. Set JWT_SECRET in production.');
}

export function generateToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
  return jwt.sign(
    { sub: payload.sub, role: payload.role, agentId: payload.agentId },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY } as SignOptions
  );
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function generateAdminToken(): string {
  return generateToken({ sub: 'admin', role: 'admin' });
}

export function generateAgentToken(agentId: string): string {
  return generateToken({ sub: agentId, role: 'agent', agentId });
}

export function generateDashboardToken(): string {
  return generateToken({ sub: 'dashboard', role: 'dashboard-viewer' });
}
