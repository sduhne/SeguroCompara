# Comparador de Seguros de Auto (MX) + Chat (Next.js)

SPA lista para conectar con APIs reales de aseguradoras o un agregador. Incluye chat con OpenAI Responses API.

## Requisitos
- Node 18+
- API key de OpenAI (colócala en `.env.local`)

## Instalación
```bash
npm i
npm run dev
```
Visita http://localhost:3000

## Configuración
1. Copia `.env.example` a `.env.local` y pon `OPENAI_API_KEY`.
2. Reemplaza los **mocks** en `app/api/quotes/route.ts` por conectores reales a carriers/aggregadores.
3. Agrega aviso de privacidad, consentimiento y controles ARCO antes de producción.

## Despliegue
- Vercel o similar. Asegura `OPENAI_API_KEY` como variable de entorno y secretos de conectores en el servidor.
