// Sentry disabled - can be re-enabled in the future
// import * as Sentry from '@sentry/nextjs';

export async function register() {
  // Sentry disabled
  // if (process.env.NEXT_RUNTIME === 'nodejs') {
  //   await import('../sentry.server.config');
  // }
  // if (process.env.NEXT_RUNTIME === 'edge') {
  //   await import('../sentry.edge.config');
  // }
}

export const onRequestError = (error: Error) => {
  // Sentry disabled - just log to console
  console.error('Request error:', error);
};
