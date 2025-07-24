const Ably = require('ably');
const fs = require('fs');
const path = require('path');

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
      maxBenchPlayers: room.maxBenchPlayers,
      // allPreferencesSubmitted: allPlayersSubmitted
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

    // const allPlayersSubmitted = checkAllPreferencesSubmitted(room);
    // if (!allPlayersSubmitted) {
    //   return { error: "All players must submit their preferences first" };
    // }

    // Start the draft
    room.started = true;
    room.turnOrder = room.users.map(u => u.id);
    room.currentTurnIndex = 0;
    room.selectionPhase = 'main';

    console.log(`🚀 Draft started for room ${roomId}`);
    console.log(`Turn order: ${room.turnOrder.map(id => {
      const user = room.users.find(u => u.id === id);
      return user ? user.username : id;
    }).join(' -> ')}`);

    // Chunk pool for draft-started
    publishChunked(ably.channels.get(`draft-room-${roomId}`), 'draft-started-pool', room.pool);
    // Send meta info
    publishToRoom(roomId, 'draft-started-meta', {
      turnOrder: room.turnOrder.map(id => {
        const user = room.users.find(u => u.id === id);
        return user ? user.username : null;
      }).filter(Boolean),
      currentUser: room.users.find(u => u.id === room.turnOrder[0])?.username,
      selectionPhase: room.selectionPhase
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

// Enhanced auto-pick that ensures no N/A positions
function selectPlayerForUser(room, userId) {
  if (!room.pool || room.pool.length === 0) return null;

  const userSelections = room.selections[userId] || [];
  const lineupConfig = require('./lineupConfigs.json')[0];
  const { isDraftValid } = require('./isDraftValid');

  // Helper: can this player be drafted without resulting in N/A?
  function canPlayerBeDrafted(player) {
    const validation = isDraftValid(userSelections, player, lineupConfig);
    return validation.valid && validation.position !== 'N/A';
  }

  // 1. Try preferred list, in order, but only if player fills a valid position (not N/A)
  const preferredQueue = room.preferredQueue[userId] || [];
  for (const playerId of preferredQueue) {
    const playerIndex = room.pool.findIndex(p => p.PlayerID === playerId);
    if (playerIndex !== -1) {
      const player = room.pool[playerIndex];
      if (canPlayerBeDrafted(player)) {
        const validation = isDraftValid(userSelections, player, lineupConfig);
        player.rosterPosition = validation.position;
        room.pool.splice(playerIndex, 1);
        if (!room.selections[userId]) room.selections[userId] = [];
        room.selections[userId].push(player);
        // Remove from preference list since it's being auto-selected
        room.preferredQueue[userId] = preferredQueue.filter(id => id !== playerId);
        return player;
      }
    }
  }

  // 2. Fallback: efficiently filter pool for any valid player for open positions
  // Get open positions
  const positionCounts = getPositionCounts(userSelections);
  const openPositions = getOpenPositions(positionCounts, lineupConfig);

  // Efficiently filter pool for players that can fill open positions and are valid
  const availablePlayers = room.pool.filter(player => {
    // Check if player's position matches any open position (including FLEX logic)
    let positionMatch = false;
    for (const openPos of openPositions) {
      if (openPos === 'FLEX') {
        if (['RB', 'WR', 'TE'].includes(player.Position)) {
          positionMatch = true;
          break;
        }
      } else if (player.Position === openPos) {
        positionMatch = true;
        break;
      }
    }
    return positionMatch && canPlayerBeDrafted(player);
  });

  // Pick the first valid player from the efficiently filtered list
  if (availablePlayers.length > 0) {
    const player = availablePlayers[0];
    const validation = isDraftValid(userSelections, player, lineupConfig);
    player.rosterPosition = validation.position;
    const playerIndex = room.pool.findIndex(p => p.PlayerID === player.PlayerID);
    room.pool.splice(playerIndex, 1);
    if (!room.selections[userId]) room.selections[userId] = [];
    room.selections[userId].push(player);
    return player;
  }

  // No valid player found
  return null;
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

  return {
    handleJoinRoom,
    handleSetPreferredPlayers,
    handleStartDraft,
    handleSelectPlayer,
    handleDisconnect,
    publishToRoom,
    getRoomChannel
  };
}

// Helper functions
function startTurn(roomId, rooms) {
  const room = rooms[roomId];
  if (!room || !room.started) return;

  // Debug logs for turnOrder and users
  console.log('Current turnOrder:', room.turnOrder);
  console.log('Current users:', room.users.map(u => u.id));

  const currentTurnUserId = room.turnOrder[room.currentTurnIndex];
  const currentUser = room.users.find(u => u.id === currentTurnUserId);

  if (!currentUser) {
    console.log(`❌ User not found for turn ${room.currentTurnIndex}`);
    return;
  }

  console.log(`🎯 ${currentUser.username}'s turn in room ${roomId}`);

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
    userId: currentTurnUserId
  });
}

