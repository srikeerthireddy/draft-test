const Ably = require('ably');
const fs = require('fs');
const path = require('path');
// const { AutoPickService } = require('./autoPickService');


// Player pool cache
let playerPoolCache = null;


// Initialize Ably
const ably = new Ably.Rest({
  key: 'E_U1fw.iYMzEg:KNoWxsCQgLnZ9_oeCL3VWU0NUD3wUB_nbO2rVez2WnA'
});


// Move publishChunked outside setupAbly so it is accessible to helper functions
function publishChunked(channel, event, array, chunkSize = 10, extra = {}) {
  // Dynamically adjust chunk size to stay under 60KB per message
  let i = 0;
  while (i < array.length) {
    let currentChunkSize = chunkSize;
    let chunk = array.slice(i, i + currentChunkSize);
    let size = Buffer.byteLength(JSON.stringify(chunk));
    // Reduce chunk size if too large
    while (size > 61440 && currentChunkSize > 1) { // 60KB safety margin
      currentChunkSize = Math.floor(currentChunkSize / 2);
      chunk = array.slice(i, i + currentChunkSize);
      size = Buffer.byteLength(JSON.stringify(chunk));
    }
    console.log('Publishing chunk', event, 'size:', size, 'bytes', 'chunkSize:', currentChunkSize);
    channel.publish(event, { ...extra, chunk, chunkIndex: Math.floor(i / currentChunkSize), totalChunks: Math.ceil(array.length / currentChunkSize) });
    i += currentChunkSize;
  }
}


