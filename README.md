# HackerOne Program Scanner

A web application for scanning and viewing HackerOne bug bounty programs using the HackerOne API.

## Features

- Secure API credential management
- Real-time progress tracking during scans
- Comprehensive program data collection
- Advanced filtering and search capabilities
- Dark theme UI
- Fully dockerized deployment

## Prerequisites

- Docker and Docker Compose
- HackerOne API credentials (username and API token)

## Getting Started

1. Clone the repository
2. Ensure `h1-programs.md` is in the root directory
3. Run the application:

```bash
docker-compose up --build
```

4. Open your browser and navigate to `http://localhost:3000`
5. Enter your HackerOne username and API token
6. Click "Test Credentials" to verify
7. Click "Start Scan" to begin collecting program data

## Usage

- **Search**: Use the search box to find programs by handle or name
- **Filters**: Use the dropdown filters to narrow down results by:
  - Submission state (open/closed)
  - Program state (public/private)
  - Bounty offerings
  - Scope type
  - Currency

## API Endpoints

- `POST /api/test-credentials` - Test HackerOne API credentials
- `POST /api/scan` - Start scanning programs
- `GET /api/programs` - Get filtered program list
- `GET /api/programs/stats` - Get program statistics

## Technology Stack

- **Backend**: Node.js, Express, SQLite
- **Frontend**: React
- **Database**: SQLite
- **WebSocket**: Real-time progress updates

