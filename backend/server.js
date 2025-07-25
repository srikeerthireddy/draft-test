require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const {setupAbly} = require('./ablyHandler');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const axios = require('axios');
const lineupConfigs = require('./lineupConfigs.json');
const { isDraftValid } = require('./isDraftValid');



const app = express();
const server = http.createServer(app);
// Allow both 3000 and 3001 for local dev
const allowedOrigins = ["http://localhost:3000", "http://localhost:3001"];
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));


// Handle preflight requests for all routes
app.options('*', cors());
app.use(express.json());


const rooms = {};


// API configuration
// const API_URL = 'https://api.sportsdata.io/v3/nfl/scores/json/PlayersByAvailable';
// const API_KEY = 'b4197e932fce4f46b064f4af2f22bc98';
const localPlayers = require('./PlayerDetails.json');


// Setup Ably with API key
const ABLY_API_KEY = 'E_U1fw.iYMzEg:KNoWxsCQgLnZ9_oeCL3VWU0NUD3wUB_nbO2rVez2WnA';
const ablyHandler = setupAbly(rooms);


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
      selectionPhase: 'main', // Changed from 'offense' to match ablyHandler
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


// Ably token endpoint for client authentication
app.post('/api/ably-token', async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) {
    return res.status(400).json({ error: 'Client ID is required' });
  }


  const Ably = require('ably');
  const ably = new Ably.Rest({
    key: ABLY_API_KEY
  });


  try {
    const tokenRequest = await ably.auth.createTokenRequest({ clientId });
    res.json(tokenRequest);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create Ably token', details: err.message });
  }
});


// Join room endpoint
app.post('/api/join-room', (req, res) => {
  const { roomId, username, clientId } = req.body;
 
  if (!roomId || !username || !clientId) {
    return res.status(400).json({ error: 'Room ID, username, and client ID are required' });
  }


  const result = ablyHandler.handleJoinRoom(roomId, username, clientId);
 
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
 
  if (result.status === 'generating_pool') {
    return res.json({ status: 'generating_pool', message: 'Generating player pool...' });
  }
 
  res.json(result);
});


// Set preferred players endpoint
app.post('/api/set-preferred-players', (req, res) => {
  const { roomId, clientId, preferredPlayers } = req.body;
 
  if (!roomId || !clientId || !preferredPlayers) {
    return res.status(400).json({ error: 'Room ID, client ID, and preferred players are required' });
  }


  const result = ablyHandler.handleSetPreferredPlayers(roomId, clientId, preferredPlayers);
 
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
 
  res.json(result);
});


// Start draft endpoint
app.post('/api/start-draft', (req, res) => {
  const { roomId, clientId } = req.body;
 
  if (!roomId || !clientId) {
    return res.status(400).json({ error: 'Room ID and client ID are required' });
  }


  const result = ablyHandler.handleStartDraft(roomId, clientId);
 
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
 
  res.json(result);
});


// Select player endpoint
app.post('/api/select-player', (req, res) => {
  const { roomId, clientId, playerID } = req.body;
 
  if (!roomId || !clientId || !playerID) {
    return res.status(400).json({ error: 'Room ID, client ID, and player ID are required' });
  }


  const result = ablyHandler.handleSelectPlayer(roomId, clientId, playerID);
 
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
 
  res.json(result);
});


// Disconnect endpoint
app.post('/api/disconnect', (req, res) => {
  const { roomId, clientId } = req.body;
 
  if (!roomId || !clientId) {
    return res.status(400).json({ error: 'Room ID and client ID are required' });
  }


  const result = ablyHandler.handleDisconnect(roomId, clientId);
 
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
 
  res.json(result);
});


app.get('/api/lineup-configs', (req, res) => {
  res.json(lineupConfigs);
});



