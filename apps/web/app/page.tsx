import { redirect } from 'next/navigation';

/**
 * Root index — bounce straight to the dashboard. Middleware will redirect
 * unauthenticated users to /login, so this acts as the signed-in entry
 * point.
 */
export default function RootPage() {
  redirect('/dashboard');
}