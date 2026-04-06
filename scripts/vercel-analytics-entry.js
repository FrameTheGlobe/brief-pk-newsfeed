/**
 * Browser entry for Vercel Web Analytics (vanilla / non-Next apps).
 * @see https://vercel.com/docs/analytics/quickstart — “Call the inject function”
 */
import { inject } from '@vercel/analytics';

inject({ framework: 'html' });