function moveToNextTurn(roomId, rooms) {
  const room = rooms[roomId];
  if (!room) return;

  // Clear any existing timer
  if (room.turnTimer) {
    clearInterval(room.turnTimer);
    room.turnTimer = null;
  }

  room.currentTurnIndex++;

  // Check if round is complete
  if (room.currentTurnIndex >= room.turnOrder.length) {
    room.currentTurnIndex = 0;
    room.draftRound++;
    // Check if draft is complete
    if (room.draftRound > room.maxRounds) {
      handleSelectionEnd(roomId, rooms);
      return;
    }
  }

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
    moveToNextTurn(roomId, rooms);
  }
}

// function selectPlayerForUser(room, userId) {
//   if (!room.pool || room.pool.length === 0) return null;

//   const userSelections = room.selections[userId] || [];
//   const lineupConfig = require('./lineupConfigs.json')[0];
//   const { isDraftValid } = require('./isDraftValid');

//   // Count current selections by position
//   const positionCounts = {};
//   lineupConfig.positions.forEach(pos => {
//     positionCounts[pos.position] = 0;
//   });
//   userSelections.forEach(player => {
//     const pos = player.rosterPosition || player.Position;
//     if (positionCounts.hasOwnProperty(pos)) {
//       positionCounts[pos]++;
//     }
//   });

//   // Find the next open position in lineup order (by minDraftable)
//   let nextOpenPosition = null;
//   for (const posConfig of lineupConfig.positions) {
//     if (positionCounts[posConfig.position] < posConfig.minDraftable) {
//       nextOpenPosition = posConfig.position;
//       break;
//     }
//   }
//   // If all minDraftable are filled, allow any position up to maxDraftable (bench/flex)
//   if (!nextOpenPosition) {
//     for (const posConfig of lineupConfig.positions) {
//       if (positionCounts[posConfig.position] < posConfig.maxDraftable) {
//         nextOpenPosition = posConfig.position;
//         break;
//       }
//     }
//   }
//   if (!nextOpenPosition) {
//     // All positions filled
//     return null;
//   }

//   // Helper to check if a player can fill the next open position
//   function canFillNextPosition(player) {
//     // FLEX logic: only if FLEX is next and player is RB/WR/TE
//     if (nextOpenPosition === 'FLEX' && ['RB', 'WR', 'TE'].includes(player.Position)) return true;
//     return player.Position === nextOpenPosition;
//   }

//   // Try to select from preferred queue first
//   const preferredQueue = room.preferredQueue[userId] || [];
//   for (const playerId of preferredQueue) {
//     const playerIndex = room.pool.findIndex(p => p.PlayerID === playerId);
//     if (playerIndex !== -1) {
//       const player = room.pool[playerIndex];
//       if (canFillNextPosition(player)) {
//         const validation = isDraftValid(userSelections, player, lineupConfig);
//         if (validation.valid && validation.position !== 'N/A') {
//           player.rosterPosition = validation.position;
//           room.pool.splice(playerIndex, 1);
//           if (!room.selections[userId]) {
//             room.selections[userId] = [];
//           }
//           room.selections[userId].push(player);
//           return player;
//         }
//       }
//     }
//   }

