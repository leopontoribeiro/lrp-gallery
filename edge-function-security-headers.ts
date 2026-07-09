import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "https://deno.land/std@0.168.0/http/cors.ts";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathname = url.pathname;

  // Forward to origin
  const originUrl = `${Deno.env.get("SUPABASE_URL")}${pathname}${url.search}`;

  const response = await fetch(originUrl, {
    method: req.method,
    headers: {
      ...Object.fromEntries(req.headers),
      "authorization": req.headers.get("authorization") || "",
    },
    body: req.body ? req : undefined,
  });

  // Create response with security headers
  const newResponse = new Response(response.body, response);

  // Content Security Policy
  newResponse.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "img-src 'self' data: https:; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "connect-src 'self' https://*.ingest.sentry.io; " +
      "frame-ancestors 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self'"
  );

  // CORS - Restricted by origin
  const allowedOrigins = [
    "https://souleandroribeiro.com.br",
    "https://www.souleandroribeiro.com.br",
    "https://gallery.souleandroribeiro.com.br",
    "http://localhost:3000",
    "http://localhost:5173",
  ];

  const origin = req.headers.get("origin") || "";
  if (allowedOrigins.includes(origin)) {
    newResponse.headers.set("Access-Control-Allow-Origin", origin);
    newResponse.headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS"
    );
    newResponse.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
    newResponse.headers.set("Access-Control-Allow-Credentials", "true");
  }

  // Security Headers
  newResponse.headers.set("X-Content-Type-Options", "nosniff");
  newResponse.headers.set("X-Frame-Options", "DENY");
  newResponse.headers.set("X-XSS-Protection", "1; mode=block");
  newResponse.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // HSTS
  newResponse.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload"
  );

  // Permissions Policy
  newResponse.headers.set(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()"
  );

  return newResponse;
});
