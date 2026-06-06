import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const LANDING_URL = 'https://orbiwallet.xyz';

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  const { pathname } = request.nextUrl;

  // keys.orbiwallet.xyz root → go straight to landing
  if (host === 'keys.orbiwallet.xyz' && pathname === '/') {
    return NextResponse.redirect(LANDING_URL, { status: 301 });
  }

  // No session cookie → send to landing (matcher excludes /auth-callback so login flow is safe)
  if (!request.cookies.has('orbi_session')) {
    return NextResponse.redirect(LANDING_URL);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/send/:path*', '/receive/:path*', '/settings/:path*'],
};
