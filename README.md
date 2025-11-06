# Strmarr

Strmarr is an IPTV Playlist STRM syncer for Playarr - an ecosystem to manage and organize IPTV Playlist Provider and their titles.

## Description

Strmarr is a Node.js application that synchronizes STRM files for the Playarr ecosystem. It works by:
1. Fetching a JSON mapping from a configured URL
2. Processing the mapping (file path -> stream URL)
3. Creating/updating STRM files with the stream URLs
4. Running automatically every hour

## Requirements

- Node.js >= 18.0.0
- npm or yarn
- Docker (for containerized deployment)

## Configuration

The application uses environment variables for configuration:

- `MEDIA_PATH`: Path where STRM files will be created (default: `/app/media`)
- `PLAYARR_BASE_URL`: Base URL of the Playarr API server (required). Example: `http://localhost:5000`
- `PLAYARR_API_KEY`: API key for authenticating with Playarr API (required)
- `SYNC_INTERVAL`: Cron expression for sync interval (default: `0 * * * *` - every hour)

### How It Works

The application automatically fetches data from two endpoints:
- `/api/playlist/movies/data` - For movie streams
- `/api/playlist/shows/data` - For TV show streams

Both endpoints are fetched using the base URL you provide. The responses are merged together to create a complete mapping of all STRM files.

### JSON Mapping Format

Each endpoint should return a JSON object mapping file paths to stream URLs:

```json
{
  "movies/Movie Name (2023).strm": "http://api.example.com/api/stream/...",
  "shows/Show Name (2022)/Season 1/Episode 1.strm": "http://api.example.com/api/stream/...",
  "movies/Another Movie (2024).strm": "http://api.example.com/api/stream/..."
}
```

The application merges mappings from both endpoints, so if the same file path exists in both (which shouldn't happen), the later one will override the earlier one.

## Installation

### Local Development

```bash
npm install
```

### Docker Deployment

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` with your configuration:
```env
MEDIA_PATH=/app/media
PLAYARR_BASE_URL=http://localhost:5000
PLAYARR_API_KEY=your_api_key_here
SYNC_INTERVAL=0 * * * *
```

3. Build and run with Docker Compose:
```bash
docker-compose up -d --build
```

Or build and run manually:
```bash
docker build -t strmarr .
docker run -d \
  --name strmarr \
  --env-file .env \
  -v /path/to/media:/app/media \
  --restart unless-stopped \
  strmarr
```

### GitHub Actions CI/CD 

This project includes a GitHub Actions workflow (`.github/workflows/docker-build.yml`) that automatically builds and pushes Docker images to GitHub Container Registry (ghcr.io).

**How it works:**
- On push to `main`/`master` branches or version tags (e.g., `v1.0.0`), the workflow builds and pushes the Docker image
- On pull requests, the workflow builds the image but does not push it
- Images are automatically tagged with:
  - Branch name for branch pushes
  - Semantic version tags (e.g., `v1.0.0`, `1.0`, `1`) for version tag pushes
  - `latest` tag for the default branch (main/master)
  - SHA-based tags for branch builds
- Images are pushed to GitHub Container Registry: `ghcr.io/<username>/strmarr`

**Using the CI-built image:**
```bash
# Pull from GitHub Container Registry (replace <username> with your GitHub username/organization)
docker pull ghcr.io/<username>/strmarr:main

# Or use the latest tag (from main/master branch)
docker pull ghcr.io/<username>/strmarr:latest

# For a specific version tag
docker pull ghcr.io/<username>/strmarr:v1.0.0
```

**Note:** Make sure to set the repository visibility to public, or authenticate with `ghcr.io` if the repository is private:
```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u <username> --password-stdin
```

## Usage

### Local Development

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

### Docker

```bash
# Start the container
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the container
docker-compose down
```

## How It Works

1. On startup, the application:
   - Validates required environment variables
   - Verifies the media directory exists
   - Runs an immediate synchronization

2. Every hour (or as configured), the application:
   - Fetches JSON mappings from `/api/playlist/movies/data` and `/api/playlist/shows/data`
   - Merges the mappings from both endpoints
   - Processes each entry in the merged mapping
   - Creates/updates STRM files with the corresponding URLs
   - Logs success/error counts for each media type and overall totals

3. STRM files are simple text files containing a single URL per line

## License

ISC