function setupAbly(rooms) {
  console.log('Ably setup initialized');
 
  // Function to publish to a room channel
  function publishToRoom(roomId, event, data) {
    const channel = ably.channels.get(`draft-room-${roomId}`);
    return channel.publish(event, data);
  }


  // Function to get room channel
  function getRoomChannel(roomId) {
    return ably.channels.get(`draft-room-${roomId}`);
  }


  function publishGameStateChunks(roomId, gameState, clientId) {
    const channel = ably.channels.get(`draft-room-${roomId}`);
    // Chunk pool
    if (gameState.pool && Array.isArray(gameState.pool)) {
      publishChunked(channel, 'game-state-pool', gameState.pool, 10, clientId ? { targetClientId: clientId } : {});
    }
    // Chunk selections
    if (gameState.selections && typeof gameState.selections === 'object') {
      const selectionEntries = Object.entries(gameState.selections);
      publishChunked(channel, 'game-state-selections', selectionEntries, 10, clientId ? { targetClientId: clientId } : {});
    }
    // Send the rest of the game state (without pool/selections)
    const { pool, selections, ...rest } = gameState;
    channel.publish('game-state-meta', { ...rest, clientId });
  }


  // Handle room operations
  function handleJoinRoom(roomId, username, clientId) {
    console.log('Ably setup initialized');
    console.log(`🔍 JOIN ROOM DEBUG:`);
    console.log(`- Room ID received: "${roomId}"`);
    console.log(`- Username: "${username}"`);
    console.log(`- Client ID: "${clientId}"`);
    console.log(`- Available rooms:`, Object.keys(rooms));
    console.log(`- Room exists:`, !!rooms[roomId]);
   
    if (!roomId || !username) {
      return { error: "Room ID and username are required" };
    }
 
    // Check if room exists
    if (!rooms[roomId]) {
      console.log(`❌ Room ${roomId} not found. Creating new room...`);
     
      // AUTO-CREATE ROOM if it doesn't exist
      rooms[roomId] = {
        users: [],
        selections: {},
        disconnectedUsers: [],
        started: false,
        hostId: null,
        turnOrder: [],
        currentTurnIndex: 0,
        pool: [],
        preferredQueue: {},
        maxMainPlayers: 5,
        maxBenchPlayers: 2,
        selectionPhase: 'main',
        draftRound: 1,
        maxRounds: 15,
        createdAt: new Date().toISOString()
      };
     
      console.log(`✅ Created new room: ${roomId}`);
    }


    const room = rooms[roomId];


    // Initialize room properties if they don't exist
    if (!room.pool || room.pool.length === 0) {
      console.log('Generating player pool for room...');
      generatePlayerPool((pool) => {
        room.pool = pool;
        console.log(`Player pool generated with ${pool.length} players`);
        finishJoinRoom();
      });
      return { status: 'generating_pool' };
    }
   
    return finishJoinRoom();
   
    function finishJoinRoom() {
      if (!room.preferredQueue) {
        room.preferredQueue = {};
      }
      if (!room.maxMainPlayers) {
        room.maxMainPlayers = 5;
      }
      if (!room.maxBenchPlayers) {
        room.maxBenchPlayers = 2;
      }


      // Check if this is a reconnection
      const disconnectedUser = room.disconnectedUsers?.find(
        (u) => u.username.toLowerCase() === username.toLowerCase()
      );


      if (disconnectedUser) {
        console.log(`User ${username} reconnecting to room ${roomId}`);
        room.disconnectedUsers = room.disconnectedUsers.filter(
          (u) => u.username.toLowerCase() !== username.toLowerCase()
        );
        const user = { id: clientId, username: username.trim() };
        room.users.push(user);


        // Restore selections and preferences
        room.selections[clientId] = disconnectedUser.selections || [];
        room.preferredQueue[clientId] = disconnectedUser.preferredQueue || [];


        // Update turn order if game is running
        if (room.started && room.turnOrder.length > 0) {
          const turnIndex = room.turnOrder.findIndex(
            (oldId) => oldId === disconnectedUser.id
          );
          if (turnIndex !== -1) {
            room.turnOrder[turnIndex] = clientId;
            if (room.currentTurnIndex === turnIndex) {
              setTimeout(() => {
                startTurn(roomId, rooms);
              }, 1000);
            }
          }
        }


        if (disconnectedUser.timeout) {
          clearTimeout(disconnectedUser.timeout);
        }
      } else {
        const existingUser = room.users.find(
          (u) => u.username.toLowerCase() === username.toLowerCase()
        );


        if (existingUser) {
          return { error: "Username already taken in this room" };
        }


        const user = { id: clientId, username: username.trim() };
        room.users.push(user);
        room.selections[clientId] = [];
        room.preferredQueue[clientId] = [];


        if (!room.hostId) {
          room.hostId = clientId;
        }
      }


      // Broadcast updated room users to all clients
      console.log(`📢 Broadcasting room users for room ${roomId}:`);
      const usersWithPreferences = room.users;
      console.log(`Users in room: ${usersWithPreferences.map(u => u.username).join(', ')}`);
     
      publishToRoom(roomId, "room-users", usersWithPreferences);
      publishToRoom(roomId, "disconnected-users", room.disconnectedUsers || []);
     
      const isHost = clientId === room.hostId;
      publishToRoom(roomId, "host-status", {
        isHost,
        started: room.started,
        clientId
      });


      // Send current game state in chunks
      const gameState = {
        turnOrder: room.started
          ? room.turnOrder
              .map((id) => {
                const user = room.users.find((u) => u.id === id);
                return user ? user.username : null;
              })
              .filter(Boolean)
          : [],
        currentTurnIndex: room.currentTurnIndex,
        pool: room.pool || [],
        selections: getSelectionsWithUsernames(room),
        started: room.started,
        selectionPhase: room.selectionPhase || 'main',
        preferredQueue: room.preferredQueue,
        maxMainPlayers: room.maxMainPlayers,
        maxBenchPlayers: room.maxBenchPlayers
      };
      publishGameStateChunks(roomId, gameState, clientId);


      // Send personal game state to the joining user (meta only, no pool or selections)
      const { pool, selections, ...gameStateMeta } = gameState;
      publishToRoom(roomId, "game-state", {
        ...gameStateMeta,
        preferredQueue: room.preferredQueue[clientId] || [],
        clientId
      });


      // Also emit all users' preferences to all clients for UI (meta only)
      publishToRoom(roomId, "game-state", gameStateMeta);


      console.log(`✅ User ${username} successfully joined room ${roomId}`);
      return {
        status: 'success',
        roomId,
        username,
        isHost,
        gameState: {
          ...gameState,
          preferredQueue: room.preferredQueue[clientId] || []
        }
      };
    }
  }


  // Handle setting preferred players
  function handleSetPreferredPlayers(roomId, clientId, preferredPlayers) {
    const room = rooms[roomId];
    if (!room) {
      return {
        error: "Room not found"
      };
    }


    // Allow changes during draft
    // if (room.started) {
    //   return { error: "Cannot set preferences after game has started" };
    // }


    // Validate preferred players (should be array of PlayerIDs)
    if (!Array.isArray(preferredPlayers)) {
      return {
        error: "Preferred players must be an array"
      };
    }


    // Filter out invalid PlayerIDs and duplicates
    const validPreferredPlayers = preferredPlayers.filter((playerId, index) => {
      return typeof playerId === 'number' &&
        preferredPlayers.indexOf(playerId) === index &&
        room.pool.some(p => p.PlayerID === playerId);
    });


    room.preferredQueue[clientId] = validPreferredPlayers;


    const user = room.users.find(u => u.id === clientId);
    console.log(`📝 User ${user?.username} set preferred players: ${validPreferredPlayers.join(', ')}`);


    // Broadcast preference update to all clients
    publishToRoom(roomId, "preferred-players-updated", {
      preferredPlayers: validPreferredPlayers,
      message: `${user.username} updated their preferences.`,
      userId: clientId,
      username: user.username
    });


    // Emit updated user list with preferencesSubmitted flag
    const usersWithPreferences = room.users;
    publishToRoom(roomId, "room-users", usersWithPreferences);


    // Send updated game state in chunks
    publishGameStateChunks(roomId, {
      turnOrder: room.started ?
        room.turnOrder
        .map((id) => {
          const user = room.users.find((u) => u.id === id);
          return user ? user.username : null;
        })
        .filter(Boolean) :
        [],
      currentTurnIndex: room.currentTurnIndex,
      pool: room.pool || [],
      selections: getSelectionsWithUsernames(room),
      started: room.started,
      selectionPhase: room.selectionPhase || 'main',
      preferredQueue: room.preferredQueue,
      maxMainPlayers: room.maxMainPlayers,
      maxBenchPlayers: room.maxBenchPlayers
    }, clientId);


    return {
      status: 'success'
    };
  }


  // Handle starting the draft
  function handleStartDraft(roomId, clientId) {
    console.log('[Ably] handleStartDraft called with:', { roomId, clientId });
    const room = rooms[roomId];
    if (!room) {
      console.log('[Ably] Room not found:', roomId);
      return { error: "Room not found" };
    }

    console.log('[Ably] Room hostId:', room.hostId, 'Users:', room.users.map(u => u.id));
    if (clientId !== room.hostId) {
      console.log('[Ably] Not host:', clientId, 'Host is:', room.hostId);
      return { error: "Only host can start the draft" };
    }

    if (room.users.length < 2) {
      console.log('[Ably] Not enough users:', room.users.length);
      return { error: "Need at least 2 players to start" };
    }

    // Start the draft with proper snake draft initialization
    room.started = true;
    room.turnOrder = room.users.map(u => u.id);
    room.currentTurnIndex = 0;
    room.draftRound = 1; // Initialize draft round
    room.selectionPhase = 'main';

    console.log(`🚀 SNAKE DRAFT started for room ${roomId}`);
    console.log(`Initial turn order (Round 1): ${room.turnOrder.map(id => {
      const user = room.users.find(u => u.id === id);
      return user ? user.username : id;
    }).join(' → ')}`);

    // Chunk pool for draft-started
    publishChunked(ably.channels.get(`draft-room-${roomId}`), 'draft-started-pool', room.pool);
    
    // Send meta info with current turn order
    const currentTurnOrder = getCurrentTurnOrder(room);
    publishToRoom(roomId, 'draft-started-meta', {
      turnOrder: currentTurnOrder.map(id => {
        const user = room.users.find(u => u.id === id);
        return user ? user.username : null;
      }).filter(Boolean),
      currentUser: room.users.find(u => u.id === currentTurnOrder[0])?.username,
      selectionPhase: room.selectionPhase,
      draftRound: room.draftRound
    });

    // Start the first turn
    setTimeout(() => {
      startTurn(roomId, rooms);
    }, 1000);

    return { status: 'success' };
  }


  // Handle player selection
 // Handle player selection with preference list priority
function handleSelectPlayer(roomId, clientId, playerID) {
  const room = rooms[roomId];
  if (!room) {
    console.log(`[select-player] Room not found: roomId=${roomId}`);
    return { error: "Room not found" };
  }


  if (!room.started) {
    console.log(`[select-player] Draft has not started yet: roomId=${roomId}`);
    return { error: "Draft has not started yet" };
  }


  const currentTurnUserId = getCurrentTurnUserId(room);
  if (clientId !== currentTurnUserId) {
    console.log(`[select-player] Not your turn: clientId=${clientId}, expected=${currentTurnUserId}`);
    console.log(`[select-player] Current turn order: ${getCurrentTurnOrder(room).map(id => {
      const user = room.users.find(u => u.id === id);
      return user ? user.username : id;
    }).join(' → ')}`);
    return { error: "It's not your turn" };
  }


  // Find the player in the pool
  const playerIndex = room.pool.findIndex(p => p.PlayerID === playerID);
  if (playerIndex === -1) {
    console.log(`[select-player] Player not found in pool: playerID=${playerID}, poolSize=${room.pool.length}`);
    return { error: "Player not found in pool" };
  }


  const player = room.pool[playerIndex];
  const user = room.users.find(u => u.id === clientId);


  // Check if player is in preference list first
  const preferredQueue = room.preferredQueue[clientId] || [];
  const isPreferred = preferredQueue.includes(playerID);
 
  if (isPreferred) {
    console.log(`🌟 Player ${player.Name} found in ${user.username}'s preference list`);
    // Remove from preference list since it's being selected
    room.preferredQueue[clientId] = preferredQueue.filter(id => id !== playerID);
  } else {
    console.log(`📋 Player ${player.Name} selected from main pool by ${user.username}`);
  }


  // Validate position assignment using the lineup logic
  const userSelections = room.selections[clientId] || [];
  const lineupConfig = require('./lineupConfigs.json')[0];
  const { isDraftValid } = require('./isDraftValid');
  const validation = isDraftValid(userSelections, player, lineupConfig);
 
  if (!validation.valid || validation.position === 'N/A') {
    console.log(`❌ Invalid selection: ${player.Name} would result in N/A position for ${user.username}`);
    return { error: `No valid roster position available for ${player.Name}. This would result in an invalid lineup.` };
  }
 
  player.rosterPosition = validation.position;


  // Add player to user's selections
  if (!room.selections[clientId]) {
    room.selections[clientId] = [];
  }
  room.selections[clientId].push(player);


  // Remove player from pool
  room.pool.splice(playerIndex, 1);


  console.log(`🎯 ${user.username} selected ${player.Name} (${player.Position}) -> ${player.rosterPosition}${isPreferred ? ' [PREFERRED]' : ''}`);


  // Broadcast selection
  const channel = ably.channels.get(`draft-room-${roomId}`);
  publishChunked(channel, 'player-selected-pool', room.pool);
  publishChunked(channel, 'player-selected-selections', Object.entries(getSelectionsWithUsernames(room)), 10);
  channel.publish('player-selected-meta', {
    player,
    selectedBy: user.username,
    userId: clientId,
    autoSelected: false,
    wasPreferred: isPreferred
  });


  // Broadcast updated preferences
  publishToRoom(roomId, "preferred-players-updated", {
    preferredPlayers: room.preferredQueue[clientId] || [],
    message: isPreferred ? `${user.username} selected their preferred player ${player.Name}` : `${user.username} selected ${player.Name}`,
    userId: clientId,
    username: user.username
  });


  // Move to next turn
  moveToNextTurn(roomId, rooms);


  return { status: 'success' };
}


// Enhanced auto-pick using the new AutoPickService
function selectPlayerForUser(room, userId) {
  if (!room.pool || room.pool.length === 0) return null;

  const userSelections = room.selections[userId] || [];
  const lineupConfig = require('./lineupConfigs.json')[0];
  const { isDraftValid } = require('./isDraftValid');

  // Helper function to validate if a player can be drafted
  function canPlayerBeDrafted(player) {
    const validation = isDraftValid(userSelections, player, lineupConfig);
    if (!validation.valid) {
      console.log(`❌ Player ${player.Name} (${player.Position}) cannot be drafted: ${validation.reason}`);
    }
    return validation.valid;
  }

  let selectedPlayer = null;

  // Try to select from preferred queue first
  const preferredQueue = room.preferredQueue[userId] || [];
  for (let i = 0; i < preferredQueue.length; i++) {
    const playerId = preferredQueue[i];
    const playerIndex = room.pool.findIndex(p => p.PlayerID === playerId);
    if (playerIndex !== -1) {
      const player = room.pool[playerIndex];
      if (canPlayerBeDrafted(player)) {
        const validation = isDraftValid(userSelections, player, lineupConfig);
        player.rosterPosition = validation.position;
        room.pool.splice(playerIndex, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(player);
        room.preferredQueue[userId] = preferredQueue.filter(id => id !== playerId);
        console.log(`✅ Auto-selected preferred player: ${player.Name} (${player.Position}) -> ${validation.position}`);
        selectedPlayer = player;
        break;
      }
    }
  }

  // If no preferred player was selected, use ULTRA SIMPLE logic
  if (!selectedPlayer) {
    console.log(`🔍 Starting ULTRA SIMPLE auto-pick for user ${userId}`);
    
    // Count current positions
    const positionCounts = {
      QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0, FLEX: 0
    };
    
    userSelections.forEach(player => {
      const pos = player.rosterPosition || player.Position;
      if (positionCounts.hasOwnProperty(pos)) {
        positionCounts[pos]++;
      }
    });
    
    console.log(`📊 Current position counts:`, positionCounts);
    console.log(`🎯 Pool has ${room.pool.length} players`);
    
    // PRIORITY 1: Force select TE if missing
    if ((positionCounts.TE || 0) < 1) {
      console.log(`🎯 PRIORITY 1: Looking for TE players`);
      const tePlayers = room.pool.filter(p => p.Position === 'TE');
      console.log(`🎯 Found ${tePlayers.length} TE players:`, tePlayers.map(p => p.Name));
      
      if (tePlayers.length > 0) {
        const tePlayer = tePlayers[0];
        console.log(`🎯 SELECTING TE: ${tePlayer.Name}`);
        tePlayer.rosterPosition = 'TE';
        const playerIndex = room.pool.findIndex(p => p.PlayerID === tePlayer.PlayerID);
        room.pool.splice(playerIndex, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(tePlayer);
        selectedPlayer = tePlayer;
        console.log(`✅ SUCCESS: Selected TE ${tePlayer.Name}`);
      }
    }
    
    // PRIORITY 2: Force select K if missing
    if (!selectedPlayer && (positionCounts.K || 0) < 1) {
      console.log(`🎯 PRIORITY 2: Looking for K players`);
      const kPlayers = room.pool.filter(p => p.Position === 'K');
      console.log(`🎯 Found ${kPlayers.length} K players:`, kPlayers.map(p => p.Name));
      
      if (kPlayers.length > 0) {
        const kPlayer = kPlayers[0];
        console.log(`🎯 SELECTING K: ${kPlayer.Name}`);
        kPlayer.rosterPosition = 'K';
        const playerIndex = room.pool.findIndex(p => p.PlayerID === kPlayer.PlayerID);
        room.pool.splice(playerIndex, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(kPlayer);
        selectedPlayer = kPlayer;
        console.log(`✅ SUCCESS: Selected K ${kPlayer.Name}`);
      }
    }
    
    // PRIORITY 3: Force select DST if missing
    if (!selectedPlayer && (positionCounts.DST || 0) < 1) {
      console.log(`🎯 PRIORITY 3: Looking for DST players`);
      const dstPlayers = room.pool.filter(p => p.Position === 'DST');
      console.log(`🎯 Found ${dstPlayers.length} DST players:`, dstPlayers.map(p => p.Name));
      
      if (dstPlayers.length > 0) {
        const dstPlayer = dstPlayers[0];
        console.log(`🎯 SELECTING DST: ${dstPlayer.Name}`);
        dstPlayer.rosterPosition = 'DST';
        const playerIndex = room.pool.findIndex(p => p.PlayerID === dstPlayer.PlayerID);
        room.pool.splice(playerIndex, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(dstPlayer);
        selectedPlayer = dstPlayer;
        console.log(`✅ SUCCESS: Selected DST ${dstPlayer.Name}`);
      }
    }
    
    // PRIORITY 4: If no critical positions missing, pick any valid player
    if (!selectedPlayer) {
      console.log(`🎯 PRIORITY 4: No critical positions missing, picking any valid player`);
      
      for (let i = 0; i < room.pool.length; i++) {
        const player = room.pool[i];
        if (canPlayerBeDrafted(player)) {
          const validation = isDraftValid(userSelections, player, lineupConfig);
          player.rosterPosition = validation.position;
          room.pool.splice(i, 1);
          if (!room.selections[userId]) {
            room.selections[userId] = [];
          }
          room.selections[userId].push(player);
          selectedPlayer = player;
          console.log(`✅ SUCCESS: Selected ${player.Name} (${player.Position}) -> ${validation.position}`);
          break;
        }
      }
    }
    
    // PRIORITY 5: Last resort - pick any player
    if (!selectedPlayer) {
      console.log(`🎯 PRIORITY 5: Last resort - picking any player`);
      if (room.pool.length > 0) {
        const anyPlayer = room.pool[0];
        anyPlayer.rosterPosition = anyPlayer.Position;
        room.pool.splice(0, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(anyPlayer);
        selectedPlayer = anyPlayer;
        console.log(`✅ LAST RESORT: Selected ${anyPlayer.Name} (${anyPlayer.Position})`);
      }
    }
  }

  if (selectedPlayer) {
    console.log(`🎉 FINAL RESULT: Auto-selected ${selectedPlayer.Name} (${selectedPlayer.Position}) -> ${selectedPlayer.rosterPosition}`);
    return selectedPlayer;
  } else {
    console.log(`❌ FAILED: No player could be auto-selected for user ${userId}`);
    return null;
  }
}


// Helper function to count current positions
function getPositionCounts(userSelections) {
  const positionCounts = {
    QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0, FLEX: 0
  };
  userSelections.forEach(player => {
    const pos = player.rosterPosition || player.Position;
    if (positionCounts.hasOwnProperty(pos)) {
      positionCounts[pos]++;
    }
  });
  return positionCounts;
}


// Helper function to get open positions based on lineup requirements
function getOpenPositions(positionCounts, lineupConfig) {
  const openPositions = [];
  // Add positions that haven't met minDraftable requirement (starters + required)
  for (const posConfig of lineupConfig.positions) {
    const currentCount = positionCounts[posConfig.position] || 0;
    if (currentCount < posConfig.minDraftable) {
      openPositions.push(posConfig.position);
    }
  }
  // Add positions that can take more players up to maxDraftable (bench)
  for (const posConfig of lineupConfig.positions) {
    const currentCount = positionCounts[posConfig.position] || 0;
    if (currentCount < posConfig.maxDraftable && !openPositions.includes(posConfig.position)) {
      openPositions.push(posConfig.position);
    }
  }
  return openPositions;
}


// Helper function to count current positions
function getPositionCounts(userSelections) {
  const positionCounts = {
    QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0, FLEX: 0
  };
 
  userSelections.forEach(player => {
    const pos = player.rosterPosition || player.Position;
    if (positionCounts.hasOwnProperty(pos)) {
      positionCounts[pos]++;
    }
  });
 
  return positionCounts;
}


// Helper function to get open positions based on lineup requirements
function getOpenPositions(positionCounts, lineupConfig) {
  const openPositions = [];
 
  // First, add positions that haven't met minDraftable requirement (starters + required)
  for (const posConfig of lineupConfig.positions) {
    const currentCount = positionCounts[posConfig.position] || 0;
    if (currentCount < posConfig.minDraftable) {
      openPositions.push(posConfig.position);
    }
  }
 
  // Then, add positions that can take more players up to maxDraftable (bench)
  for (const posConfig of lineupConfig.positions) {
    const currentCount = positionCounts[posConfig.position] || 0;
    if (currentCount < posConfig.maxDraftable &&
        !openPositions.includes(posConfig.position)) {
      openPositions.push(posConfig.position);
    }
  }
 
  return openPositions;
}


// Enhanced handleSetPreferredPlayers to allow editing during draft
function handleSetPreferredPlayers(roomId, clientId, preferredPlayers) {
  const room = rooms[roomId];
  if (!room) {
    return {
      error: "Room not found"
    };
  }


  // Allow preference changes during draft (removed the restriction)
  console.log(`📝 Allowing preference update during draft for room ${roomId}`);


  // Validate preferred players (should be array of PlayerIDs)
  if (!Array.isArray(preferredPlayers)) {
    return {
      error: "Preferred players must be an array"
    };
  }


  // Filter out invalid PlayerIDs, duplicates, and already selected players
  const userSelections = room.selections[clientId] || [];
  const selectedPlayerIds = userSelections.map(p => p.PlayerID);
 
  const validPreferredPlayers = preferredPlayers.filter((playerId, index) => {
    return typeof playerId === 'number' &&
      preferredPlayers.indexOf(playerId) === index &&
      room.pool.some(p => p.PlayerID === playerId) &&
      !selectedPlayerIds.includes(playerId); // Exclude already selected players
  });


  room.preferredQueue[clientId] = validPreferredPlayers;


  const user = room.users.find(u => u.id === clientId);
  console.log(`📝 User ${user?.username} updated preferred players during draft: ${validPreferredPlayers.join(', ')}`);


  // Broadcast preference update to all clients
  publishToRoom(roomId, "preferred-players-updated", {
    preferredPlayers: validPreferredPlayers,
    message: `${user.username} updated their preferences${room.started ? ' during draft' : ''}.`,
    userId: clientId,
    username: user.username,
    duringDraft: room.started
  });


  // Emit updated user list
  const usersWithPreferences = room.users;
  publishToRoom(roomId, "room-users", usersWithPreferences);


  // Send updated game state in chunks
  publishGameStateChunks(roomId, {
    turnOrder: room.started ?
      room.turnOrder
      .map((id) => {
        const user = room.users.find((u) => u.id === id);
        return user ? user.username : null;
      })
      .filter(Boolean) :
      [],
    currentTurnIndex: room.currentTurnIndex,
    pool: room.pool || [],
    selections: getSelectionsWithUsernames(room),
    started: room.started,
    selectionPhase: room.selectionPhase || 'main',
    preferredQueue: room.preferredQueue,
    maxMainPlayers: room.maxMainPlayers,
    maxBenchPlayers: room.maxBenchPlayers
  }, clientId);


  return {
    status: 'success'
  };
}


// Also update the autoSelectForDisconnectedUser function to handle the case where no player is selected
function autoSelectForDisconnectedUser(roomId, rooms, userId, username) {
  const room = rooms[roomId];
  if (!room) return;


  // Clear any existing timer
  if (room.turnTimer) {
    clearInterval(room.turnTimer);
    room.turnTimer = null;
  }


  console.log(`🤖 Auto-selecting for ${username} in room ${roomId}`);


  const selection = selectPlayerForUser(room, userId);
  if (selection) {
    const channel = new (require('ably')).Rest({
      key: 'E_U1fw.iYMzEg:KNoWxsCQgLnZ9_oeCL3VWU0NUD3wUB_nbO2rVez2WnA'
    }).channels.get(`draft-room-${roomId}`);
    publishChunked(channel, 'player-selected-pool', room.pool);
    publishChunked(channel, 'player-selected-selections', Object.entries(getSelectionsWithUsernames(room)), 10);
    channel.publish('player-selected-meta', {
      player: selection,
      selectedBy: username,
      userId: userId,
      autoSelected: true,
      wasPreferred: selection.wasPreferred || false
    });
  } else {
    // No valid player could be auto-selected, log this and notify
    console.log(`⚠️ Could not auto-select any valid player for ${username}`);
    const channel = new (require('ably')).Rest({
      key: 'E_U1fw.iYMzEg:KNoWxsCQgLnZ9_oeCL3VWU0NUD3wUB_nbO2rVez2WnA'
    }).channels.get(`draft-room-${roomId}`);
    channel.publish('auto-select-failed', {
      username: username,
      userId: userId,
      reason: 'No valid players available for any open roster position'
    });
  }
 
  // Always move to next turn regardless of whether a player was selected
  moveToNextTurn(roomId, rooms);
}


  // Handle disconnection
  function handleDisconnect(roomId, clientId) {
    const room = rooms[roomId];
    if (!room) return;


    const user = room.users.find(u => u.id === clientId);
    if (!user) return;


    console.log(`🔌 User ${user.username} disconnected from room ${roomId}`);


    // Remove from active users
    room.users = room.users.filter(u => u.id !== clientId);


    // If draft hasn't started, remove from turnOrder as well
    if (!room.started && Array.isArray(room.turnOrder)) {
      room.turnOrder = room.turnOrder.filter(id => id !== clientId);
    }


    // Add to disconnected users with timeout
    const disconnectedUser = {
      id: clientId,
      username: user.username,
      selections: room.selections[clientId] || [],
      preferredQueue: room.preferredQueue[clientId] || [],
      disconnectedAt: new Date().toISOString()
    };


    room.disconnectedUsers.push(disconnectedUser);


    // Set timeout for auto-selection if game is running
    if (room.started) {
      const turnIndex = room.turnOrder.findIndex(id => id === clientId);
      if (turnIndex !== -1 && turnIndex === room.currentTurnIndex) {
        // It's their turn, auto-select after 30 seconds
        const timeout = setTimeout(() => {
          autoSelectForDisconnectedUser(roomId, rooms, clientId, user.username);
        }, 30000);
        disconnectedUser.timeout = timeout;
      }
    }


    // Update host if needed
    if (room.hostId === clientId && room.users.length > 0) {
      room.hostId = room.users[0].id;
      publishToRoom(roomId, "host-status", {
        isHost: true,
        started: room.started,
        clientId: room.hostId
      });
    }


    // Broadcast updated users
    const usersWithPreferences = getUsersWithPreferencesSubmitted(room);
    publishToRoom(roomId, "room-users", usersWithPreferences);
    publishToRoom(roomId, "disconnected-users", room.disconnectedUsers);


    return { status: 'success' };
  }


  // Handle auto-pick player
  function handleAutoPickPlayer(roomId, clientId) {
    const room = rooms[roomId];
    if (!room) {
      console.log(`[auto-pick] Room not found: roomId=${roomId}`);
      return { error: "Room not found" };
    }


    if (!room.started) {
          console.log(`[auto-pick] Draft has not started yet: roomId=${roomId}`);
    return { error: "Draft has not started yet" };
  }


  const currentTurnUserId = getCurrentTurnUserId(room);
  if (clientId !== currentTurnUserId) {
    console.log(`[auto-pick] Not your turn: clientId=${clientId}, expected=${currentTurnUserId}`);
    return { error: "It's not your turn" };
  }


    const user = room.users.find(u => u.id === clientId);
    if (!user) {
      return { error: "User not found" };
    }


    console.log(`🤖 Manual auto-pick requested by ${user.username} in room ${roomId}`);


    // Use the auto-pick service
    const selection = selectPlayerForUser(room, clientId);
   
    if (selection) {
      console.log(`✅ Auto-pick successful: ${user.username} auto-selected ${selection.Name} (${selection.Position}) -> ${selection.rosterPosition}`);
     
      // Broadcast selection
      const channel = ably.channels.get(`draft-room-${roomId}`);
      publishChunked(channel, 'player-selected-pool', room.pool);
      publishChunked(channel, 'player-selected-selections', Object.entries(getSelectionsWithUsernames(room)), 10);
      channel.publish('player-selected-meta', {
        player: selection,
        selectedBy: user.username,
        userId: clientId,
        autoSelected: true,
        wasPreferred: selection.wasPreferred || false,
        autoPickSource: selection.autoPickSource || 'unknown'
      });


      // Broadcast updated preferences if a preferred player was selected
      if (selection.wasPreferred) {
        channel.publish("preferred-players-updated", {
          preferredPlayers: room.preferredQueue[clientId] || [],
          message: `${user.username} auto-selected their preferred player ${selection.Name}`,
          userId: clientId,
          username: user.username,
          autoSelected: true
        });


        // Send updated game state chunks to reflect preference changes
        publishGameStateChunks(roomId, {
          turnOrder: room.started ?
            room.turnOrder
            .map((id) => {
              const user = room.users.find((u) => u.id === id);
              return user ? user.username : null;
            })
            .filter(Boolean) :
            [],
          currentTurnIndex: room.currentTurnIndex,
          pool: room.pool || [],
          selections: getSelectionsWithUsernames(room),
          started: room.started,
          selectionPhase: room.selectionPhase || 'main',
          preferredQueue: room.preferredQueue,
          maxMainPlayers: room.maxMainPlayers,
          maxBenchPlayers: room.maxBenchPlayers
        });
      }


      // Move to next turn
      moveToNextTurn(roomId, rooms);


      return {
        status: 'success',
        message: `Auto-picked ${selection.Name} (${selection.Position})`,
        selection: {
          player: selection,
          wasPreferred: selection.wasPreferred,
          source: selection.autoPickSource
        }
      };
    } else {
      console.log(`❌ Auto-pick failed for ${user.username}: no valid players available`);
     
      // Broadcast auto-pick failure
      const channel = ably.channels.get(`draft-room-${roomId}`);
      channel.publish('auto-select-failed', {
        username: user.username,
        userId: clientId,
        reason: 'No valid players available for any open roster position'
      });


      // Move to next turn even if auto-pick failed
      moveToNextTurn(roomId, rooms);


      return {
        status: 'success',
        message: 'Auto-pick completed - no valid players available',
        selection: null
      };
    }
  }


  return {
    handleJoinRoom,
    handleSetPreferredPlayers,
    handleStartDraft,
    handleSelectPlayer,
    handleAutoPickPlayer,
    handleDisconnect,
    publishToRoom,
    getRoomChannel
  };
}


// Helper functions
function startTurn(roomId, rooms) {
  const room = rooms[roomId];
  if (!room || !room.started) return;

  // Get current turn order for snake draft
  const currentTurnOrder = getCurrentTurnOrder(room);
  const currentTurnUserId = getCurrentTurnUserId(room);
  const currentUser = room.users.find(u => u.id === currentTurnUserId);

  if (!currentUser) {
    console.log(`❌ User not found for turn ${room.currentTurnIndex} in round ${room.draftRound}`);
    return;
  }

  console.log(`🎯 SNAKE DRAFT: Round ${room.draftRound}, Turn ${room.currentTurnIndex + 1}/${currentTurnOrder.length}`);
  console.log(`🎯 ${currentUser.username}'s turn in room ${roomId}`);
  console.log(`🎯 Current turn order: ${currentTurnOrder.map(id => {
    const user = room.users.find(u => u.id === id);
    return user ? user.username : id;
  }).join(' → ')}`);

  // Check if user is disconnected
  const isDisconnected = !room.users.find(u => u.id === currentTurnUserId);
  if (isDisconnected) {
    console.log(`⏰ Auto-selecting for disconnected user ${currentUser.username}`);
    setTimeout(() => {
      autoSelectForDisconnectedUser(roomId, rooms, currentTurnUserId, currentUser.username);
    }, 10000); // 10 seconds for disconnected user
    return;
  }

  // Start turn timer (10 seconds)
  let timeLeft = 10; // 10 seconds per turn
  if (room.turnTimer) {
    clearInterval(room.turnTimer);
  }
  room.turnTimer = setInterval(() => {
    timeLeft--;
    if (timeLeft <= 0) {
      clearInterval(room.turnTimer);
      room.turnTimer = null;
      autoSelectForDisconnectedUser(roomId, rooms, currentTurnUserId, currentUser.username);
    }
  }, 1000);

  // Publish turn started event
  const ably = new Ably.Rest({
    key: 'E_U1fw.iYMzEg:KNoWxsCQgLnZ9_oeCL3VWU0NUD3wUB_nbO2rVez2WnA'
  });
  const channel = ably.channels.get(`draft-room-${roomId}`);
  channel.publish("turn-started", {
    currentUser: currentUser.username,
    timeLeft: 10,
    userId: currentTurnUserId,
    draftRound: room.draftRound,
    currentTurnIndex: room.currentTurnIndex,
    turnOrder: currentTurnOrder.map(id => {
      const user = room.users.find(u => u.id === id);
      return user ? user.username : null;
    }).filter(Boolean)
  });
}


// Helper function to get current turn order for snake draft
function getCurrentTurnOrder(room) {
  if (!room || !room.turnOrder || room.turnOrder.length === 0) {
    return [];
  }
  
  // For odd rounds (1, 3, 5, ...): normal order
  // For even rounds (2, 4, 6, ...): reversed order
  if (room.draftRound % 2 === 1) {
    // Odd round - normal order (1, 2, 3, 4)
    return [...room.turnOrder];
  } else {
    // Even round - reversed order (4, 3, 2, 1)
    return [...room.turnOrder].reverse();
  }
}

// Helper function to get current turn user ID
function getCurrentTurnUserId(room) {
  const currentTurnOrder = getCurrentTurnOrder(room);
  if (currentTurnOrder.length === 0 || room.currentTurnIndex >= currentTurnOrder.length) {
    return null;
  }
  return currentTurnOrder[room.currentTurnIndex];
}

// Helper function to get the next user ID in snake draft order
function getNextTurnUserId(room) {
  const currentTurnOrder = getCurrentTurnOrder(room);
  if (currentTurnOrder.length === 0) {
    return null;
  }
  const nextIndex = (room.currentTurnIndex + 1) % currentTurnOrder.length;
  return currentTurnOrder[nextIndex];
}

// Helper function to advance to next turn in snake draft
function advanceToNextTurn(room) {
  room.currentTurnIndex++;
  
  // Check if round is complete
  if (room.currentTurnIndex >= room.turnOrder.length) {
    // Round complete - start next round
    room.draftRound++;
    room.currentTurnIndex = 0; // Reset to first position in new round
    
    console.log(`🔄 SNAKE DRAFT: Round ${room.draftRound} starting`);
    console.log(`🔄 Turn order for round ${room.draftRound}: ${getCurrentTurnOrder(room).join(' → ')}`);
  }
}

function moveToNextTurn(roomId, rooms) {
  const room = rooms[roomId];
  if (!room) return;

  // Clear any existing timer
  if (room.turnTimer) {
    clearInterval(room.turnTimer);
    room.turnTimer = null;
  }

  // Advance to next turn in snake draft
  advanceToNextTurn(room);
  
  // Check if draft is complete
  if (room.draftRound > room.maxRounds) {
    handleSelectionEnd(roomId, rooms);
    return;
  }
  
  // Log the snake draft progression
  const currentTurnOrder = getCurrentTurnOrder(room);
  const currentUser = getCurrentTurnUserId(room);
  console.log(`🔄 SNAKE DRAFT: Round ${room.draftRound}, Turn ${room.currentTurnIndex + 1}/${room.turnOrder.length}`);
  console.log(`🔄 Current turn order: ${currentTurnOrder.join(' → ')}`);
  console.log(`🔄 Current user: ${currentUser}`);

  // Start next turn
  setTimeout(() => {
    startTurn(roomId, rooms);
  }, 1000);
}


function handleSelectionEnd(roomId, rooms) {
  const room = rooms[roomId];
  if (!room) return;


  console.log(`🏁 Draft completed for room ${roomId}`);


  const ably = new Ably.Rest({
    key: 'E_U1fw.iYMzEg:KNoWxsCQgLnZ9_oeCL3VWU0NUD3wUB_nbO2rVez2WnA'
  });
  const channel = ably.channels.get(`draft-room-${roomId}`);
  channel.publish("draft-completed", {
    selections: getSelectionsWithUsernames(room),
    finalPool: room.pool
  });
}


function autoSelectForDisconnectedUser(roomId, rooms, userId, username) {
  const room = rooms[roomId];
  if (!room) return;


  // Clear any existing timer
  if (room.turnTimer) {
    clearInterval(room.turnTimer);
    room.turnTimer = null;
  }


  console.log(`🤖 Auto-selecting for ${username} in room ${roomId}`);


  const selection = selectPlayerForUser(room, userId);
  if (selection) {
    const channel = new (require('ably')).Rest({
      key: 'E_U1fw.iYMzEg:KNoWxsCQgLnZ9_oeCL3VWU0NUD3wUB_nbO2rVez2WnA'
    }).channels.get(`draft-room-${roomId}`);
    publishChunked(channel, 'player-selected-pool', room.pool);
    publishChunked(channel, 'player-selected-selections', Object.entries(getSelectionsWithUsernames(room)), 10);
    channel.publish('player-selected-meta', {
      player: selection,
      selectedBy: username,
      userId: userId,
      autoSelected: true
    });
  }
}


function selectPlayerForUser(room, userId) {
  if (!room.pool || room.pool.length === 0) return null;

  const userSelections = room.selections[userId] || [];
  const lineupConfig = require('./lineupConfigs.json')[0];
  const { isDraftValid } = require('./isDraftValid');

  // Helper function to validate if a player can be drafted
  function canPlayerBeDrafted(player) {
    const validation = isDraftValid(userSelections, player, lineupConfig);
    if (!validation.valid) {
      console.log(`❌ Player ${player.Name} (${player.Position}) cannot be drafted: ${validation.reason}`);
    }
    return validation.valid;
  }

  let selectedPlayer = null;

  // Try to select from preferred queue first
  const preferredQueue = room.preferredQueue[userId] || [];
  for (let i = 0; i < preferredQueue.length; i++) {
    const playerId = preferredQueue[i];
    const playerIndex = room.pool.findIndex(p => p.PlayerID === playerId);
    if (playerIndex !== -1) {
      const player = room.pool[playerIndex];
      if (canPlayerBeDrafted(player)) {
        const validation = isDraftValid(userSelections, player, lineupConfig);
        player.rosterPosition = validation.position;
        room.pool.splice(playerIndex, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(player);
        room.preferredQueue[userId] = preferredQueue.filter(id => id !== playerId);
        console.log(`✅ Auto-selected preferred player: ${player.Name} (${player.Position}) -> ${validation.position}`);
        selectedPlayer = player;
        break;
      }
    }
  }

  // If no preferred player was selected, use ULTRA SIMPLE logic
  if (!selectedPlayer) {
    console.log(`🔍 Starting ULTRA SIMPLE auto-pick for user ${userId}`);
    
    // Count current positions
    const positionCounts = {
      QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0, FLEX: 0
    };
    
    userSelections.forEach(player => {
      const pos = player.rosterPosition || player.Position;
      if (positionCounts.hasOwnProperty(pos)) {
        positionCounts[pos]++;
      }
    });
    
    console.log(`📊 Current position counts:`, positionCounts);
    console.log(`🎯 Pool has ${room.pool.length} players`);
    
    // PRIORITY 1: Force select TE if missing
    if ((positionCounts.TE || 0) < 1) {
      console.log(`🎯 PRIORITY 1: Looking for TE players`);
      const tePlayers = room.pool.filter(p => p.Position === 'TE');
      console.log(`🎯 Found ${tePlayers.length} TE players:`, tePlayers.map(p => p.Name));
      
      if (tePlayers.length > 0) {
        const tePlayer = tePlayers[0];
        console.log(`🎯 SELECTING TE: ${tePlayer.Name}`);
        tePlayer.rosterPosition = 'TE';
        const playerIndex = room.pool.findIndex(p => p.PlayerID === tePlayer.PlayerID);
        room.pool.splice(playerIndex, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(tePlayer);
        selectedPlayer = tePlayer;
        console.log(`✅ SUCCESS: Selected TE ${tePlayer.Name}`);
      }
    }
    
    // PRIORITY 2: Force select K if missing
    if (!selectedPlayer && (positionCounts.K || 0) < 1) {
      console.log(`🎯 PRIORITY 2: Looking for K players`);
      const kPlayers = room.pool.filter(p => p.Position === 'K');
      console.log(`🎯 Found ${kPlayers.length} K players:`, kPlayers.map(p => p.Name));
      
      if (kPlayers.length > 0) {
        const kPlayer = kPlayers[0];
        console.log(`🎯 SELECTING K: ${kPlayer.Name}`);
        kPlayer.rosterPosition = 'K';
        const playerIndex = room.pool.findIndex(p => p.PlayerID === kPlayer.PlayerID);
        room.pool.splice(playerIndex, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(kPlayer);
        selectedPlayer = kPlayer;
        console.log(`✅ SUCCESS: Selected K ${kPlayer.Name}`);
      }
    }
    
    // PRIORITY 3: Force select DST if missing
    if (!selectedPlayer && (positionCounts.DST || 0) < 1) {
      console.log(`🎯 PRIORITY 3: Looking for DST players`);
      const dstPlayers = room.pool.filter(p => p.Position === 'DST');
      console.log(`🎯 Found ${dstPlayers.length} DST players:`, dstPlayers.map(p => p.Name));
      
      if (dstPlayers.length > 0) {
        const dstPlayer = dstPlayers[0];
        console.log(`🎯 SELECTING DST: ${dstPlayer.Name}`);
        dstPlayer.rosterPosition = 'DST';
        const playerIndex = room.pool.findIndex(p => p.PlayerID === dstPlayer.PlayerID);
        room.pool.splice(playerIndex, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(dstPlayer);
        selectedPlayer = dstPlayer;
        console.log(`✅ SUCCESS: Selected DST ${dstPlayer.Name}`);
      }
    }
    
    // PRIORITY 4: If no critical positions missing, pick any valid player
    if (!selectedPlayer) {
      console.log(`🎯 PRIORITY 4: No critical positions missing, picking any valid player`);
      
      for (let i = 0; i < room.pool.length; i++) {
        const player = room.pool[i];
        if (canPlayerBeDrafted(player)) {
          const validation = isDraftValid(userSelections, player, lineupConfig);
          player.rosterPosition = validation.position;
          room.pool.splice(i, 1);
          if (!room.selections[userId]) {
            room.selections[userId] = [];
          }
          room.selections[userId].push(player);
          selectedPlayer = player;
          console.log(`✅ SUCCESS: Selected ${player.Name} (${player.Position}) -> ${validation.position}`);
          break;
        }
      }
    }
    
    // PRIORITY 5: Last resort - pick any player
    if (!selectedPlayer) {
      console.log(`🎯 PRIORITY 5: Last resort - picking any player`);
      if (room.pool.length > 0) {
        const anyPlayer = room.pool[0];
        anyPlayer.rosterPosition = anyPlayer.Position;
        room.pool.splice(0, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(anyPlayer);
        selectedPlayer = anyPlayer;
        console.log(`✅ LAST RESORT: Selected ${anyPlayer.Name} (${anyPlayer.Position})`);
      }
    }
  }

  if (selectedPlayer) {
    console.log(`🎉 FINAL RESULT: Auto-selected ${selectedPlayer.Name} (${selectedPlayer.Position}) -> ${selectedPlayer.rosterPosition}`);
    return selectedPlayer;
  } else {
    console.log(`❌ FAILED: No player could be auto-selected for user ${userId}`);
    return null;
  }
}


//   for (const player of availablePlayers) {
//     const validation = isDraftValid(userSelections, player, lineupConfig);
//     if (validation.valid && validation.position !== 'N/A') {
//       player.rosterPosition = validation.position;
//       const playerIndex = room.pool.findIndex(p => p.PlayerID === player.PlayerID);
//       room.pool.splice(playerIndex, 1);
//       if (!room.selections[userId]) {
//         room.selections[userId] = [];
//       }
//       room.selections[userId].push(player);
//       return player;
//     }
//   }


//   // If no valid player found for the next open position, do not pick anyone
//   return null;
// }
// Updated selectPlayerForUser function with better preference list handling
function selectPlayerForUser(room, userId) {
  if (!room.pool || room.pool.length === 0) return null;

  const userSelections = room.selections[userId] || [];
  const lineupConfig = require('./lineupConfigs.json')[0];
  const { isDraftValid } = require('./isDraftValid');

  // Helper function to validate if a player can be drafted
  function canPlayerBeDrafted(player) {
    const validation = isDraftValid(userSelections, player, lineupConfig);
    if (!validation.valid) {
      console.log(`❌ Player ${player.Name} (${player.Position}) cannot be drafted: ${validation.reason}`);
    }
    return validation.valid;
  }

  let selectedPlayer = null;

  // Try to select from preferred queue first
  const preferredQueue = room.preferredQueue[userId] || [];
  for (let i = 0; i < preferredQueue.length; i++) {
    const playerId = preferredQueue[i];
    const playerIndex = room.pool.findIndex(p => p.PlayerID === playerId);
    if (playerIndex !== -1) {
      const player = room.pool[playerIndex];
      if (canPlayerBeDrafted(player)) {
        const validation = isDraftValid(userSelections, player, lineupConfig);
        player.rosterPosition = validation.position;
        room.pool.splice(playerIndex, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(player);
        room.preferredQueue[userId] = preferredQueue.filter(id => id !== playerId);
        console.log(`✅ Auto-selected preferred player: ${player.Name} (${player.Position}) -> ${validation.position}`);
        selectedPlayer = player;
        break;
      }
    }
  }

  // If no preferred player was selected, use ULTRA SIMPLE logic
  if (!selectedPlayer) {
    console.log(`🔍 Starting ULTRA SIMPLE auto-pick for user ${userId}`);
    
    // Count current positions
    const positionCounts = {
      QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0, FLEX: 0
    };
    
    userSelections.forEach(player => {
      const pos = player.rosterPosition || player.Position;
      if (positionCounts.hasOwnProperty(pos)) {
        positionCounts[pos]++;
      }
    });
    
    console.log(`📊 Current position counts:`, positionCounts);
    console.log(`🎯 Pool has ${room.pool.length} players`);
    
    // PRIORITY 1: Force select TE if missing
    if ((positionCounts.TE || 0) < 1) {
      console.log(`🎯 PRIORITY 1: Looking for TE players`);
      const tePlayers = room.pool.filter(p => p.Position === 'TE');
      console.log(`🎯 Found ${tePlayers.length} TE players:`, tePlayers.map(p => p.Name));
      
      if (tePlayers.length > 0) {
        const tePlayer = tePlayers[0];
        console.log(`🎯 SELECTING TE: ${tePlayer.Name}`);
        tePlayer.rosterPosition = 'TE';
        const playerIndex = room.pool.findIndex(p => p.PlayerID === tePlayer.PlayerID);
        room.pool.splice(playerIndex, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(tePlayer);
        selectedPlayer = tePlayer;
        console.log(`✅ SUCCESS: Selected TE ${tePlayer.Name}`);
      }
    }
    
    // PRIORITY 2: Force select K if missing
    if (!selectedPlayer && (positionCounts.K || 0) < 1) {
      console.log(`🎯 PRIORITY 2: Looking for K players`);
      const kPlayers = room.pool.filter(p => p.Position === 'K');
      console.log(`🎯 Found ${kPlayers.length} K players:`, kPlayers.map(p => p.Name));
      
      if (kPlayers.length > 0) {
        const kPlayer = kPlayers[0];
        console.log(`🎯 SELECTING K: ${kPlayer.Name}`);
        kPlayer.rosterPosition = 'K';
        const playerIndex = room.pool.findIndex(p => p.PlayerID === kPlayer.PlayerID);
        room.pool.splice(playerIndex, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(kPlayer);
        selectedPlayer = kPlayer;
        console.log(`✅ SUCCESS: Selected K ${kPlayer.Name}`);
      }
    }
    
    // PRIORITY 3: Force select DST if missing
    if (!selectedPlayer && (positionCounts.DST || 0) < 1) {
      console.log(`🎯 PRIORITY 3: Looking for DST players`);
      const dstPlayers = room.pool.filter(p => p.Position === 'DST');
      console.log(`🎯 Found ${dstPlayers.length} DST players:`, dstPlayers.map(p => p.Name));
      
      if (dstPlayers.length > 0) {
        const dstPlayer = dstPlayers[0];
        console.log(`🎯 SELECTING DST: ${dstPlayer.Name}`);
        dstPlayer.rosterPosition = 'DST';
        const playerIndex = room.pool.findIndex(p => p.PlayerID === dstPlayer.PlayerID);
        room.pool.splice(playerIndex, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(dstPlayer);
        selectedPlayer = dstPlayer;
        console.log(`✅ SUCCESS: Selected DST ${dstPlayer.Name}`);
      }
    }
    
    // PRIORITY 4: If no critical positions missing, pick any valid player
    if (!selectedPlayer) {
      console.log(`🎯 PRIORITY 4: No critical positions missing, picking any valid player`);
      
      for (let i = 0; i < room.pool.length; i++) {
        const player = room.pool[i];
        if (canPlayerBeDrafted(player)) {
          const validation = isDraftValid(userSelections, player, lineupConfig);
          player.rosterPosition = validation.position;
          room.pool.splice(i, 1);
          if (!room.selections[userId]) {
            room.selections[userId] = [];
          }
          room.selections[userId].push(player);
          selectedPlayer = player;
          console.log(`✅ SUCCESS: Selected ${player.Name} (${player.Position}) -> ${validation.position}`);
          break;
        }
      }
    }
    
    // PRIORITY 5: Last resort - pick any player
    if (!selectedPlayer) {
      console.log(`🎯 PRIORITY 5: Last resort - picking any player`);
      if (room.pool.length > 0) {
        const anyPlayer = room.pool[0];
        anyPlayer.rosterPosition = anyPlayer.Position;
        room.pool.splice(0, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(anyPlayer);
        selectedPlayer = anyPlayer;
        console.log(`✅ LAST RESORT: Selected ${anyPlayer.Name} (${anyPlayer.Position})`);
      }
    }
  }

  if (selectedPlayer) {
    console.log(`🎉 FINAL RESULT: Auto-selected ${selectedPlayer.Name} (${selectedPlayer.Position}) -> ${selectedPlayer.rosterPosition}`);
    return selectedPlayer;
  } else {
    console.log(`❌ FAILED: No player could be auto-selected for user ${userId}`);
    return null;
  }
}


// Updated autoSelectForDisconnectedUser function with proper preference list updates
function autoSelectForDisconnectedUser(roomId, rooms, userId, username) {
  const room = rooms[roomId];
  if (!room) return;


  // Clear any existing timer
  if (room.turnTimer) {
    clearInterval(room.turnTimer);
    room.turnTimer = null;
  }


  console.log(`🤖 Auto-selecting for ${username} in room ${roomId}`);


  const selection = selectPlayerForUser(room, userId);
  if (selection) {
    const channel = new (require('ably')).Rest({
      key: 'E_U1fw.iYMzEg:KNoWxsCQgLnZ9_oeCL3VWU0NUD3wUB_nbO2rVez2WnA'
    }).channels.get(`draft-room-${roomId}`);
   
    // Publish updated pool and selections
    publishChunked(channel, 'player-selected-pool', room.pool);
    publishChunked(channel, 'player-selected-selections', Object.entries(getSelectionsWithUsernames(room)), 10);
   
    // Publish selection with preference information
    channel.publish('player-selected-meta', {
      player: selection,
      selectedBy: username,
      userId: userId,
      autoSelected: true,
      wasPreferred: selection.wasPreferred || false
    });


    // If it was a preferred player, broadcast the updated preference list
    if (selection.wasPreferred) {
      channel.publish("preferred-players-updated", {
        preferredPlayers: room.preferredQueue[userId] || [],
        message: `${username} auto-selected their preferred player ${selection.Name}`,
        userId: userId,
        username: username,
        autoSelected: true
      });


      // Send updated game state chunks to reflect preference changes
      publishGameStateChunks(roomId, {
        turnOrder: room.started ?
          room.turnOrder
          .map((id) => {
            const user = room.users.find((u) => u.id === id);
            return user ? user.username : null;
          })
          .filter(Boolean) :
          [],
        currentTurnIndex: room.currentTurnIndex,
        pool: room.pool || [],
        selections: getSelectionsWithUsernames(room),
        started: room.started,
        selectionPhase: room.selectionPhase || 'main',
        preferredQueue: room.preferredQueue,
        maxMainPlayers: room.maxMainPlayers,
        maxBenchPlayers: room.maxBenchPlayers
      });
    }
  } else {
    // No valid player could be auto-selected, log this and notify
    console.log(`⚠️ Could not auto-select any valid player for ${username}`);
    const channel = new (require('ably')).Rest({
      key: 'E_U1fw.iYMzEg:KNoWxsCQgLnZ9_oeCL3VWU0NUD3wUB_nbO2rVez2WnA'
    }).channels.get(`draft-room-${roomId}`);
    channel.publish('auto-select-failed', {
      username: username,
      userId: userId,
      reason: 'No valid players available for any open roster position'
    });
  }
 
  // Always move to next turn regardless of whether a player was selected
  moveToNextTurn(roomId, rooms);
}


// Helper function to count current positions
function getPositionCounts(userSelections) {
  const positionCounts = {
    QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0, FLEX: 0
  };
 
  userSelections.forEach(player => {
    const pos = player.rosterPosition || player.Position;
    if (positionCounts.hasOwnProperty(pos)) {
      positionCounts[pos]++;
    }
  });
 
  return positionCounts;
}


// Helper function to get open positions based on lineup requirements
function getOpenPositions(positionCounts, lineupConfig) {
  const openPositions = [];
 
  // First, add positions that haven't met minDraftable requirement (starters + required)
  for (const posConfig of lineupConfig.positions) {
    const currentCount = positionCounts[posConfig.position] || 0;
    if (currentCount < posConfig.minDraftable) {
      openPositions.push(posConfig.position);
    }
  }
 
  // Then, add positions that can take more players up to maxDraftable (bench)
  for (const posConfig of lineupConfig.positions) {
    const currentCount = positionCounts[posConfig.position] || 0;
    if (currentCount < posConfig.maxDraftable &&
        !openPositions.includes(posConfig.position)) {
      openPositions.push(posConfig.position);
    }
  }
 
  return openPositions;
}


// Updated handleSelectPlayer to also handle preference removal properly
function handleSelectPlayer(roomId, clientId, playerID) {
  const room = rooms[roomId];
  if (!room) {
    console.log(`[select-player] Room not found: roomId=${roomId}`);
    return { error: "Room not found" };
  }


  if (!room.started) {
    console.log(`[select-player] Draft has not started yet: roomId=${roomId}`);
    return { error: "Draft has not started yet" };
  }


  const currentTurnUserId = room.turnOrder[room.currentTurnIndex];
  if (clientId !== currentTurnUserId) {
    console.log(`[select-player] Not your turn: clientId=${clientId}, expected=${currentTurnUserId}`);
    return { error: "It's not your turn" };
  }


  // Find the player in the pool
  const playerIndex = room.pool.findIndex(p => p.PlayerID === playerID);
  if (playerIndex === -1) {
    console.log(`[select-player] Player not found in pool: playerID=${playerID}, poolSize=${room.pool.length}`);
    return { error: "Player not found in pool" };
  }


  const player = room.pool[playerIndex];
  const user = room.users.find(u => u.id === clientId);


  // Check if player is in preference list first
  const preferredQueue = room.preferredQueue[clientId] || [];
  const isPreferred = preferredQueue.includes(playerID);
 
  if (isPreferred) {
    console.log(`🌟 Player ${player.Name} found in ${user.username}'s preference list`);
    // Remove from preference list since it's being selected
    room.preferredQueue[clientId] = preferredQueue.filter(id => id !== playerID);
  } else {
    console.log(`📋 Player ${player.Name} selected from main pool by ${user.username}`);
  }


  // Validate position assignment using the lineup logic
  const userSelections = room.selections[clientId] || [];
  const lineupConfig = require('./lineupConfigs.json')[0];
  const { isDraftValid } = require('./isDraftValid');
  const validation = isDraftValid(userSelections, player, lineupConfig);
 
  if (!validation.valid || validation.position === 'N/A') {
    console.log(`❌ Invalid selection: ${player.Name} would result in N/A position for ${user.username}`);
    return { error: `No valid roster position available for ${player.Name}. This would result in an invalid lineup.` };
  }
 
  player.rosterPosition = validation.position;


  // Add player to user's selections
  if (!room.selections[clientId]) {
    room.selections[clientId] = [];
  }
  room.selections[clientId].push(player);


  // Remove player from pool
  room.pool.splice(playerIndex, 1);


  console.log(`🎯 ${user.username} selected ${player.Name} (${player.Position}) -> ${player.rosterPosition}${isPreferred ? ' [PREFERRED]' : ''}`);


  // Broadcast selection
  const channel = ably.channels.get(`draft-room-${roomId}`);
  publishChunked(channel, 'player-selected-pool', room.pool);
  publishChunked(channel, 'player-selected-selections', Object.entries(getSelectionsWithUsernames(room)), 10);
  channel.publish('player-selected-meta', {
    player,
    selectedBy: user.username,
    userId: clientId,
    autoSelected: false,
    wasPreferred: isPreferred
  });


  // Broadcast updated preferences if a preferred player was selected
  publishToRoom(roomId, "preferred-players-updated", {
    preferredPlayers: room.preferredQueue[clientId] || [],
    message: isPreferred ? `${user.username} selected their preferred player ${player.Name}` : `${user.username} selected ${player.Name}`,
    userId: clientId,
    username: user.username,
    wasPreferred: isPreferred
  });


  // Send updated game state chunks to reflect preference changes
  publishGameStateChunks(roomId, {
    turnOrder: room.started ?
      room.turnOrder
      .map((id) => {
        const user = room.users.find((u) => u.id === id);
        return user ? user.username : null;
      })
      .filter(Boolean) :
      [],
    currentTurnIndex: room.currentTurnIndex,
    pool: room.pool || [],
    selections: getSelectionsWithUsernames(room),
    started: room.started,
    selectionPhase: room.selectionPhase || 'main',
    preferredQueue: room.preferredQueue,
    maxMainPlayers: room.maxMainPlayers,
    maxBenchPlayers: room.maxBenchPlayers
  });


  // Move to next turn
  moveToNextTurn(roomId, rooms);


  return { status: 'success' };
}


// Also update the autoSelectForDisconnectedUser function to handle the case where no player is selected
function autoSelectForDisconnectedUser(roomId, rooms, userId, username) {
  const room = rooms[roomId];
  if (!room) return;


  // Clear any existing timer
  if (room.turnTimer) {
    clearInterval(room.turnTimer);
    room.turnTimer = null;
  }


  console.log(`🤖 Auto-selecting for ${username} in room ${roomId}`);


  const selection = selectPlayerForUser(room, userId);
  if (selection) {
    const channel = new (require('ably')).Rest({
      key: 'E_U1fw.iYMzEg:KNoWxsCQgLnZ9_oeCL3VWU0NUD3wUB_nbO2rVez2WnA'
    }).channels.get(`draft-room-${roomId}`);
    publishChunked(channel, 'player-selected-pool', room.pool);
    publishChunked(channel, 'player-selected-selections', Object.entries(getSelectionsWithUsernames(room)), 10);
    channel.publish('player-selected-meta', {
      player: selection,
      selectedBy: username,
      userId: userId,
      autoSelected: true
    });
  } else {
    // No valid player could be auto-selected, log this and notify
    console.log(`⚠️ Could not auto-select any valid player for ${username}`);
    const channel = new (require('ably')).Rest({
      key: 'E_U1fw.iYMzEg:KNoWxsCQgLnZ9_oeCL3VWU0NUD3wUB_nbO2rVez2WnA'
    }).channels.get(`draft-room-${roomId}`);
    channel.publish('auto-select-failed', {
      username: username,
      userId: userId,
      reason: 'No valid players available for any open roster position'
    });
  }
 
  // Always move to next turn regardless of whether a player was selected
  moveToNextTurn(roomId, rooms);
}


// Also update the autoSelectForDisconnectedUser function to handle the case where no player is selected
function autoSelectForDisconnectedUser(roomId, rooms, userId, username) {
  const room = rooms[roomId];
  if (!room) return;


  // Clear any existing timer
  if (room.turnTimer) {
    clearInterval(room.turnTimer);
    room.turnTimer = null;
  }


  console.log(`🤖 Auto-selecting for ${username} in room ${roomId}`);


  const selection = selectPlayerForUser(room, userId);
  if (selection) {
    const channel = new (require('ably')).Rest({
      key: 'E_U1fw.iYMzEg:KNoWxsCQgLnZ9_oeCL3VWU0NUD3wUB_nbO2rVez2WnA'
    }).channels.get(`draft-room-${roomId}`);
    publishChunked(channel, 'player-selected-pool', room.pool);
    publishChunked(channel, 'player-selected-selections', Object.entries(getSelectionsWithUsernames(room)), 10);
    channel.publish('player-selected-meta', {
      player: selection,
      selectedBy: username,
      userId: userId,
      autoSelected: true
    });
  } else {
    // No valid player could be auto-selected, log this and notify
    console.log(`⚠️ Could not auto-select any valid player for ${username}`);
    const channel = new (require('ably')).Rest({
      key: 'E_U1fw.iYMzEg:KNoWxsCQgLnZ9_oeCL3VWU0NUD3wUB_nbO2rVez2WnA'
    }).channels.get(`draft-room-${roomId}`);
    channel.publish('auto-select-failed', {
      username: username,
      userId: userId,
      reason: 'No valid players available for any open roster position'
    });
  }
 
  // Always move to next turn regardless of whether a player was selected
  moveToNextTurn(roomId, rooms);
}
function getSelectionsWithUsernames(room) {
  const selectionsWithUsernames = {};
  for (const [userId, selections] of Object.entries(room.selections)) {
    const user = room.users.find(u => u.id === userId);
    if (user) {
      selectionsWithUsernames[user.username] = selections;
    }
  }
  return selectionsWithUsernames;
}


function generatePlayerPool(callback) {
  if (playerPoolCache) {
    callback(playerPoolCache);
    return;
  }


  try {
    const localPlayers = require('./PlayerDetails.json');
    console.log(`✅ Loaded ${localPlayers.length} players from local JSON file`);
   
    // Filter and create a balanced pool
    const positionGroups = {
      QB: [],
      RB: [],
      WR: [],
      TE: [],
      K: [],
      DST: []
    };
   
    for (const player of localPlayers) {
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
    playerPoolCache = pool;
    callback(pool);
  } catch (error) {
    console.error("❌ Error loading player data from local file:", error.message);
    callback([]);
  }
}


// function getUsersWithPreferencesSubmitted(room) {
//   return room.users.map(user => ({
//     ...user,
//     preferencesSubmitted: !!(room.preferredQueue[user.id] && room.preferredQueue[user.id].length > 0)
//   }));
// }


function checkAllPreferencesSubmitted(room) {
  return room.users.length > 0 && room.users.every(user =>
    !!(room.preferredQueue[user.id] && room.preferredQueue[user.id].length > 0)
  );
}


module.exports = { setupAbly, getCurrentTurnOrder, getCurrentTurnUserId };
