require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const {setupAbly, getCurrentTurnOrder, getCurrentTurnUserId} = require('./ablyHandler');
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

  // Get current turn order with usernames (for snake draft)
  const currentTurnOrder = getCurrentTurnOrder(room);
  const turnOrderWithUsernames = currentTurnOrder.map(clientId => {
    const user = room.users.find(u => u.clientId === clientId);
    return user ? user.username : 'Unknown User';
  });

  res.json({
    roomId: req.params.roomId,
    userCount: room.users.length,
    users: room.users.map(u => ({ username: u.username })),
    started: room.started,
    poolSize: room.pool.length,
    createdAt: room.createdAt,
    currentRound: room.draftRound,
    selectionPhase: room.selectionPhase,
    turnOrder: room.turnOrder,
    turnOrderWithUsernames: turnOrderWithUsernames,
    currentTurnIndex: room.currentTurnIndex,
    maxRounds: room.maxRounds,
    isSnakeDraft: true
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
    const currentTurnUserId = getCurrentTurnUserId(room);
    if (currentTurnUserId !== user.id) {
      return res.status(400).json({ error: 'Not your turn' });
    }

    console.log(`🤖 Auto-pick requested by ${user.username} in room ${roomId}`);
    console.log(`🔍 User ID: ${user.id}, Client ID: ${user.clientId}`);
    console.log(`📋 Room preference queue keys: ${Object.keys(room.preferredQueue).join(', ')}`);
    
    const userSelections = room.selections[user.id] || [];
    const lineupConfig = lineupConfigs[0];
    const { isDraftValid } = require('./isDraftValid');
    
    let selectedPlayer = null;
    
    // STEP 1: CHECK PREFERENCE LIST FIRST (in exact order)
    const userPreferences = room.preferredQueue[user.clientId] || [];
    console.log(`🎯 Checking preference list for ${user.username}: ${userPreferences.length} players`);
    
    // Ensure preference list is properly initialized
    if (!room.preferredQueue[user.clientId]) {
      room.preferredQueue[user.clientId] = [];
    }
    
    if (userPreferences.length > 0) {
      console.log(`🎯 Preference list found: ${userPreferences.join(' → ')}`);
      
      // Go through preference list in EXACT ORDER (first to last)
      for (let i = 0; i < userPreferences.length; i++) {
        const preferredPlayerId = userPreferences[i];
        const player = room.pool.find(p => p.PlayerID === preferredPlayerId);
        
        if (player) {
          console.log(`✅ Found preferred player #${i + 1}: ${player.Name} (${player.Position})`);
          
          // Check if this player can be drafted (regardless of position priority)
          const validation = isDraftValid(userSelections, player, lineupConfig);
          if (validation.valid) {
            console.log(`🎯 PICKING FROM PREFERENCE LIST: ${player.Name} (${player.Position}) -> ${validation.position}`);
            
            // Assign roster position and select player
            player.rosterPosition = validation.position;
            const playerIndex = room.pool.findIndex(p => p.PlayerID === player.PlayerID);
            room.pool.splice(playerIndex, 1);
            
            if (!room.selections[user.id]) {
              room.selections[user.id] = [];
            }
            room.selections[user.id].push(player);
            
            // Remove from preference list - use clientId and create new array
            const updatedPreferences = userPreferences.filter(id => id !== preferredPlayerId);
            room.preferredQueue[user.clientId] = updatedPreferences;
            console.log(`🗑️ Removed ${player.Name} from preference list. Remaining: ${updatedPreferences.length}`);
            
            selectedPlayer = player;
            selectedPlayer.wasPreferred = true;
            selectedPlayer.autoPickSource = 'preference-list';
            selectedPlayer.preferenceOrder = i + 1;
            
            console.log(`✅ SUCCESS: Selected preferred player #${i + 1} - ${player.Name}`);
            break;
          } else {
            console.log(`❌ Preferred player #${i + 1} ${player.Name} cannot be drafted: ${validation.reason}`);
          }
        } else {
          console.log(`❌ Preferred player #${i + 1} (ID: ${preferredPlayerId}) not found in pool`);
          // Remove invalid player from preference list
          const updatedPreferences = userPreferences.filter(id => id !== preferredPlayerId);
          room.preferredQueue[user.clientId] = updatedPreferences;
          console.log(`🗑️ Removed invalid player ID ${preferredPlayerId} from preference list`);
        }
      }
      
      if (!selectedPlayer) {
        console.log(`❌ No valid players found in preference list, falling back to main logic`);
      }
    } else {
      console.log(`📋 No preference list found for ${user.username}, using main logic`);
    }
    
    // STEP 2: FALLBACK TO MAIN LOGIC (only if no preference list or no valid preferred players)
    if (!selectedPlayer) {
      console.log(`🔍 Using main auto-pick logic for ${user.username}`);
      
      // Count current positions
      const positionCounts = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0, FLEX: 0, BENCH: 0 };
      userSelections.forEach(player => {
        const pos = player.rosterPosition || player.Position;
        if (positionCounts.hasOwnProperty(pos)) {
          positionCounts[pos]++;
        }
      });
      
      console.log(`📊 Current position counts:`, positionCounts);
      
      // Priority-based selection from main pool - follow lineup requirements in logical order
      const priorities = [
        { position: 'QB', min: 1, name: 'Quarterback' },
        { position: 'RB', min: 2, name: 'Running Back' },
        { position: 'WR', min: 3, name: 'Wide Receiver' },
        { position: 'TE', min: 1, name: 'Tight End' },
        { position: 'K', min: 1, name: 'Kicker' },
        { position: 'DST', min: 1, name: 'Defense' }
      ];
      
      // Check each priority position
      for (const priority of priorities) {
        if ((positionCounts[priority.position] || 0) < priority.min) {
          console.log(`🎯 PRIORITY: Looking for ${priority.name} players`);
          const players = room.pool.filter(p => p.Position === priority.position);
          
          if (players.length > 0) {
            const player = players[0];
            console.log(`🎯 SELECTING ${priority.name}: ${player.Name}`);
            
            const validation = isDraftValid(userSelections, player, lineupConfig);
            player.rosterPosition = validation.position;
            
            const playerIndex = room.pool.findIndex(p => p.PlayerID === player.PlayerID);
            room.pool.splice(playerIndex, 1);
            
            if (!room.selections[user.id]) {
              room.selections[user.id] = [];
            }
            room.selections[user.id].push(player);
            
            selectedPlayer = player;
            selectedPlayer.autoPickSource = 'main-pool-priority';
            selectedPlayer.priorityPosition = priority.position;
            
            console.log(`✅ SUCCESS: Selected ${priority.name} ${player.Name}`);
            break;
          }
        }
      }
      
      // If no priority positions need filling, pick any valid player
      if (!selectedPlayer) {
        console.log(`🎯 No priority positions need filling, picking any valid player`);
        
        for (let i = 0; i < room.pool.length; i++) {
          const player = room.pool[i];
          const validation = isDraftValid(userSelections, player, lineupConfig);
          
          if (validation.valid) {
            console.log(`🎯 SELECTING ANY VALID: ${player.Name} (${player.Position})`);
            
            player.rosterPosition = validation.position;
            room.pool.splice(i, 1);
            
            if (!room.selections[user.id]) {
              room.selections[user.id] = [];
            }
            room.selections[user.id].push(player);
            
            selectedPlayer = player;
            selectedPlayer.autoPickSource = 'main-pool-any';
            
            console.log(`✅ SUCCESS: Selected ${player.Name} (${player.Position}) -> ${validation.position}`);
            break;
          }
        }
      }
      
      // Last resort - pick any player (even if invalid)
      if (!selectedPlayer && room.pool.length > 0) {
        console.log(`🎯 LAST RESORT: Picking any available player`);
        const anyPlayer = room.pool[0];
        anyPlayer.rosterPosition = anyPlayer.Position;
        room.pool.splice(0, 1);
        
        if (!room.selections[user.id]) {
          room.selections[user.id] = [];
        }
        room.selections[user.id].push(anyPlayer);
        
        selectedPlayer = anyPlayer;
        selectedPlayer.autoPickSource = 'last-resort';
        
        console.log(`✅ LAST RESORT: Selected ${anyPlayer.Name} (${anyPlayer.Position})`);
      }
    }
   
    if (selectedPlayer) {
      console.log(`✅ Auto-pick successful: ${user.username} selected ${selectedPlayer.Name} (${selectedPlayer.Position}) -> ${selectedPlayer.rosterPosition}`);
      console.log(`🎯 Source: ${selectedPlayer.autoPickSource}${selectedPlayer.wasPreferred ? ` (preferred #${selectedPlayer.preferenceOrder})` : ''}`);
      
      // SNAKE DRAFT: Move to next turn using the corrected logic
      room.currentTurnIndex++;
      
      // Check if round is complete
      if (room.currentTurnIndex >= room.turnOrder.length) {
        // Round complete - start next round
        room.draftRound++;
        
        // Check if draft is complete
        if (room.draftRound > room.maxRounds) {
          console.log(`🏁 Draft completed for room ${roomId}`);
          res.json({ 
            success: true, 
            message: 'Draft completed',
            selection: {
              player: selectedPlayer,
              wasPreferred: selectedPlayer.wasPreferred || false,
              source: selectedPlayer.autoPickSource || 'auto-pick',
              preferenceOrder: selectedPlayer.preferenceOrder
            }
          });
          return;
        }
        
        // SNAKE DRAFT: Keep original turnOrder, calculate order dynamically
        console.log(`🔄 SNAKE DRAFT: Round ${room.draftRound} - Turn order calculated dynamically`);
        
        // Reset to first player in the new order
        room.currentTurnIndex = 0;
      }
      
      res.json({ 
        success: true, 
        message: 'Auto-pick successful',
        selection: {
          player: selectedPlayer,
          wasPreferred: selectedPlayer.wasPreferred || false,
          source: selectedPlayer.autoPickSource || 'auto-pick',
          preferenceOrder: selectedPlayer.preferenceOrder
        }
      });
    } else {
      console.log(`❌ Auto-pick failed for ${user.username}: no valid players available`);
      
      // SNAKE DRAFT: Move to next turn even if auto-pick failed
      room.currentTurnIndex++;
      
      // Check if round is complete
      if (room.currentTurnIndex >= room.turnOrder.length) {
        // Round complete - start next round
        room.draftRound++;
        
        // Check if draft is complete
        if (room.draftRound > room.maxRounds) {
          console.log(`🏁 Draft completed for room ${roomId}`);
          res.json({ 
            success: false, 
            message: 'Draft completed - no valid players available',
            selection: null
          });
          return;
        }
        
        // SNAKE DRAFT: Keep original turnOrder, calculate order dynamically
        console.log(`🔄 SNAKE DRAFT: Round ${room.draftRound} - Turn order calculated dynamically`);
        
        // Reset to first player in the new order
        room.currentTurnIndex = 0;
      }
      
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