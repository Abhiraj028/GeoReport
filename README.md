# GeoTag

Minimal starter for GeoTag backend + frontend.

## Structure

- `backend/` - Express + PostgreSQL backend
- `frontend/` - Vite + React frontend

## Requirements

- Node 20+ (or latest LTS)
- PostgreSQL
- Supabase credentials for storage

## Backend

1. `cd backend`
2. Install dependencies: `npm install`
3. Create a `.env` file with:
   - `POSTGRES_USER`
   - `POSTGRES_PASSWORD`
   - `POSTGRES_DB`
   - `POSTGRES_HOST`
   - `POSTGRES_PORT`
   - `CORS_ORIGIN`
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `PORT` (optional)
4. Start the server with your preferred runner

> The backend currently uses `express`, `pg`, `zod`, and `@supabase/supabase-js`.

## Frontend

1. `cd frontend`
2. Install dependencies: `npm install`
3. Optional `.env` for API base (overrides dev proxy):
   - `VITE_API_BASE_URL` (defaults to `http://localhost:3000` in dev)
3. Run development mode: `npm run dev`

## Notes

- Backend routes are mounted under `/api/v1/reports`
- Device token handling is managed via cookie middleware
- Report clusters are created/updated based on nearest active cluster within 100m

## Quick start

```bash
cd backend && npm install
cd ../frontend && npm install
# run backend and frontend in separate terminals
cd backend && npx tsx src/server.ts
cd frontend && npm run dev
```
