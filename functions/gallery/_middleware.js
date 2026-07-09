// Desativado — a lógica de OG foi movida para functions/_middleware.js (raiz).
// Este arquivo é um pass-through inofensivo.
export async function onRequest(context) {
  return context.next();
}
