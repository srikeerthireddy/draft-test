# NFL Draft Application

A real-time NFL draft application with backend and frontend that supports TE, K, and DST positions.

## Features

- **Real-time Draft**: Live draft with Ably integration
- **Position Support**: QB, RB, WR, TE, K, DST, FLEX, and Bench positions
- **Auto-Pick Logic**: Intelligent auto-pick that prioritizes TE, K, and DST positions
- **Player Pool**: Balanced player pool from JSON data
- **Lineup Display**: Visual lineup grid showing all positions

## Quick Start

### Option 1: Run Both Servers Together (Recommended)

1. **Install dependencies:**
   ```bash
   npm run install-all
   ```

2. **Start both servers:**
   ```bash
   npm start
   ```

This will start:
- Backend server on http://localhost:8000
- Frontend server on http://localhost:3001

### Option 2: Run Servers Separately

1. **Start Backend:**
   ```bash
   cd backend
   npm install
   npm start
   ```

2. **Start Frontend (in a new terminal):**
   ```bash
   cd my-app
   npm install
   npm start
   ```

## How to Use

1. **Open the application** at http://localhost:3001
2. **Enter your username** and create or join a room
3. **Set your preferences** by selecting players in order of preference
4. **Start the draft** (host only)
5. **Draft players** during your turn or use auto-pick
6. **View your lineup** in the visual grid showing QB, RB, WR, TE, K, DST, FLEX, and Bench positions

## Auto-Pick Logic

The auto-pick system prioritizes:
1. **TE, K, DST positions** - These are filled first when empty
2. **Required positions** - All positions with minDraftable requirements
3. **Bench positions** - Additional players up to maxDraftable limits

## Lineup Configuration

The application uses the following lineup structure:
- **QB**: 1 starter, up to 3 total
- **RB**: 2 starters, up to 5 total
- **WR**: 3 starters, up to 6 total
- **TE**: 1 starter, up to 4 total
- **K**: 1 starter, up to 3 total
- **DST**: 1 starter, up to 3 total
- **FLEX**: 1 starter (accepts RB/WR/TE)
- **BENCH**: 2 bench spots

## Technical Details

- **Backend**: Node.js with Express and Ably for real-time communication
- **Frontend**: React with real-time updates
- **Player Data**: Loaded from PlayerDetails.json
- **Auto-Pick**: Enhanced logic that forces TE, K, DST selection when needed

## Troubleshooting

- If you see "Connection failed" errors, make sure both servers are running
- If TE, K, or DST positions aren't filling, check the browser console for debug logs
- The auto-pick system has multiple fallback mechanisms to ensure critical positions are filled 