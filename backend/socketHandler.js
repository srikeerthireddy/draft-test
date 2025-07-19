const fs = require('fs');
const path = require('path');

// Player pool cache
let playerPoolCache = null;

function setupSocket(io, rooms) {
  console.log('Socket.IO setup initialized');
  
  io.on("connection", (socket) => {
    console.log(`🟢 Connected: ${socket.id}`);

    socket.on("join-room", ({ roomId, username }) => {
      console.log(`🔍 JOIN ROOM DEBUG:`);
      console.log(`- Room ID received: "${roomId}"`);
      console.log(`- Username: "${username}"`);
      console.log(`- Available rooms:`, Object.keys(rooms));
      console.log(`- Room exists:`, !!rooms[roomId]);
      
      if (!roomId || !username) {
        socket.emit("error", { message: "Room ID and username are required" });
        return;
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
          selectionPhase: 'main'
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
        return;
      }
      
      finishJoinRoom();
      
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
          const user = { id: socket.id, username: username.trim() };
          room.users.push(user);

          // Restore selections and preferences
          room.selections[socket.id] = disconnectedUser.selections || [];
          room.preferredQueue[socket.id] = disconnectedUser.preferredQueue || [];

          // Update turn order if game is running
          if (room.started && room.turnOrder.length > 0) {
            const turnIndex = room.turnOrder.findIndex(
              (oldId) => oldId === disconnectedUser.id
            );
            if (turnIndex !== -1) {
              room.turnOrder[turnIndex] = socket.id;
              if (room.currentTurnIndex === turnIndex) {
                setTimeout(() => {
                  startTurn(io, roomId, rooms);
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
            socket.emit("error", {
              message: "Username already taken in this room",
            });
            return;
          }

          const user = { id: socket.id, username: username.trim() };
          room.users.push(user);
          room.selections[socket.id] = [];
          room.preferredQueue[socket.id] = [];

          if (!room.hostId) {
            room.hostId = socket.id;
          }
        }

        socket.join(roomId);

        // Broadcast updated room users to all clients
        console.log(`📢 Broadcasting room users for room ${roomId}:`);
        const usersWithPreferences = getUsersWithPreferencesSubmitted(room);
        console.log(`Users in room: ${usersWithPreferences.map(u => u.username).join(', ')}`);
        
        io.to(roomId).emit("room-users", usersWithPreferences);
        io.to(roomId).emit("disconnected-users", room.disconnectedUsers || []);
        
        socket.emit("host-status", {
          isHost: socket.id === room.hostId,
          started: room.started,
        });

        // Send current game state
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

        socket.emit("game-state", {
          ...gameState,
          preferredQueue: room.preferredQueue[socket.id] || [],
        });

        // Also emit all users' preferences to all clients for UI
        io.to(roomId).emit("game-state", gameState);

        console.log(`✅ User ${username} successfully joined room ${roomId}`);
      }
    });

    // Set preferred players
    socket.on("set-preferred-players", (data) => {
      const { roomId, preferredPlayers } = data;
      
      const room = rooms[roomId];
      if (!room) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      if (room.started) {
        socket.emit("error", { message: "Cannot set preferences after game has started" });
        return;
      }

      // Validate preferred players (should be array of PlayerIDs)
      if (!Array.isArray(preferredPlayers)) {
        socket.emit("error", { message: "Preferred players must be an array" });
        return;
      }

      // Filter out invalid PlayerIDs and duplicates
      const validPreferredPlayers = preferredPlayers.filter((playerId, index) => {
        return typeof playerId === 'number' && 
               preferredPlayers.indexOf(playerId) === index &&
               room.pool.some(p => p.PlayerID === playerId);
      });

      room.preferredQueue[socket.id] = validPreferredPlayers;

      const user = room.users.find(u => u.id === socket.id);
      console.log(`📝 User ${user?.username} set preferred players: ${validPreferredPlayers.join(', ')}`);

      // Broadcast preference update to all clients
      io.to(roomId).emit("preferred-players-updated", {
        preferredPlayers: validPreferredPlayers,
        message: `${user.username} updated their preferences.`,
        userId: socket.id,
        username: user.username
      });

      // Check if all players have submitted preferences
      const allPlayersSubmitted = checkAllPreferencesSubmitted(room);
      console.log(`🔍 All preferences submitted: ${allPlayersSubmitted}`);

      // Emit updated user list with preferencesSubmitted flag
      const usersWithPreferences = getUsersWithPreferencesSubmitted(room);
      io.to(roomId).emit("room-users", usersWithPreferences);

      // Emit updated game state to all clients
      io.to(roomId).emit("game-state", {
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
        maxBenchPlayers: room.maxBenchPlayers,
        allPreferencesSubmitted: allPlayersSubmitted
      });

      // If all players have submitted preferences, notify the host
      if (allPlayersSubmitted) {
        const hostUser = room.users.find(u => u.id === room.hostId);
        if (hostUser) {
          io.to(room.hostId).emit("all-preferences-submitted", {
            message: "All players have submitted their preferences. You can now start the draft!",
            canStartDraft: true
          });
        }
      }
    });

    socket.on("start-selection", ({ roomId }) => {
      console.log("📢 start-selection received for room:", roomId);
      const room = rooms[roomId];
      if (!room) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      // Check if user is the host
      if (socket.id !== room.hostId) {
        socket.emit("error", { message: "Only the host can start the draft" });
        return;
      }

      // Check if all players have submitted preferences
      const allPlayersSubmitted = checkAllPreferencesSubmitted(room);
      if (!allPlayersSubmitted) {
        socket.emit("error", { message: "All players must submit their preferences before starting the draft" });
        return;
      }

      // Mark game as started
      room.started = true;
      room.selectionPhase = "main";
      room.turnOrder = room.users.map((u) => u.id);
      room.currentTurnIndex = 0;

      console.log(`🎯 Starting draft for room ${roomId} with ${room.users.length} players`);
      console.log(`Player pool size: ${room.pool.length}`);

      io.to(roomId).emit("draft-started", {
        pool: room.pool,
        turnOrder: room.turnOrder.map((id) => {
          const user = room.users.find(u => u.id === id);
          return user?.username || "Unknown";
        }),
        currentUser: room.users.find(u => u.id === room.turnOrder[0])?.username,
        selectionPhase: room.selectionPhase,
        maxMainPlayers: room.maxMainPlayers,
        maxBenchPlayers: room.maxBenchPlayers
      });

      // Start the first turn
      startTurn(io, roomId, rooms);
    });

    socket.on("play-again", ({ roomId }) => {
      const room = rooms[roomId];
      if (!room) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      if (socket.id !== room.hostId) {
        socket.emit("error", { message: "Only host can restart the game" });
        return;
      }

      // Reset game state
      room.started = false;
      room.currentTurnIndex = 0;
      room.turnOrder = [];
      
      generatePlayerPool((pool) => {
        room.pool = pool;
        room.selectionPhase = 'main';

        // Reset selections for all users
        room.users.forEach((user) => {
          room.selections[user.id] = [];
        });

        // Reset selections for disconnected users
        if (room.disconnectedUsers) {
          room.disconnectedUsers.forEach((user) => {
            room.selections[user.id] = [];
            user.selections = [];
          });
        }

        // Keep preferred queues (don't reset them)

        if (room.timer) {
          clearTimeout(room.timer);
          room.timer = null;
        }

        io.to(roomId).emit("play-again", { 
          pool: room.pool,
          phase: room.selectionPhase
        });

        console.log(`🔄 Game reset for room ${roomId} by host`);
      });
    });

    socket.on("exit-room", ({ roomId }) => {
      const room = rooms[roomId];
      if (!room) {
        return;
      }

      if (socket.id === room.hostId) {
        io.to(roomId).emit("room-closed", {
          message: "Host has closed the room",
        });

        if (room.timer) clearTimeout(room.timer);
        if (room.disconnectedUsers) {
          room.disconnectedUsers.forEach((user) => {
            if (user.timeout) clearTimeout(user.timeout);
          });
        }

        delete rooms[roomId];
        console.log(`🚪 Room ${roomId} closed by host`);
      }
    });

    socket.on("select-player", ({ roomId, playerID }) => {
      const room = rooms[roomId];
      if (!room || !room.started) {
        socket.emit("error", {
          message: "Room not found or selection not started",
        });
        return;
      }

      const currentUserId = room.turnOrder[room.currentTurnIndex];
      if (socket.id !== currentUserId) {
        socket.emit("error", { message: "Not your turn" });
        return;
      }

      // Find the player object by PlayerID
      const playerObj = room.pool.find((p) => p.PlayerID === playerID);
      if (!playerObj) {
        socket.emit("error", { message: "Player not available" });
        return;
      }

      console.log(`⚡ User ${socket.id} selected player ${playerObj.Name} (ID: ${playerID})`);

      if (room.timer) {
        clearTimeout(room.timer);
        room.timer = null;
      }

      if (!room.selections[socket.id]) {
        room.selections[socket.id] = [];
      }

      // Add player to user's selection
      room.selections[socket.id].push(playerObj);
      // Remove player from pool by PlayerID
      room.pool = room.pool.filter((p) => p.PlayerID !== playerID);

      const username = room.users.find((u) => u.id === socket.id)?.username;
      io.to(roomId).emit("player-selected", {
        player: playerObj,
        user: socket.id,
        username,
        selections: getSelectionsWithUsernames(room),
        pool: room.pool,
        selectionPhase: room.selectionPhase
      });

      moveToNextTurn(io, roomId, rooms);
    });

    socket.on("disconnect", () => {
      console.log(`🔴 Disconnected: ${socket.id}`);

      for (const roomId in rooms) {
        const room = rooms[roomId];
        const userIndex = room.users.findIndex((u) => u.id === socket.id);

        if (userIndex !== -1) {
          const disconnectedUser = room.users[userIndex];
          console.log(`User ${disconnectedUser.username} disconnected from room ${roomId}`);

          const currentSelections = room.selections[socket.id] || [];
          const currentPreferredQueue = room.preferredQueue[socket.id] || [];

          room.users.splice(userIndex, 1);

          if (!room.disconnectedUsers) {
            room.disconnectedUsers = [];
          }

          room.disconnectedUsers.push({
            id: socket.id,
            username: disconnectedUser.username,
            selections: currentSelections,
            preferredQueue: currentPreferredQueue,
            disconnectedAt: new Date().toISOString(),
          });

          // Broadcast updated user list
          io.to(roomId).emit("room-users", getUsersWithPreferencesSubmitted(room));
          io.to(roomId).emit("disconnected-users", room.disconnectedUsers);

          const timeout = setTimeout(() => {
            if (room.disconnectedUsers) {
              room.disconnectedUsers = room.disconnectedUsers.filter(
                (u) => u.id !== socket.id
              );
              io.to(roomId).emit("disconnected-users", room.disconnectedUsers);
            }

            delete room.selections[socket.id];
            delete room.preferredQueue[socket.id];

            const turnIndex = room.turnOrder.indexOf(socket.id);
            if (turnIndex !== -1) {
              room.turnOrder.splice(turnIndex, 1);

              if (room.currentTurnIndex > turnIndex) {
                room.currentTurnIndex--;
              } else if (
                room.currentTurnIndex >= room.turnOrder.length &&
                room.turnOrder.length > 0
              ) {
                room.currentTurnIndex = 0;
              }

              if (room.started && room.turnOrder.length > 0) {
                setTimeout(() => {
                  startTurn(io, roomId, rooms);
                }, 1000);
              }
            }

            console.log(`User ${disconnectedUser.username} permanently removed from room ${roomId}`);
          }, 300000); // 5 minutes

          const disconnectedUserObj = room.disconnectedUsers.find(
            (u) => u.id === socket.id
          );
          if (disconnectedUserObj) {
            disconnectedUserObj.timeout = timeout;
          }

          if (room.hostId === socket.id && room.users.length > 0) {
            room.hostId = room.users[0].id;
            io.to(room.hostId).emit("host-status", {
              isHost: true,
              started: room.started,
            });
          }

          if (room.started && room.turnOrder.length > 0) {
            const currentTurnUserId = room.turnOrder[room.currentTurnIndex];
            if (currentTurnUserId === socket.id) {
              console.log("Disconnected user was current turn, moving to next turn");
              moveToNextTurn(io, roomId, rooms);
            }
          }

          if (
            room.users.length === 0 &&
            (!room.disconnectedUsers || room.disconnectedUsers.length === 0)
          ) {
            if (room.timer) clearTimeout(room.timer);
            if (room.disconnectedUsers) {
              room.disconnectedUsers.forEach((user) => {
                if (user.timeout) clearTimeout(user.timeout);
              });
            }
            delete rooms[roomId];
            console.log(`🗑️ Room ${roomId} deleted - no users left`);
          }
        }
      }
    });
  });
}

function startTurn(io, roomId, rooms) {
  const room = rooms[roomId];
  if (!room || !room.started) {
    return;
  }
  
  if (!room.pool || room.pool.length === 0) {
    console.log('No player pool available, generating...');
    generatePlayerPool((pool) => {
      room.pool = pool;
      console.log(`Player pool regenerated with ${pool.length} players`);
      startTurn(io, roomId, rooms);
    });
    return;
  }

  let attempts = 0;
  while (attempts < room.turnOrder.length) {
    if (room.currentTurnIndex >= room.turnOrder.length) {
      room.currentTurnIndex = 0;
    }

    const userId = room.turnOrder[room.currentTurnIndex];
    const user = room.users.find((u) => u.id === userId);

    if (!user) {
      const disconnectedUser = room.disconnectedUsers?.find(
        (u) => u.id === userId
      );

      if (disconnectedUser) {
        const userSelections = room.selections[userId] || [];
        const maxPlayers = room.selectionPhase === 'main' ? room.maxMainPlayers : room.maxMainPlayers + room.maxBenchPlayers;
        
        if (userSelections.length >= maxPlayers) {
          room.currentTurnIndex++;
          attempts++;
          continue;
        }

        if (room.pool.length === 0) {
          handleSelectionEnd(io, roomId, rooms);
          return;
        }

        autoSelectForDisconnectedUser(io, roomId, rooms, userId, disconnectedUser.username);
        return;
      } else {
        room.currentTurnIndex++;
        attempts++;
        continue;
      }
    }

    const userSelections = room.selections[userId] || [];
    const maxPlayers = room.selectionPhase === 'main' ? room.maxMainPlayers : room.maxMainPlayers + room.maxBenchPlayers;
    
    if (userSelections.length >= maxPlayers) {
      room.currentTurnIndex++;
      attempts++;
      continue;
    }

    if (room.pool.length === 0) {
      handleSelectionEnd(io, roomId, rooms);
      return;
    }

    console.log(`⏰ Starting turn for user: ${user.username}, current selections: ${userSelections.length}, phase: ${room.selectionPhase}`);

    io.to(userId).emit("your-turn", { 
      pool: room.pool,
      selectionPhase: room.selectionPhase,
      selectionsCount: userSelections.length,
      maxPlayers: maxPlayers
    });

    io.to(roomId).emit("turn-update", {
      currentUser: user.username,
      userId: userId,
      seconds: 10,
      selectionPhase: room.selectionPhase,
      selectionsCount: userSelections.length,
      maxPlayers: maxPlayers
    });

    if (room.timer) {
      clearTimeout(room.timer);
    }

    room.timer = setTimeout(() => {
      if (rooms[roomId] && room.turnOrder[room.currentTurnIndex] === userId) {
        autoSelect(io, roomId, rooms);
      }
    }, 10000);

    return;
  }

  // Check if all users have completed their selections for current phase
  const allUserIds = room.turnOrder;
  const maxPlayers = room.selectionPhase === 'main' ? room.maxMainPlayers : room.maxMainPlayers + room.maxBenchPlayers;
  
  const allSelectionsComplete = allUserIds.every(
    (userId) => room.selections[userId] && room.selections[userId].length >= maxPlayers
  );

  if (allSelectionsComplete) {
    if (room.selectionPhase === 'main') {
      // Move to bench phase
      room.selectionPhase = 'bench';
      room.currentTurnIndex = 0;
      
      io.to(roomId).emit("selection-phase-update", { 
        phase: room.selectionPhase,
        message: "Bench player selection started (2 players)"
      });
      
      setTimeout(() => {
        startTurn(io, roomId, rooms);
      }, 1000);
      return;
    } else {
      // End the selection
      handleSelectionEnd(io, roomId, rooms);
      return;
    }
  }

  if (room.pool.length === 0) {
    handleSelectionEnd(io, roomId, rooms);
    return;
  }

  room.currentTurnIndex = 0;
  setTimeout(() => {
    startTurn(io, roomId, rooms);
  }, 1000);
}

function handleSelectionEnd(io, roomId, rooms) {
  const room = rooms[roomId];
  const results = getSelectionsWithUsernames(room);
  
  io.to(roomId).emit("selection-ended", { 
    results,
    finalPhase: room.selectionPhase
  });
  
  console.log("🏁 Selection ended for room:", roomId);
}

function autoSelectForDisconnectedUser(io, roomId, rooms, userId, username) {
  const room = rooms[roomId];
  if (!room || !room.pool || room.pool.length === 0) {
    moveToNextTurn(io, roomId, rooms);
    return;
  }

  const playerObj = selectPlayerForUser(room, userId);
  
  console.log(`🤖 Auto-selecting ${playerObj.Name} for disconnected user ${username}`);

  if (!room.selections[userId]) {
    room.selections[userId] = [];
  }

  room.selections[userId].push(playerObj);
  room.pool = room.pool.filter((p) => p.PlayerID !== playerObj.PlayerID);

  const disconnectedUser = room.disconnectedUsers?.find((u) => u.id === userId);
  if (disconnectedUser) {
    disconnectedUser.selections = room.selections[userId];
  }

  io.to(roomId).emit("auto-selected-disconnected", {
    player: playerObj,
    user: userId,
    username: username,
    selections: getSelectionsWithUsernames(room),
    pool: room.pool,
    selectionPhase: room.selectionPhase
  });

  moveToNextTurn(io, roomId, rooms);
}

function autoSelect(io, roomId, rooms) {
  const room = rooms[roomId];
  if (!room || !room.pool || room.pool.length === 0) {
    moveToNextTurn(io, roomId, rooms);
    return;
  }

  const userId = room.turnOrder[room.currentTurnIndex];
  const user = room.users.find((u) => u.id === userId);

  if (!user) {
    moveToNextTurn(io, roomId, rooms);
    return;
  }

  const playerObj = selectPlayerForUser(room, userId);
  
  console.log(`⏰ Auto-selecting ${playerObj.Name} for user ${user.username}`);  

  if (!room.selections[userId]) {
    room.selections[userId] = [];
  }

  room.selections[userId].push(playerObj);
  room.pool = room.pool.filter((p) => p.PlayerID !== playerObj.PlayerID);

  io.to(roomId).emit("auto-selected", {
    player: playerObj,
    user: userId,
    username: user.username,
    selections: getSelectionsWithUsernames(room),
    pool: room.pool,
    selectionPhase: room.selectionPhase
  });

  moveToNextTurn(io, roomId, rooms);
}

function moveToNextTurn(io, roomId, rooms) {
  const room = rooms[roomId];
  if (!room) return;

  room.currentTurnIndex++;
  setTimeout(() => {
    startTurn(io, roomId, rooms);
  }, 1000);
}

function getSelectionsWithUsernames(room) {
  const results = {};
  for (const userId in room.selections) {
    const user = room.users.find((u) => u.id === userId) ||
                 room.disconnectedUsers?.find((u) => u.id === userId);
    if (user) {
      results[user.username] = room.selections[userId];
    }
  }
  return results;
}

function selectPlayerForUser(room, userId) {
  // Ensure we have a valid pool
  if (!room.pool || room.pool.length === 0) {
    throw new Error('No players available in pool');
  }

  const preferredQueue = room.preferredQueue[userId] || [];
  
  // First, try to find a preferred player that's still available
  for (const playerId of preferredQueue) {
    const preferredPlayer = room.pool.find((p) => p.PlayerID === playerId);
    if (preferredPlayer) {
      console.log(`✅ Selecting preferred player ${preferredPlayer.Name} (ID: ${playerId}) for user ${userId}`);
      return preferredPlayer;
    }
  }
  
  // If no preferred players are available, select the first available player
  const fallbackPlayer = room.pool[0];
  if (!fallbackPlayer) {
    throw new Error('No players available for selection');
  }
  
  console.log(`⚠️ Selecting fallback player ${fallbackPlayer.Name} (ID: ${fallbackPlayer.PlayerID}) for user ${userId}`);
  return fallbackPlayer;
}

function generatePlayerPool(callback) {
  // Use cached pool if available
  if (playerPoolCache) {
    console.log('📦 Using cached player pool');
    callback([...playerPoolCache]);
    return;
  }

  // Load the local JSON file synchronously
  const filePath = path.join(__dirname, 'PlayerDetails.json');
  let allPlayers = [];
  
  try {
    const fileData = fs.readFileSync(filePath, 'utf8');
    allPlayers = JSON.parse(fileData);
    console.log(`📁 Loaded ${allPlayers.length} players from PlayerDetails.json`);
  } catch (err) {
    console.error("❌ Failed to load PlayerDetails.json:", err.message);
    callback([]);
    return;
  }

  // Filter and create a balanced pool
  const positionGroups = {
    QB: [],
    RB: [],
    WR: [],
    TE: [],
    K: [],
    DST: []
  };

  // Group players by position
  for (const player of allPlayers) {
    const pos = player.Position;
    if (pos === "QB") positionGroups.QB.push(player);
    else if (pos === "RB") positionGroups.RB.push(player);
    else if (pos === "WR") positionGroups.WR.push(player);
    else if (pos === "TE") positionGroups.TE.push(player);
    else if (pos === "K") positionGroups.K.push(player);
    else if (pos === "DST") positionGroups.DST.push(player);
  }

  // Helper function to get random players from a position
  const getRandom = (arr, count) => {
    const shuffled = arr.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(count, arr.length));
  };

  // Create balanced pool
  const pool = [
    ...getRandom(positionGroups.QB, 8),
    ...getRandom(positionGroups.RB, 15),
    ...getRandom(positionGroups.WR, 20),
    ...getRandom(positionGroups.TE, 10),
    ...getRandom(positionGroups.K, 5),
    ...getRandom(positionGroups.DST, 5)
  ];

  // Cache the pool for future use
  playerPoolCache = [...pool];
  console.log(`✅ Created balanced pool with ${pool.length} players`);
  console.log(`   QB: ${pool.filter(p => p.Position === 'QB').length}, RB: ${pool.filter(p => p.Position === 'RB').length}, WR: ${pool.filter(p => p.Position === 'WR').length}, TE: ${pool.filter(p => p.Position === 'TE').length}, K: ${pool.filter(p => p.Position === 'K').length}, DST: ${pool.filter(p => p.Position === 'DST').length}`);

  callback([...pool]);
}

// Helpers
function getUsersWithPreferencesSubmitted(room) {
  return room.users.map(user => ({
    ...user,
    preferencesSubmitted: Array.isArray(room.preferredQueue[user.id]) && room.preferredQueue[user.id].length > 0
  }));
}

function checkAllPreferencesSubmitted(room) {
  return room.users.every(user => Array.isArray(room.preferredQueue[user.id]) && room.preferredQueue[user.id].length > 0);
}

module.exports = { setupSocket };
