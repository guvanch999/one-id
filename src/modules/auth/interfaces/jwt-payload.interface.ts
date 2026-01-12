export interface JwtPayload {
  sub: string;
  email: string;
  jti?: string;
  type?: 'access' | 'refresh';
}
