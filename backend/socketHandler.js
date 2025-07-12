function setupSocket(io, rooms) {
  io.on("connection", (socket) => {
    console.log(`🟢 Connected: ${socket.id}`);

    socket.on("join-room", ({ roomId, username }) => {
      if (!roomId || !username) {
        socket.emit("error", { message: "Room ID and username are required" });
        return;
      }

      console.log(`User ${username} joining room ${roomId}`);

      // Check if room exists
      if (!rooms[roomId]) {
        socket.emit("custom-error", { message: "Room not found" });
        return;
      }

      const room = rooms[roomId];

      // Initialize pool if it doesn't exist (this fixes the main issue)
      if (!room.pool) {
        room.pool = generatePlayerPool();
      }

      // Check if this is a reconnection (user was disconnected)
      const disconnectedUser = room.disconnectedUsers?.find(
        (u) => u.username.toLowerCase() === username.toLowerCase()
      );

      if (disconnectedUser) {
        // Reconnecting user
        console.log(`User ${username} reconnecting to room ${roomId}`);

        // Remove from disconnected users and add back to active users
        room.disconnectedUsers = room.disconnectedUsers.filter(
          (u) => u.username.toLowerCase() !== username.toLowerCase()
        );
        const user = { id: socket.id, username: username.trim() };
        room.users.push(user);

        // Restore selections - KEEP the old selections
        room.selections[socket.id] = disconnectedUser.selections || [];

        // Update turn order if game is running
        if (room.started && room.turnOrder.length > 0) {
          const turnIndex = room.turnOrder.findIndex(
            (oldId) => oldId === disconnectedUser.id
          );
          if (turnIndex !== -1) {
            room.turnOrder[turnIndex] = socket.id;

            // If it was this user's turn, they need to continue
            if (room.currentTurnIndex === turnIndex) {
              setTimeout(() => {
                startTurn(io, roomId, rooms);
              }, 1000);
            }
          }
        }

        // Clear reconnection timeout if it exists
        if (disconnectedUser.timeout) {
          clearTimeout(disconnectedUser.timeout);
        }
      } else {
        // New user joining
        // Check if username is already taken in this room (among active users)
        const existingUser = room.users.find(
          (u) => u.username.toLowerCase() === username.toLowerCase()
        );

        // Also check if user is in disconnected list (should not happen, but safety check)
        const existingDisconnected = room.disconnectedUsers?.find(
          (u) => u.username.toLowerCase() === username.toLowerCase()
        );

        if (existingUser) {
          socket.emit("error", {
            message: "Username already taken in this room",
          });
          return;
        }

        // If user exists in disconnected list, treat as reconnection
        if (existingDisconnected) {
          console.log(
            `Found user ${username} in disconnected list, treating as reconnection`
          );

          // Remove from disconnected users and add back to active users
          room.disconnectedUsers = room.disconnectedUsers.filter(
            (u) => u.username.toLowerCase() !== username.toLowerCase()
          );
          const user = { id: socket.id, username: username.trim() };
          room.users.push(user);

          // Restore selections
          room.selections[socket.id] = existingDisconnected.selections || [];

          // Update turn order if game is running
          if (room.started && room.turnOrder.length > 0) {
            const turnIndex = room.turnOrder.findIndex(
              (oldId) => oldId === existingDisconnected.id
            );
            if (turnIndex !== -1) {
              room.turnOrder[turnIndex] = socket.id;
            }
          }

          // Clear reconnection timeout if it exists
          if (existingDisconnected.timeout) {
            clearTimeout(existingDisconnected.timeout);
          }
        } else {
          // Completely new user
          const user = { id: socket.id, username: username.trim() };
          room.users.push(user);
          room.selections[socket.id] = [];

          // Set first user as host
          if (!room.hostId) {
            room.hostId = socket.id;
          }
        }
      }

      socket.join(roomId);

      // Send updated room info to all users
      io.to(roomId).emit("room-users", room.users);

      // Send disconnected users info to all users
      io.to(roomId).emit("disconnected-users", room.disconnectedUsers || []);

      // Send host info to the joining user
      socket.emit("host-status", {
        isHost: socket.id === room.hostId,
        started: room.started,
      });

      // Send current game state to the joining user (ensure pool is always sent)
      socket.emit("game-state", {
        turnOrder: room.started
          ? room.turnOrder
              .map((id) => {
                const user = room.users.find((u) => u.id === id);
                return user ? user.username : null;
              })
              .filter(Boolean)
          : [],
        currentTurnIndex: room.currentTurnIndex,
        pool: room.pool || [], // Ensure pool is never undefined
        selections: getSelectionsWithUsernames(room),
        started: room.started,
      });

      console.log(`✅ User ${username} successfully joined room ${roomId}`);
    });

    socket.on("start-selection", ({ roomId }) => {
      const room = rooms[roomId];
      if (!room) {
        socket.emit("custom-error", { message: "Room not found" });
        return;
      }

      if (room.started) {
        socket.emit("error", { message: "Selection already started" });
        return;
      }

      if (socket.id !== room.hostId) {
        socket.emit("error", { message: "Only host can start the selection" });
        return;
      }

      // Need at least 2 users to start
      if (room.users.length < 2) {
        socket.emit("error", { message: "Need at least 2 players to start" });
        return;
      }

      room.started = true;

      // Ensure pool exists before starting
      if (!room.pool || room.pool.length === 0) {
        room.pool = generatePlayerPool();
      }

      // Create turn order including ALL users (including host)
      room.turnOrder = shuffleArray(room.users.map((u) => u.id));
      room.currentTurnIndex = 0;

      console.log("Starting selection for room:", roomId);
      console.log(
        "Turn order (including host):",
        room.turnOrder.map((id) => {
          const user = room.users.find((u) => u.id === id);
          return user ? user.username : "Unknown";
        })
      );

      // Send turn order to all users
      const turnOrderUsernames = room.turnOrder
        .map((id) => {
          const user = room.users.find((u) => u.id === id);
          return user ? user.username : null;
        })
        .filter(Boolean);

      io.to(roomId).emit("turn-order", {
        order: turnOrderUsernames,
      });

      // Send updated pool to all users
      io.to(roomId).emit("pool-update", { pool: room.pool });

      // Start the first turn
      setTimeout(() => {
        startTurn(io, roomId, rooms);
      }, 1000);
    });

    socket.on("play-again", ({ roomId }) => {
      const room = rooms[roomId];
      if (!room) {
        socket.emit("custom-error", { message: "Room not found" });
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
      room.pool = generatePlayerPool(); // Reset pool

      // Reset selections for all users (both active and disconnected)
      room.users.forEach((user) => {
        room.selections[user.id] = [];
      });

      // Also reset selections for disconnected users
      if (room.disconnectedUsers) {
        room.disconnectedUsers.forEach((user) => {
          room.selections[user.id] = [];
          user.selections = []; // Update the stored selections too
        });
      }

      // Clear any existing timer
      if (room.timer) {
        clearTimeout(room.timer);
        room.timer = null;
      }

      // Notify all users about the reset and send new pool
      io.to(roomId).emit("play-again", { pool: room.pool });

      console.log(`Game reset for room ${roomId} by host`);
    });

    socket.on("exit-room", ({ roomId }) => {
      const room = rooms[roomId];
      if (!room) {
        return;
      }

      if (socket.id === room.hostId) {
        // Host is exiting, close the room
        io.to(roomId).emit("room-closed", {
          message: "Host has closed the room",
        });

        // Clean up all timeouts
        if (room.timer) clearTimeout(room.timer);
        if (room.disconnectedUsers) {
          room.disconnectedUsers.forEach((user) => {
            if (user.timeout) clearTimeout(user.timeout);
          });
        }

        delete rooms[roomId];
        console.log(`Room ${roomId} closed by host`);
      }
    });

    socket.on("select-player", ({ roomId, player }) => {
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

      // Find the player object in the pool
      const playerObj = room.pool.find((p) => p.name === player);
      if (!playerObj) {
        socket.emit("error", { message: "Player not available" });
        return;
      }

      console.log(`User ${socket.id} selected player ${player}`);

      // Clear the timer
      if (room.timer) {
        clearTimeout(room.timer);
        room.timer = null;
      }

      // Ensure selections array exists
      if (!room.selections[socket.id]) {
        room.selections[socket.id] = [];
      }

      // Add player to user's selection
      room.selections[socket.id].push(playerObj);
      // Remove player from pool
      room.pool = room.pool.filter((p) => p.name !== player);

      // Broadcast the selection
      const username = room.users.find((u) => u.id === socket.id)?.username;
      io.to(roomId).emit("player-selected", {
        player: playerObj,
        user: socket.id,
        username,
        selections: getSelectionsWithUsernames(room),
        pool: room.pool,
      });

      // Move to next turn
      moveToNextTurn(io, roomId, rooms);
    });

    socket.on("disconnect", () => {
      console.log(`🔴 Disconnected: ${socket.id}`);

      for (const roomId in rooms) {
        const room = rooms[roomId];
        const userIndex = room.users.findIndex((u) => u.id === socket.id);

        if (userIndex !== -1) {
          const disconnectedUser = room.users[userIndex];

          console.log(
            `User ${disconnectedUser.username} disconnected from room ${roomId}`
          );

          // Store current selections before removing user
          const currentSelections = room.selections[socket.id] || [];

          // Remove user from active users
          room.users.splice(userIndex, 1);

          // Add to disconnected users list with current selections
          if (!room.disconnectedUsers) {
            room.disconnectedUsers = [];
          }

          room.disconnectedUsers.push({
            id: socket.id,
            username: disconnectedUser.username,
            selections: currentSelections,
            disconnectedAt: new Date().toISOString(),
          });

          // Notify all users about disconnection
          io.to(roomId).emit("room-users", room.users);
          io.to(roomId).emit("disconnected-users", room.disconnectedUsers);

          // Set timeout to remove user permanently after 5 minutes
          const timeout = setTimeout(() => {
            // Remove from disconnected users if still there
            if (room.disconnectedUsers) {
              room.disconnectedUsers = room.disconnectedUsers.filter(
                (u) => u.id !== socket.id
              );
              io.to(roomId).emit("disconnected-users", room.disconnectedUsers);
            }

            // Clean up selections
            delete room.selections[socket.id];

            // Remove from turn order and adjust current turn index
            const turnIndex = room.turnOrder.indexOf(socket.id);
            if (turnIndex !== -1) {
              room.turnOrder.splice(turnIndex, 1);

              // Adjust current turn index
              if (room.currentTurnIndex > turnIndex) {
                room.currentTurnIndex--;
              } else if (
                room.currentTurnIndex >= room.turnOrder.length &&
                room.turnOrder.length > 0
              ) {
                room.currentTurnIndex = 0;
              }

              // If game is still running and we have players, continue
              if (room.started && room.turnOrder.length > 0) {
                setTimeout(() => {
                  startTurn(io, roomId, rooms);
                }, 1000);
              }
            }

            console.log(
              `User ${disconnectedUser.username} permanently removed from room ${roomId}`
            );
          }, 300000); // 5 minutes

          // Store timeout reference
          const disconnectedUserObj = room.disconnectedUsers.find(
            (u) => u.id === socket.id
          );
          if (disconnectedUserObj) {
            disconnectedUserObj.timeout = timeout;
          }

          // If disconnected user was host, assign new host
          if (room.hostId === socket.id && room.users.length > 0) {
            room.hostId = room.users[0].id;
            io.to(room.hostId).emit("host-status", {
              isHost: true,
              started: room.started,
            });
          }

          // If it was this user's turn when they disconnected, move to next turn
          if (room.started && room.turnOrder.length > 0) {
            const currentTurnUserId = room.turnOrder[room.currentTurnIndex];
            if (currentTurnUserId === socket.id) {
              console.log(
                "Disconnected user was current turn, moving to next turn"
              );
              moveToNextTurn(io, roomId, rooms);
            }
          }

          // Clean up empty rooms
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
            console.log(`Room ${roomId} deleted - no users left`);
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

  // Ensure pool exists
  if (!room.pool) {
    room.pool = generatePlayerPool();
  }

  // Find next user who needs more players
  let attempts = 0;
  while (attempts < room.turnOrder.length) {
    if (room.currentTurnIndex >= room.turnOrder.length) {
      room.currentTurnIndex = 0;
    }

    const userId = room.turnOrder[room.currentTurnIndex];

    // Check if user is currently connected
    const user = room.users.find((u) => u.id === userId);

    // If user is not connected, check if they're in disconnected list
    if (!user) {
      const disconnectedUser = room.disconnectedUsers?.find(
        (u) => u.id === userId
      );

      if (disconnectedUser) {
        // User is disconnected, check if they need more players
        const userSelections = room.selections[userId] || [];
        if (userSelections.length >= 5) {
          // User has enough players, move to next
          room.currentTurnIndex++;
          attempts++;
          continue;
        }

        // Check if pool is empty
        if (room.pool.length === 0) {
          // End the selection
          const results = getSelectionsWithUsernames(room);
          io.to(roomId).emit("selection-ended", { results });
          console.log("Selection ended for room:", roomId);
          return;
        }

        // Auto-select for disconnected user
        console.log(
          `User ${disconnectedUser.username} is disconnected, auto-selecting for their turn`
        );
        autoSelectForDisconnectedUser(
          io,
          roomId,
          rooms,
          userId,
          disconnectedUser.username
        );
        return;
      } else {
        // User not found anywhere, skip to next
        room.currentTurnIndex++;
        attempts++;
        continue;
      }
    }

    // Check if connected user needs more players
    const userSelections = room.selections[userId] || [];
    if (userSelections.length >= 5) {
      // User has enough players, move to next
      room.currentTurnIndex++;
      attempts++;
      continue;
    }

    // Check if pool is empty
    if (room.pool.length === 0) {
      // End the selection
      const results = getSelectionsWithUsernames(room);
      io.to(roomId).emit("selection-ended", { results });
      console.log("Selection ended for room:", roomId);
      return;
    }

    // Found a connected user who needs more players
    console.log(
      `Starting turn for user: ${user.username}, current selections: ${userSelections.length}`
    );

    // Notify the current user it's their turn
    io.to(userId).emit("your-turn", { pool: room.pool });

    // Notify all users about the current turn and timer
    io.to(roomId).emit("turn-update", {
      currentUser: user.username,
      userId: userId,
      seconds: 10,
    });

    // Set up auto-selection timer (10 seconds)
    if (room.timer) {
      clearTimeout(room.timer);
    }

    room.timer = setTimeout(() => {
      // Check if it's still the same user's turn and room still exists
      if (rooms[roomId] && room.turnOrder[room.currentTurnIndex] === userId) {
        autoSelect(io, roomId, rooms);
      }
    }, 10000);

    return;
  }

  // Check if all users have completed their selections
  const allUserIds = room.turnOrder;
  const allSelectionsComplete = allUserIds.every(
    (userId) => room.selections[userId] && room.selections[userId].length >= 5
  );

  if (allSelectionsComplete) {
    // End the selection
    const results = getSelectionsWithUsernames(room);
    io.to(roomId).emit("selection-ended", { results });
    console.log("Selection ended for room:", roomId);
    return;
  }

  // If we get here, there might be users who still need selections but pool is empty
  if (room.pool.length === 0) {
    const results = getSelectionsWithUsernames(room);
    io.to(roomId).emit("selection-ended", { results });
    console.log("Selection ended for room (pool empty):", roomId);
    return;
  }

  // Continue with next round
  room.currentTurnIndex = 0;
  setTimeout(() => {
    startTurn(io, roomId, rooms);
  }, 1000);
}

function autoSelectForDisconnectedUser(io, roomId, rooms, userId, username) {
  const room = rooms[roomId];
  if (!room || !room.pool || room.pool.length === 0) {
    moveToNextTurn(io, roomId, rooms);
    return;
  }

  // Randomly select a player
  const randomIndex = Math.floor(Math.random() * room.pool.length);
  const playerObj = room.pool[randomIndex];

  console.log(
    `Auto-selecting ${playerObj.name} for disconnected user ${username}`
  );

  // Ensure selections array exists
  if (!room.selections[userId]) {
    room.selections[userId] = [];
  }

  // Add player to user's selection
  room.selections[userId].push(playerObj);
  // Remove player from pool
  room.pool = room.pool.filter((p) => p.name !== playerObj.name);

  // Update disconnected user's selections
  const disconnectedUser = room.disconnectedUsers?.find((u) => u.id === userId);
  if (disconnectedUser) {
    disconnectedUser.selections = room.selections[userId];
  }

  // Broadcast the auto-selection for disconnected user
  io.to(roomId).emit("auto-selected-disconnected", {
    player: playerObj,
    user: userId,
    username: username,
    selections: getSelectionsWithUsernames(room),
    pool: room.pool,
  });

  // Move to next turn immediately (no delay for disconnected users)
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

  // Randomly select a player
  const randomIndex = Math.floor(Math.random() * room.pool.length);
  const playerObj = room.pool[randomIndex];

  console.log(`Auto-selecting ${playerObj.name} for user ${user.username}`);

  // Ensure selections array exists
  if (!room.selections[userId]) {
    room.selections[userId] = [];
  }

  // Add player to user's selection
  room.selections[userId].push(playerObj);
  // Remove player from pool
  room.pool = room.pool.filter((p) => p.name !== playerObj.name);

  // Broadcast the auto-selection
  io.to(roomId).emit("auto-selected", {
    player: playerObj,
    user: userId,
    username: user.username,
    selections: getSelectionsWithUsernames(room),
    pool: room.pool,
  });

  moveToNextTurn(io, roomId, rooms);
}

function moveToNextTurn(io, roomId, rooms) {
  const room = rooms[roomId];
  if (!room) return;

  // Clear any existing timer
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  // Move to next player
  room.currentTurnIndex++;

  // Start next turn (this will handle completion check)
  setTimeout(() => {
    startTurn(io, roomId, rooms);
  }, 1000);
}

function getSelectionsWithUsernames(room) {
  const results = {};

  // Get selections for active users
  for (const userId in room.selections) {
    const user = room.users.find((u) => u.id === userId);
    if (user) {
      results[user.username] = room.selections[userId] || [];
    }
  }

  // Also include disconnected users' selections if they have any
  if (room.disconnectedUsers) {
    room.disconnectedUsers.forEach((disconnectedUser) => {
      if (
        disconnectedUser.selections &&
        disconnectedUser.selections.length > 0
      ) {
        results[disconnectedUser.username] = disconnectedUser.selections;
      }
    });
  }

  return results;
}

function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function generatePlayerPool() {
  return [
    {
      name: "Virat Kohli",
      role: "Batsman",
      image:
        "https://upload.wikimedia.org/wikipedia/commons/9/9b/Virat_Kohli_in_PMO_New_Delhi.jpg",
    },
    {
      name: "Rohit Sharma",
      role: "Batsman",
      image:
        "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSoVuOX9HV9kcrTird7QDU9Zul_7164R4_XBQ&s",
    },
    {
      name: "MS Dhoni",
      role: "Wicket-keeper",
      image:
        "https://cdn.britannica.com/25/222725-050-170F622A/Indian-cricketer-Mahendra-Singh-Dhoni-2011.jpg",
    },
    {
      name: "Jasprit Bumrah",
      role: "Bowler",
      image:
        "https://upload.wikimedia.org/wikipedia/commons/0/02/Jasprit_Bumrah_in_PMO_New_Delhi.jpg",
    },
    {
      name: "Ravindra Jadeja",
      role: "All-rounder",
      image:
        "https://upload.wikimedia.org/wikipedia/commons/2/2c/PM_Shri_Narendra_Modi_with_Ravindra_Jadeja_%28Cropped%29.jpg",
    },
    {
      name: "Shubman Gill",
      role: "Batsman",
      image: "https://documents.iplt20.com/ipl/IPLHeadshot2025/62.png",
    },
    {
      name: "KL Rahul",
      role: "Wicket-keeper",
      image: "https://documents.bcci.tv/resizedimageskirti/1125_compress.png",
    },
    {
      name: "Hardik Pandya",
      role: "All-rounder",
      image:
        "https://upload.wikimedia.org/wikipedia/commons/f/fc/Hardik_Pandya_in_PMO_New_Delhi.jpg",
    },
    {
      name: "Ravichandran Ashwin",
      role: "Bowler",
      image:
        "https://i2.wp.com/crictoday.com/wp-content/uploads/2023/03/316521.webp?ssl=1",
    },
    {
      name: "Suryakumar Yadav",
      role: "Batsman",
      image:
        "https://upload.wikimedia.org/wikipedia/commons/b/b7/Suryakumar_Yadav_in_PMO_New_Delhi.jpg",
    },
    {
      name: "Mohammed Shami",
      role: "Bowler",
      image:
        "https://www.gujarattitansipl.com/static-assets/images/players/28994.png?v=5.55",
    },
    {
      name: "Shreyas Iyer",
      role: "Batsman",
      image: "https://documents.bcci.tv/resizedimageskirti/1563_compress.png",
    },
    {
      name: "Rishabh Pant",
      role: "Wicket-keeper",
      image:
        "https://media.gettyimages.com/id/2155145413/photo/new-york-new-york-rishabh-pant-of-india-poses-for-a-portrait-prior-to-the-icc-mens-t20.jpg?s=612x612&w=gi&k=20&c=I8p09aXSvPR_FK-zO9PPakfibNsDh8VJFqOuwgeKG0A=",
    },
    {
      name: "Yuzvendra Chahal",
      role: "Bowler",
      image:
        "https://media.gettyimages.com/id/2155703340/photo/new-york-new-york-yuzendra-chahal-of-india-poses-for-a-portrait-prior-to-the-icc-mens-t20.jpg?s=612x612&w=gi&k=20&c=SHJi9nPilxkpbl5t4zg103hZCFta17DfrCDgvQOwSOs=",
    },
    {
      name: "Bhuvneshwar Kumar",
      role: "Bowler",
      image:
        "https://i.pinimg.com/474x/a9/6d/0b/a96d0bbd8cb438403105ee8aaf840cfb.jpg",
    },
    {
      name: "Axar Patel",
      role: "All-rounder",
      image:
        "https://upload.wikimedia.org/wikipedia/commons/a/ad/Axar_Patel_in_PMO_New_Delhi.jpg",
    },
    {
      name: "Ishan Kishan",
      role: "Wicket-keeper",
      image: "https://documents.bcci.tv/resizedimageskirti/31_compress.png",
    },
    {
      name: "Washington Sundar",
      role: "All-rounder",
      image:
        "https://static-files.cricket-australia.pulselive.com/headshots/440/10947-camedia.png",
    },
    {
      name: "Kuldeep Yadav",
      role: "Bowler",
      image:
        "https://media.gettyimages.com/id/1713187439/photo/thiruvananthapuram-india-kuldeep-yadav-of-india-poses-for-a-portrait-ahead-of-the-icc-mens.jpg?s=612x612&w=gi&k=20&c=ztPCSdNAW_VLjXdpNzl4pBdKzuFp0w67swgy2Am-LZg=",
    },
    {
      name: "Deepak Chahar",
      role: "Bowler",
      image: "https://documents.iplt20.com/ipl/IPLHeadshot2025/91.png",
    },
    {
      name: "Prithvi Shaw",
      role: "Batsman",
      image: "https://documents.iplt20.com/ipl/IPLHeadshot2024/51.png",
    },
    {
      name: "Sanju Samson",
      role: "Wicket-keeper",
      image:
        "https://indiananchors.in/wp-content/uploads/2025/01/Sanju-samson.png",
    },
    {
      name: "Umran Malik",
      role: "Bowler",
      image:
        "https://www.hindustantimes.com/static-content/1y/cricket-logos/players/umran-malik.png",
    },
    {
      name: "Arshdeep Singh",
      role: "Bowler",
      image:
        "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR3k_b9rdRgfm7MwregvYkkuIa7H0NMjSY9UQ&s",
    },
    {
      name: "Tilak Varma",
      role: "Batsman",
      image:
        "https://www.mumbaiindians.com/static-assets/waf-images/14/fe/b4/16-9/1920-1080/aRWZYjG3Hb.png",
    },
    {
      name: "Mohammed Siraj",
      role: "Bowler",
      image: "https://documents.bcci.tv/resizedimageskirti/3840_compress.png",
    },
    {
      name: "Shardul Thakur",
      role: "All-rounder",
      image:
        "https://d1k8sn41pix00a.cloudfront.net/media/players/photos/shardul_thakur.webp",
    },
    {
      name: "Dinesh Karthik",
      role: "Wicket-keeper",
      image:
        "https://static-files.cricket-australia.pulselive.com/headshots/440/10910-camedia.png",
    },
    {
      name: "Deepak Hooda",
      role: "All-rounder",
      image:
        "https://cinetown.s3.ap-south-1.amazonaws.com/people/profile_img/1714157747.png",
    },
    {
      name: "Ruturaj Gaikwad",
      role: "Batsman",
      image:
        "https://th.bing.com/th/id/R.c3a5f2a3df874ccbc6e2f2ee01944c66?rik=tCrAKGyIirvqKw&riu=http%3a%2f%2finstitute.careerguide.com%2fwp-content%2fuploads%2f2024%2f04%2fRuturaj-Gaikwad.png&ehk=A01ASVCX9%2bqkCdgWDKCOezcAOddxKAjVIWi91B4iGg0%3d&risl=&pid=ImgRaw&r=0",
    },
  ];
}

module.exports = setupSocket;
