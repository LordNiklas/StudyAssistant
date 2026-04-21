# Study Assistant

## What gets started

The app consists of three containers (services):

1. Frontend (web interface in your browser)
2. Backend (API)
3. PostgreSQL with pgvector (database)

All services are started together with Docker Compose.

## Prerequisites

You only need these two things:

1. Docker Desktop
2. An OpenAI API key (for AI features like embeddings/LLM)

Note: The app can still start without an OpenAI key, but AI features will not work.

## Step-by-step startup

### Step 1: Install Docker Desktop

1. Open https://www.docker.com/products/docker-desktop/
2. Download Docker Desktop for your operating system.
3. Install Docker Desktop.
4. Start Docker Desktop.
5. Wait until Docker is running (status should show "running").

### Step 2: Open the project folder in a terminal

1. Open a terminal.
2. Change into the project folder (the folder that contains `docker-compose.yml` and this README-File is in).

Example (replace the placeholders, app-folder is the folder this file is in):

```bash
cd /Users/<your-username>/.../<project-folder-name>
```

3. Check that you are in the correct folder:

```bash
ls
```

You should see at least `docker-compose.yml`, `backend`, and `frontend`.

### Step 3: Create the `.env` file

1. Stay in the project folder.
2. Create a file named `.env` (if it does not already exist):

```bash
touch .env
```

### Step 4: Fill the `.env` file

1. Open `.env` in an editor.
2. Paste these 3 lines and replace the placeholder values:

```env
OPENAI_API_KEY=your_openai_key
SESSION_SECRET=your_generated_secret_value
SESSION_COOKIE_SECURE=false
```

3. Generate a secure session secret with the following command:

```bash
openssl rand -base64 48
```

4. Copy the full output of the last command and replace the `SESSION_SECRET` placeholder with it.

Explanation:

1. `OPENAI_API_KEY`: your OpenAI key
2. `SESSION_SECRET`: the output from `openssl rand -base64 48`
3. `SESSION_COOKIE_SECURE=false`: required for local usage with `http://localhost`

Important: For local usage, `SESSION_COOKIE_SECURE` must remain `false`.

### Step 5: Start the app

Run the following command in the project folder:

```bash
docker compose up --build -d
```

What this does:

1. Docker builds images for frontend and backend.
2. Docker starts frontend, backend, and database.
3. Containers then run in the background (`-d`).

The first startup can take a few minutes.

### Step 6: Check that everything is running

1. Show container status:

```bash
docker compose ps
```

2. If everything is OK, services should show as status: "Up".
3. Open in your browser:
   - Frontend: http://localhost:5173
   - Backend health check: http://localhost:3000/api/health
   - Backend should show `"status": "ok"` 

If the health check returns a positive response, the backend is running correctly.

### Step 7: Load test data (recommended)

So you can test the app immediately, run following command in the project folder:

```bash
docker compose exec backend npm run seed:test-data:with-vectors
```

This command automatically does two things:

1. Creates test data (users, subjects, documents)
2. Generates embeddings for the documents

Test login from the test data (use them to login in the frontend):

1. Username: `peter.tester@local`
2. Password: `tester123`

## Important everyday commands

### View logs

All logs:

```bash
docker compose logs -f
```

Backend logs only:

```bash
docker compose logs -f backend
```

Frontend logs only:

```bash
docker compose logs -f frontend
```

### Stop the app

Stop containers:

```bash
docker compose down
```

Stop containers and delete database data:

```bash
docker compose down -v
```

Note: `-v` also deletes persisted DB data.

## Troubleshooting (if something does not start)

### Problem 1: Port already in use

Symptom: Startup shows an error like "port already allocated".

Solution:

1. Stop other local services using ports 5173, 3000, or 5432.
2. Start again:

```bash
docker compose up --build -d
```

### Problem 2: OpenAI errors for embeddings/LLM

Symptom: The app runs, but AI features fail.

Solution:

1. Check `.env` and make sure `OPENAI_API_KEY` is set correctly.
2. Restart containers:

```bash
docker compose down
docker compose up --build -d
```

### Problem 3: Containers do not start cleanly

Solution, in this order:

1. Read logs:

```bash
docker compose logs -f
```

2. Recreate everything:

```bash
docker compose down -v
docker compose up --build -d
```

## Technical overview (short)

1. `postgres`
  - Image: `ankane/pgvector:latest`
  - Persistence via Docker volume `postgres_data`
2. `backend`
  - Built from `backend/Dockerfile`
  - Port `3000`
  - Connects internally to host `postgres`
3. `frontend`
  - Built from `frontend/Dockerfile`
  - Nginx container port `80`, mapped to host `5173`
  - `/api` is forwarded internally to `backend:3000`
