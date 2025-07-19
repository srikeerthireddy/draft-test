require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const {setupSocket} = require('./socketHandler');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const allowedOrigin = "http://localhost:3001";
const io = new Server(server, {
  cors: {
    origin: allowedOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ["websocket"], // WebSocket preferred
});

app.use(cors({
  origin: allowedOrigin,
  credentials: true,
}));
app.use(express.json());

const rooms = {};

// API configuration
// const API_URL = 'https://api.sportsdata.io/v3/nfl/scores/json/PlayersByAvailable';
// const API_KEY = 'b4197e932fce4f46b064f4af2f22bc98';
const localPlayers = require('./PlayerDetails.json');

// Create Room
app.post('/api/create-room', async (req, res) => {
  try {
    const roomId = generateRoomId();
    const playerPool = await generatePlayerPool();
    console.log(`Room ${roomId} created with player pool size: ${playerPool.length}`);
    rooms[roomId] = {
      hostId: null,
      users: [],
      selections: {},
      turnOrder: [],
      currentTurnIndex: 0,
      started: false,
      pool: playerPool,
      preferredQueue: {},
      timer: null,
      createdAt: new Date().toISOString(),
      disconnectedUsers: [],
      selectionPhase: 'main', // Changed from 'offense' to match socketHandler
      maxMainPlayers: 5,      // Changed from maxOffensePlayers
      maxBenchPlayers: 2,     // Changed from maxDefensePlayers
      draftRound: 1,
      maxRounds: 15
    };

    console.log(`Room ${roomId} created with ${playerPool.length} NFL players`);
    res.json({ roomId, message: 'NFL Draft Room created successfully' });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Get Room Info
app.get('/api/room/:roomId', (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.status(404).json({ error: 'Room not found' });

  res.json({
    roomId: req.params.roomId,
    userCount: room.users.length,
    users: room.users.map(u => ({ username: u.username })),
    started: room.started,
    poolSize: room.pool.length,
    createdAt: room.createdAt,
    currentRound: room.draftRound,
    selectionPhase: room.selectionPhase
  });
});

// Get All Rooms
app.get('/api/rooms', (req, res) => {
  const roomList = Object.keys(rooms).map(roomId => ({
    roomId,
    userCount: rooms[roomId].users.length,
    started: rooms[roomId].started,
    createdAt: rooms[roomId].createdAt,
    currentRound: rooms[roomId].draftRound
  }));
  res.json({ rooms: roomList, total: roomList.length });
});

app.get('/', (req, res) => {
  res.json({
    message: '🏈 Real-time NFL Team Selection Backend Running',
    activeRooms: Object.keys(rooms).length,
    timestamp: new Date().toISOString()
  });
});

// Utility: Room ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Replace generatePlayerPool to use only localPlayers
async function generatePlayerPool() {
  try {
    // Only use localPlayers, do not use axios or any API
    const rawPlayers = localPlayers;
    console.log(`✅ Loaded ${rawPlayers.length} players from local JSON file`);
    // Filter and create a balanced pool
    const positionGroups = {
      QB: [],
      RB: [],
      WR: [],
      TE: [],
      K: [],
      DST: []
    };
    for (const player of rawPlayers) {
      const pos = player.Position;
      if (pos === "QB") positionGroups.QB.push(player);
      else if (pos === "RB") positionGroups.RB.push(player);
      else if (pos === "WR") positionGroups.WR.push(player);
      else if (pos === "TE") positionGroups.TE.push(player);
      else if (pos === "K") positionGroups.K.push(player);
      else if (pos === "DST") positionGroups.DST.push(player);
    }
    const getRandom = (arr, count) => arr.sort(() => 0.5 - Math.random()).slice(0, count);
    const pool = [
      ...getRandom(positionGroups.QB, 8),
      ...getRandom(positionGroups.RB, 15),
      ...getRandom(positionGroups.WR, 20),
      ...getRandom(positionGroups.TE, 10),
      ...getRandom(positionGroups.K, 5),
      ...getRandom(positionGroups.DST, 5)
    ];
    console.log(`✅ Created balanced pool with ${pool.length} players`);
    return pool;
  } catch (error) {
    console.error("❌ Error loading player data from local file:", error.message);
    return [];
  }
}

// Setup Socket.IO
setupSocket(io, rooms);

const PORT = process.env.PORT || 8000;

server.listen(PORT, () => {
  console.log(`🏈 NFL Team Selection Server running on port ${PORT}`);
  console.log(`📊 Server started at ${new Date().toISOString()}`);
  console.log(`🌐 Server accessible at http://localhost:${PORT}`);
});

// Error handling for server
server.on('error', (error) => {
  console.error('Server error:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

app.get('/api/players', (req, res) => {
  res.json(localPlayers);
});