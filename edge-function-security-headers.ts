// ========== SUPABASE EDGE FUNCTION: Security Headers ==========
// Criar em Supabase > Edge Functions > security-headers

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: getSecurityHeaders({})
    });
  }

  // Proxiar requisição
  const response = await fetch(req);

  // Adicionar headers de segurança
  const headers = new Headers(response.headers);
  const securityHeaders = getSecurityHeaders(req);

  for (const [key, value] of Object.entries(securityHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
});

function getSecurityHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  const allowedOrigins = [
    'https://lrp-gallery.com',
    'https://www.lrp-gallery.com',
    'https://admin.lrp-gallery.com'
  ];

  const isAllowedOrigin = allowedOrigins.includes(origin || '');

  return {
    // CORS
    ...(isAllowedOrigin && {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-ID',
      'Access-Control-Max-Age': '3600',
      'Access-Control-Allow-Credentials': 'true'
    }),

    // Security Headers
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',

    // CSP (Content Security Policy)
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://cdn.jsdelivr.net https://js.sentry-cdn.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: https: blob:",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co https://sentry.io https://api.qrserver.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; '),

    // HSTS (HTTP Strict Transport Security)
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',

    // Disable caching for sensitive content
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0'
  };
}