app.get('/', (req, res) => {
  res.json({
    message: '🏈 Real-time NFL Team Selection Backend Running with Ably',
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

    // Define the positions to be included in the draft
    const allowedPositions = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];

    // Filter players by the allowed positions
    const filteredPlayers = rawPlayers.filter(player => allowedPositions.includes(player.Position));
    console.log(`✅ Filtered players to ${filteredPlayers.length} based on allowed positions`);

    // Group players by position
    const positionGroups = {};
    allowedPositions.forEach(pos => {
      positionGroups[pos] = [];
    });
    for (const player of filteredPlayers) {
      if (positionGroups[player.Position]) {
        positionGroups[player.Position].push(player);
      }
    }

    // Log how many players per position
    allowedPositions.forEach(pos => {
      console.log(`[DEBUG] ${pos}: ${positionGroups[pos].length} players`);
    });

    // Helper to get random players, but not more than available
    const getRandom = (arr, count) => arr.sort(() => 0.5 - Math.random()).slice(0, Math.min(count, arr.length));

    // Set how many you want per position (adjust as needed)
    const pool = [
      ...getRandom(positionGroups.QB, 10),
      ...getRandom(positionGroups.RB, 20),
      ...getRandom(positionGroups.WR, 25),
      ...getRandom(positionGroups.TE, 15),
      ...getRandom(positionGroups.K, 15),
      ...getRandom(positionGroups.DST, 15)
    ];

    // Final pool size check
    console.log(`✅ Created balanced pool with ${pool.length} players`);
    return pool;
  } catch (error) {
    console.error("❌ Error loading player data from local file:", error.message);
    return [];
  }
}


// Auto-pick player endpoint
app.post('/api/auto-pick-player', (req, res) => {
  try {
    const { roomId, clientId } = req.body;
    
    if (!roomId || !clientId) {
      return res.status(400).json({ error: 'Missing roomId or clientId' });
    }

    const room = rooms[roomId];
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.started) {
      return res.status(400).json({ error: 'Draft has not started yet' });
    }

    // Find the user by clientId
    const user = room.users.find(u => u.clientId === clientId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if it's the user's turn
    const currentTurnUserId = room.turnOrder[room.currentTurnIndex];
    if (currentTurnUserId !== user.id) {
      return res.status(400).json({ error: 'Not your turn' });
    }

    console.log(`🤖 Manual auto-pick requested by ${user.username} in room ${roomId}`);
    console.log(`🔍 DEBUG: User ID: ${user.id}, Current turn user ID: ${currentTurnUserId}`);
    console.log(`🔍 DEBUG: Turn order: ${room.turnOrder.join(', ')}`);
    console.log(`🔍 DEBUG: Current turn index: ${room.currentTurnIndex}`);
    
    // SMART AUTO-PICK LOGIC: Check available slots first, then pick valid players
    const userSelections = room.selections[user.id] || [];
    const lineupConfig = lineupConfigs[0];
    
    // Calculate current position counts and available slots
    const positionCounts = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0, FLEX: 0, BENCH: 0 };
    
    userSelections.forEach(player => {
      const pos = player.rosterPosition || player.Position;
      if (positionCounts.hasOwnProperty(pos)) {
        positionCounts[pos]++;
      }
    });
    
    console.log(`📊 Current position counts:`, positionCounts);
    console.log(`🎯 Pool has ${room.pool.length} players`);
    
    // Calculate available slots for each position
    const availableSlots = {};
    const LINEUP = {
      QB: { main: 1, max: 3 },
      RB: { main: 2, max: 5 },
      WR: { main: 3, max: 6 },
      TE: { main: 1, max: 4 },
      K: { main: 1, max: 3 },
      DST: { main: 1, max: 3 },
      FLEX: { main: 1, max: 1 },
      BENCH: { main: 2, max: 2 }
    };
    
    // Check if there are any available slots at all
    let totalAvailableSlots = 0;
    Object.keys(LINEUP).forEach(pos => {
      if (pos === 'FLEX' || pos === 'BENCH') return;
      const current = positionCounts[pos] || 0;
      const available = LINEUP[pos].max - current;
      if (available > 0) {
        availableSlots[pos] = available;
        totalAvailableSlots += available;
      }
    });
    
    // Check FLEX and BENCH separately
    const flexAvailable = LINEUP.FLEX.max - (positionCounts.FLEX || 0);
    const benchAvailable = LINEUP.BENCH.max - (positionCounts.BENCH || 0);
    if (flexAvailable > 0) {
      availableSlots.FLEX = flexAvailable;
      totalAvailableSlots += flexAvailable;
    }
    if (benchAvailable > 0) {
      availableSlots.BENCH = benchAvailable;
      totalAvailableSlots += benchAvailable;
    }
    
    console.log(`🔍 Available slots:`, availableSlots);
    console.log(`🔍 Total available slots: ${totalAvailableSlots}`);
    
    // If no slots available, don't pick any player
    if (totalAvailableSlots === 0) {
      console.log(`❌ NO AVAILABLE SLOTS - Cannot pick any player`);
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
      res.json({ 
        success: false, 
        message: 'No available slots - lineup is full',
        selection: null
      });
      return;
    }
    
    let selectedPlayer = null;
    
    // PRIORITY 1: Check preference list first (if user has preferences)
    const userPreferences = room.preferredQueue[user.id] || [];
    if (userPreferences.length > 0) {
      console.log(`🎯 PRIORITY 1: Checking preference list (${userPreferences.length} players)`);
      
      for (const preferredPlayerId of userPreferences) {
        const preferredPlayer = room.pool.find(p => p.PlayerID === preferredPlayerId);
        if (preferredPlayer) {
          const validation = isDraftValid(userSelections, preferredPlayer, lineupConfig);
          if (validation.valid) {
            console.log(`✅ Found valid preferred player: ${preferredPlayer.Name} (${preferredPlayer.Position}) -> ${validation.position}`);
            preferredPlayer.rosterPosition = validation.position;
            const playerIndex = room.pool.findIndex(p => p.PlayerID === preferredPlayer.PlayerID);
            room.pool.splice(playerIndex, 1);
            if (!room.selections[user.id]) {
              room.selections[user.id] = [];
            }
            room.selections[user.id].push(preferredPlayer);
            selectedPlayer = preferredPlayer;
            selectedPlayer.wasPreferred = true;
            selectedPlayer.autoPickSource = 'preference-list';
            break;
          } else {
            console.log(`⏭️ Skipping preferred player ${preferredPlayer.Name} - cannot fit (${validation.reason})`);
          }
        }
      }
    }
    
    // PRIORITY 2: If no valid preferred player, pick by position priority (TE, K, DST first)
    if (!selectedPlayer) {
      console.log(`🎯 PRIORITY 2: No valid preferred players, checking by position priority`);
      
      // Priority order: TE, K, DST, then others
      const priorityPositions = ['TE', 'K', 'DST', 'QB', 'RB', 'WR'];
      
      for (const pos of priorityPositions) {
        if (availableSlots[pos] && availableSlots[pos] > 0) {
          console.log(`🎯 Looking for ${pos} players (${availableSlots[pos]} slots available)`);
          const posPlayers = room.pool.filter(p => p.Position === pos);
          
          if (posPlayers.length > 0) {
            const player = posPlayers[0];
            const validation = isDraftValid(userSelections, player, lineupConfig);
            if (validation.valid) {
              console.log(`✅ Found valid ${pos} player: ${player.Name} -> ${validation.position}`);
              player.rosterPosition = validation.position;
              const playerIndex = room.pool.findIndex(p => p.PlayerID === player.PlayerID);
              room.pool.splice(playerIndex, 1);
              if (!room.selections[user.id]) {
                room.selections[user.id] = [];
              }
              room.selections[user.id].push(player);
              selectedPlayer = player;
              selectedPlayer.autoPickSource = 'position-priority';
              break;
            }
          }
        }
      }
    }
    
    // PRIORITY 3: If still no player, pick any valid player efficiently
    if (!selectedPlayer) {
      console.log(`🎯 PRIORITY 3: Picking any valid player efficiently`);
      
      // Filter pool for players that can fit in available slots
      const validPlayers = room.pool.filter(player => {
        const validation = isDraftValid(userSelections, player, lineupConfig);
        return validation.valid;
      });
      
      if (validPlayers.length > 0) {
        const player = validPlayers[0];
        const validation = isDraftValid(userSelections, player, lineupConfig);
        console.log(`✅ Found valid player: ${player.Name} (${player.Position}) -> ${validation.position}`);
        player.rosterPosition = validation.position;
        const playerIndex = room.pool.findIndex(p => p.PlayerID === player.PlayerID);
        room.pool.splice(playerIndex, 1);
        if (!room.selections[user.id]) {
          room.selections[user.id] = [];
        }
        room.selections[user.id].push(player);
        selectedPlayer = player;
        selectedPlayer.autoPickSource = 'efficient-filter';
      }
    }
   
    if (selectedPlayer) {
      console.log(`✅ Auto-pick successful: ${user.username} auto-selected ${selectedPlayer.Name} (${selectedPlayer.Position}) -> ${selectedPlayer.rosterPosition}`);
      
      // Move to next turn
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
      
      res.json({ 
        success: true, 
        message: 'Auto-pick successful',
        selection: {
          player: selectedPlayer,
          wasPreferred: selectedPlayer.wasPreferred || false,
          source: selectedPlayer.autoPickSource || 'auto-pick'
        }
      });
    } else {
      console.log(`❌ Auto-pick failed for ${user.username}: no valid players available`);
      
      // Move to next turn even if auto-pick failed
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
      
      res.json({ 
        success: false, 
        message: 'Auto-pick failed - no valid players available',
        selection: null
      });
    }
    
    return;

  } catch (error) {
    console.error('Error in auto-pick endpoint:', error);
    res.status(500).json({ error: 'Internal server error during auto-pick' });
  }
});

