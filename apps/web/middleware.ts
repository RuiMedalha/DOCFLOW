/**
 * DocFlow — Edge middleware: protect the (dashboard) route group.
 *
 * We can't read the localStorage auth token from edge middleware (it only
 * sees the request headers). Instead we set a `docflow-auth` HTTP cookie
 * via the AuthStore API client, and check it here. If the cookie is
 * absent for a (dashboard) route we redirect to /login.
 *
 * The /login page itself does its own token check via useEffect; this
 * middleware just enforces the redirect for an extra layer.
 */

import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED_PREFIXES = ['/dashboard', '/documents', '/banking', '/bank', '/reconciliation', '/crm', '/parties', '/payments', '/payables', '/inbox', '/settings', '/accountant', '/hr', '/scanner', '/copilot'];
const PUBLIC_PREFIXES = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/auth'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isPublic = PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!isProtected && !isPublic) {
    return NextResponse.next();
  }

  const tokenCookie = req.cookies.get('docflow-auth')?.value;
  const hasToken = Boolean(tokenCookie && tokenCookie !== 'undefined' && tokenCookie !== 'null');

  if (isProtected && !hasToken) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (isPublic && hasToken) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Skip Next internals + static files + the manifest.
     * Run middleware on everything else.
     */
    '/((?!_next/|api/|favicon.ico|manifest.json|icons/|.*\\..*).*)',
  ],
};