//   // Fallback to main player pool: only pick players for the next open position
//   const availablePlayers = room.pool.filter(player => canFillNextPosition(player));

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

  // Helper function to validate if a player can be drafted without resulting in N/A
  function canPlayerBeDrafted(player) {
    const validation = isDraftValid(userSelections, player, lineupConfig);
    return validation.valid && validation.position !== 'N/A';
  }

  let selectedFromPreferences = false;
  let selectedPlayer = null;

  // Try to select from preferred queue first - skip players that would result in N/A
  const preferredQueue = room.preferredQueue[userId] || [];
  for (let i = 0; i < preferredQueue.length; i++) {
    const playerId = preferredQueue[i];
    const playerIndex = room.pool.findIndex(p => p.PlayerID === playerId);
    if (playerIndex !== -1) {
      const player = room.pool[playerIndex];
      
      // Check if this player can be drafted without resulting in N/A
      if (canPlayerBeDrafted(player)) {
        const validation = isDraftValid(userSelections, player, lineupConfig);
        player.rosterPosition = validation.position;
        room.pool.splice(playerIndex, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(player);
        
        // Remove from preference list since it's being auto-selected
        room.preferredQueue[userId] = preferredQueue.filter(id => id !== playerId);
        
        console.log(`✅ Auto-selected preferred player: ${player.Name} (${player.Position}) -> ${validation.position}`);
        selectedFromPreferences = true;
        selectedPlayer = player;
        break;
      } else {
        console.log(`⏭️ Skipping preferred player ${player.Name} - would result in N/A position`);
      }
    }
  }

  // If no preferred player was selected, pick from main pool
  if (!selectedPlayer) {
    // Get all open positions based on lineup requirements
    const positionCounts = getPositionCounts(userSelections);
    const openPositions = getOpenPositions(positionCounts, lineupConfig);

    if (openPositions.length === 0) {
      console.log(`❌ No open positions available for user ${userId}`);
      return null;
    }

    console.log(`🎯 Open positions for auto-pick: ${openPositions.join(', ')}`);

    // Efficiently filter main pool by all open positions at once
    const availablePlayers = room.pool.filter(player => {
      // Check if player's position matches any open position
      let positionMatch = false;
      
      for (const openPos of openPositions) {
        if (openPos === 'FLEX') {
          // FLEX can accept RB, WR, TE
          if (['RB', 'WR', 'TE'].includes(player.Position)) {
            positionMatch = true;
            break;
          }
        } else if (player.Position === openPos) {
          positionMatch = true;
          break;
        }
      }
      
      // Only include if position matches and can be drafted without N/A
      return positionMatch && canPlayerBeDrafted(player);
    });

    console.log(`🔍 Found ${availablePlayers.length} available players for open positions`);

    // Pick the first valid player from the efficiently filtered list
    for (const player of availablePlayers) {
      const validation = isDraftValid(userSelections, player, lineupConfig);
      if (validation.valid && validation.position !== 'N/A') {
        player.rosterPosition = validation.position;
        const playerIndex = room.pool.findIndex(p => p.PlayerID === player.PlayerID);
        room.pool.splice(playerIndex, 1);
        if (!room.selections[userId]) {
          room.selections[userId] = [];
        }
        room.selections[userId].push(player);
        console.log(`✅ Auto-selected from pool: ${player.Name} (${player.Position}) -> ${validation.position}`);
        selectedPlayer = player;
        break;
      }
    }
  }

  // Return both the selected player and whether it was from preferences
  if (selectedPlayer) {
    selectedPlayer.wasPreferred = selectedFromPreferences;
    return selectedPlayer;
  }

  // If we reach here, no valid player was found
  console.log(`❌ No valid players found for any open position`);
  return null;
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

module.exports = { setupAbly }; 