const PORT = process.env.PORT || 8000;


server.listen(PORT, () => {
  console.log(`🏈 NFL Team Selection Server running on port ${PORT} with Ably`);
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


// Test Ably connection endpoint
app.get('/api/ably-test', async (req, res) => {
  try {
    const Ably = require('ably');
    const ably = new Ably.Rest({
      key: ABLY_API_KEY
    });


    // Test publishing a message to a test channel
    const testChannel = ably.channels.get('test-connection');
    await testChannel.publish('test', { message: 'Connection test successful', timestamp: new Date().toISOString() });
   
    res.json({
      status: 'success',
      message: 'Ably connection test successful',
      timestamp: new Date().toISOString(),
      apiKey: ABLY_API_KEY.substring(0, 10) + '...' // Only show first 10 chars for security
    });
  } catch (error) {
    console.error('Ably connection test failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Ably connection test failed',
      error: error.message
    });
  }
});


// Get Ably connection status
app.get('/api/ably-status', (req, res) => {
  try {
    const Ably = require('ably');
    const ably = new Ably.Rest({
      key: ABLY_API_KEY
    });


    res.json({
      status: 'ready',
      message: 'Ably REST client initialized successfully',
      apiKeyConfigured: !!ABLY_API_KEY,
      apiKeyLength: ABLY_API_KEY ? ABLY_API_KEY.length : 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to initialize Ably',
      error: error.message
    });
  }
});

