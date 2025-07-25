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

  // Get turn order with usernames
  const turnOrderWithUsernames = room.turnOrder.map(clientId => {
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
    
    // Calculate available slots for each position using lineupConfig
    const availableSlots = {};
    let totalAvailableSlots = 0;
    
    // Use lineupConfig instead of hardcoded values
    lineupConfig.positions.forEach(posConfig => {
      const pos = posConfig.position;
      if (pos === 'FLEX' || pos === 'BENCH') return;
      
      const current = positionCounts[pos] || 0;
      const available = posConfig.maxDraftable - current;
      if (available > 0) {
        availableSlots[pos] = available;
        totalAvailableSlots += available;
      }
    });
    
    // Check FLEX and BENCH separately
    const flexConfig = lineupConfig.positions.find(p => p.position === 'FLEX');
    const benchConfig = lineupConfig.positions.find(p => p.position === 'BENCH');
    
    const flexAvailable = flexConfig ? (flexConfig.maxDraftable - (positionCounts.FLEX || 0)) : 0;
    const benchAvailable = benchConfig ? (benchConfig.maxDraftable - (positionCounts.BENCH || 0)) : 0;
    if (flexAvailable > 0) {
      availableSlots.FLEX = flexAvailable;
      totalAvailableSlots += flexAvailable;
    }
    if (benchAvailable > 0) {
      availableSlots.BENCH = benchAvailable;
      totalAvailableSlots += benchAvailable;
    }
    // If no slots available, don't pick any player
    if (totalAvailableSlots === 0) {
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
      res.json({ 
        success: false, 
        message: 'No available slots - lineup is full',
        selection: null
      });
      return;
    }
    let selectedPlayer = null;
    // Step 1: Determine if only Bench is open
    const onlyBenchOpen = Object.keys(availableSlots).every(pos => pos === 'BENCH' || availableSlots[pos] === 0);
    // Step 2: Filter Preferred List
    const userPreferences = room.preferredQueue[user.id] || [];
    console.log(`🎯 User preferences (${userPreferences.length}):`, userPreferences);
    console.log(`🎯 PREFERENCE ORDER MATTERS - First player should be picked if valid`);
    console.log(`🎯 Current user selections:`, userSelections);
    console.log(`🎯 Current position counts:`, positionCounts);
    let validPreferred = [];
    if (userPreferences.length > 0) {
      // First, check which preferred players are still in the pool
      console.log(`🔍 Checking preference list order: ${userPreferences.join(' → ')}`);
      const preferredInPool = userPreferences.map((pid, index) => {
        const player = room.pool.find(p => p.PlayerID === pid);
        if (!player) {
          console.log(`❌ SKIPPING #${index + 1}: Player ${pid} not found in pool (already picked by someone else)`);
        } else {
          console.log(`✅ FOUND #${index + 1}: Player ${pid} (${player.Name}) still available`);
        }
        return player;
      }).filter(Boolean);
      
      console.log(`🎯 After skipping unavailable players: ${preferredInPool.length}/${userPreferences.length} still in pool`);
      if (preferredInPool.length > 0) {
        console.log(`🎯 Remaining preferred players: ${preferredInPool.map(p => `${p.Name} (${p.Position})`).join(' → ')}`);
      }
      
      if (onlyBenchOpen && benchAvailable > 0) {
        // No need to filter, just take first preferred player in pool
        validPreferred = preferredInPool;
        console.log(`🎯 Only bench open - found ${validPreferred.length} preferred players in pool`);
      } else {
        // Filter for valid slot - STRICTLY FOLLOW PREFERENCE LIST ORDER
        console.log(`🔍 Filtering preferred players for valid slots (STRICTLY FOLLOWING PREFERENCE LIST ORDER):`);
        validPreferred = [];
        
        // Check each player in preference list order - NO POSITION PRIORITIZATION
        for (let i = 0; i < preferredInPool.length; i++) {
          const player = preferredInPool[i];
          const validation = isDraftValid(userSelections, player, lineupConfig);
          console.log(`  #${i + 1}: ${player.Name} (${player.Position}) - Valid: ${validation.valid}, Position: ${validation.position}`);
          if (validation.valid) {
            validPreferred.push(player);
            console.log(`  ✅ ADDED: ${player.Name} (${player.Position}) to valid list`);
            console.log(`  🎯 FOUND FIRST VALID PLAYER IN PREFERENCE ORDER - STOPPING SEARCH`);
            break;
          } else {
            console.log(`  ❌ SKIPPED: ${player.Name} (${player.Position}) - no valid slot, moving to next in preference list`);
          }
        }
        console.log(`🎯 Final filtered preferred list (${validPreferred.length} players): ${validPreferred.map(p => `${p.Name} (${p.Position})`).join(' → ')}`);
      }
    }
    
    // Step 3: Attempt Pick from Preferred List
    console.log(`🔍 STEP 3: Attempting to pick from preferred list (${validPreferred.length} valid players found)`);
    if (validPreferred.length > 0) {
      const preferredPlayer = validPreferred[0];
      console.log(`🎯 PICKING FIRST AVAILABLE FROM PREFERENCE LIST: ${preferredPlayer.Name} (${preferredPlayer.Position})`);
      console.log(`🎯 This was the first valid player after skipping unavailable ones`);
      console.log(`🎯 STRICTLY FOLLOWING PREFERENCE ORDER - NOT POSITION PRIORITY`);
      const validation = isDraftValid(userSelections, preferredPlayer, lineupConfig);
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
    } else {
      console.log(`❌ No valid preferred players found`);
      console.log(`🔍 REASON: Either no players in preference list or none have valid slots`);
    }
    
    // Step 4: Filter Main List (Only If Needed)
    console.log(`🔍 STEP 4: No preferred player found, checking main pool`);
    if (!selectedPlayer) {
      console.log(`🎯 No preferred player found, checking main pool`);
      let validMain = [];
      if (onlyBenchOpen && benchAvailable > 0) {
        // No need to filter, just take first available player in pool
        validMain = room.pool.slice();
        console.log(`🎯 Only bench open - taking first player from main pool`);
      } else {
        validMain = room.pool.filter(p => isDraftValid(userSelections, p, lineupConfig).valid);
        console.log(`🎯 Filtered main pool - found ${validMain.length} valid players`);
      }
      if (validMain.length > 0) {
        const player = validMain[0];
        console.log(`✅ PICKING FROM MAIN POOL: ${player.Name} (${player.Position})`);
        const validation = isDraftValid(userSelections, player, lineupConfig);
        player.rosterPosition = validation.position;
        const playerIndex = room.pool.findIndex(p => p.PlayerID === player.PlayerID);
        room.pool.splice(playerIndex, 1);
        if (!room.selections[user.id]) {
          room.selections[user.id] = [];
        }
        room.selections[user.id].push(player);
        selectedPlayer = player;
        selectedPlayer.autoPickSource = 'main-pool';
      }
    }
   
    if (selectedPlayer) {
      console.log(`✅ Auto-pick successful: ${user.username} auto-selected ${selectedPlayer.Name} (${selectedPlayer.Position}) -> ${selectedPlayer.rosterPosition}`);
      console.log(`🎯 SELECTION SUMMARY: Picked ${selectedPlayer.Name} (${selectedPlayer.Position}) from ${selectedPlayer.autoPickSource}`);
      console.log(`🎯 PREFERENCE ORDER RESPECTED: This was the first valid player in your preference list`);
      
      // SNAKE DRAFT: Move to next turn
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
              source: selectedPlayer.autoPickSource || 'auto-pick'
            }
          });
          return;
        }
        
        // SNAKE DRAFT: Reverse turn order for even rounds
        if (room.draftRound % 2 === 0) {
          // Even round - reverse the order
          room.turnOrder.reverse();
          console.log(`🔄 SNAKE DRAFT: Round ${room.draftRound} - Turn order reversed:`, room.turnOrder);
        } else {
          // Odd round - keep original order
          console.log(`🔄 SNAKE DRAFT: Round ${room.draftRound} - Turn order normal:`, room.turnOrder);
        }
        
        // Reset to first player in the new order
        room.currentTurnIndex = 0;
      }
      
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
        
        // SNAKE DRAFT: Reverse turn order for even rounds
        if (room.draftRound % 2 === 0) {
          // Even round - reverse the order
          room.turnOrder.reverse();
          console.log(`🔄 SNAKE DRAFT: Round ${room.draftRound} - Turn order reversed:`, room.turnOrder);
        } else {
          // Odd round - keep original order
          console.log(`🔄 SNAKE DRAFT: Round ${room.draftRound} - Turn order normal:`, room.turnOrder);
        }
        
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

