import React, { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import axios from "axios";

const socket = io("http://localhost:8000", {
  withCredentials: true,
  transports: ["websocket"],
});

const App = () => {
  // Connection state
  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("");
  const [inRoom, setInRoom] = useState(false);
  const [isHost, setIsHost] = useState(false);

  // Game state
  const [users, setUsers] = useState([]);
  const [disconnectedUsers, setDisconnectedUsers] = useState([]);
  const [pool, setPool] = useState([]);
  const [selections, setSelections] = useState({});
  const [gameStarted, setGameStarted] = useState(false);
  const [currentPhase, setCurrentPhase] = useState("main");

  // Turn state
  const [turn, setTurn] = useState(null);
  const [turnTimer, setTurnTimer] = useState(0);
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [turnOrder, setTurnOrder] = useState([]);

  // Preference state
  const [preferred, setPreferred] = useState([]);
  const [preferencesSubmitted, setPreferencesSubmitted] = useState(false);
  const [preferredQueue, setPreferredQueue] = useState({});

  // UI state
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Clear messages after 3 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  // Join room
  const joinRoom = () => {
    if (!username.trim() || !roomId.trim()) {
      setError("Please enter both username and room ID");
      return;
    }
    console.log("🔗 Joining room:", roomId.trim(), "as", username.trim());
    socket.emit("join-room", {
      roomId: roomId.trim(),
      username: username.trim(),
    });
    setInRoom(true);
  };

  // Create room
  const createRoom = async () => {
    if (!username.trim()) {
      setError("Please enter your username first");
      return;
    }

    try {
      const res = await axios.post("http://localhost:8000/api/create-room");
      setRoomId(res.data.roomId);
      setSuccess("Room created successfully!");
      console.log("🏠 Room created:", res.data.roomId);
    } catch (err) {
      setError("Error creating room: " + err.message);
    }
  };

  // Set preferred players
  const setPreferredPlayers = () => {
    if (preferred.length !== 7) {
      setError("Please select exactly 7 preferred players (5 main + 2 bench)");
      return;
    }
    console.log("📤 Sending preferred players:", preferred);
    socket.emit("set-preferred-players", {
      roomId,
      preferredPlayers: preferred,
    });
  };

  // Check if all players have submitted preferences
  const allPreferencesSubmitted = users.length > 0 && users.every(user => user.preferencesSubmitted);

  // Select a player during draft
  const selectPlayer = (playerID) => {
    if (!isMyTurn) {
      setError("It's not your turn!");
      return;
    }
    console.log("🎯 Selecting player:", playerID);
    socket.emit("select-player", { roomId, playerID });
  };

  // Start the draft (host only) - FIXED
  const startDraft = () => {
    console.log("🚀 Start Draft clicked");

    if (!isHost) {
      setError("Only host can start the draft");
      return;
    }

    if (!allPreferencesSubmitted) {
      setError("All players must submit their preferences first");
      return;
    }
    console.log("isHost:", isHost);
    console.log("users.length:", users.length);
    console.log("allPreferencesSubmitted:", allPreferencesSubmitted);

    console.log("🚀 Starting draft for room:", roomId);
    socket.emit("start-selection", { roomId });
  };

  // Toggle player in preferred list
  const togglePreferred = (playerID) => {
    if (preferred.includes(playerID)) {
      setPreferred(preferred.filter((id) => id !== playerID));
    } else {
      if (preferred.length >= 7) return;
      setPreferred([...preferred, playerID]);
    }
  };

  // Socket event handlers
  useEffect(() => {
    // Connection events
    socket.on("connect", () => {
      console.log("🔗 Connected to server");
    });

    socket.on("disconnect", () => {
      console.log("🔌 Disconnected from server");
    });

    // Room events
    socket.on("room-users", (users) => {
      console.log("👥 Room users updated:", users);
      setUsers(users);
    });

    socket.on("disconnected-users", (disconnectedUsers) => {
      console.log("💔 Disconnected users:", disconnectedUsers);
      setDisconnectedUsers(disconnectedUsers);
    });

    socket.on("host-status", ({ isHost, started }) => {
      console.log("👑 Host status:", isHost, "Started:", started);
      setIsHost(isHost);
      setGameStarted(started);
    });

    socket.on("room-joined", ({ roomId, username, pool }) => {
      console.log("✅ Successfully joined room:", roomId, "as", username);
      setRoomId(roomId);
      setUsername(username);
      setPool(pool || []);
      setSuccess("Successfully joined room!");
    });

    // Game state events
    socket.on(
      "game-state",
      ({
        pool,
        selections,
        preferredQueue,
        started,
        selectionPhase,
        turnOrder,
        currentTurnIndex,
      }) => {
        console.log("🎮 Game state received:", {
          poolSize: pool?.length || 0,
          started,
          selectionPhase,
          preferredQueue: preferredQueue ? Object.keys(preferredQueue).length : 0,
          turnOrder: turnOrder?.length || 0,
          currentTurnIndex,
        });

        if (pool) setPool(pool);
        if (selections) setSelections(selections);
        // Fix: always set preferred as an array for this user
        if (preferredQueue) {
          // Try to find the current user's preferred array by username
          let userPref = [];
          if (typeof preferredQueue === 'object' && preferredQueue !== null) {
            // Try by socket id (not available on frontend), fallback to username
            const userObj = users.find(u => u.username === username);
            if (userObj && preferredQueue[userObj.id]) {
              userPref = preferredQueue[userObj.id];
            } else if (preferredQueue[username]) {
              userPref = preferredQueue[username];
            }
          } else if (Array.isArray(preferredQueue)) {
            userPref = preferredQueue;
          }
          setPreferred(Array.isArray(userPref) ? userPref : []);
          setPreferredQueue(preferredQueue);
        }
        if (typeof started === "boolean") setGameStarted(started);
        if (selectionPhase) setCurrentPhase(selectionPhase);
        if (turnOrder) setTurnOrder(turnOrder);

        // Set current turn based on turn order and index
        if (turnOrder && typeof currentTurnIndex === "number") {
          const currentTurnUser = turnOrder[currentTurnIndex];
          setTurn(currentTurnUser);
          setIsMyTurn(currentTurnUser === username);
        }
      }
    );

    socket.on("pool-update", ({ pool }) => {
      console.log("🏊 Pool updated:", pool.length, "players");
      setPool(pool);
    });

    // FIXED: Handle draft-started event properly
    socket.on("draft-started", (data) => {
      console.log("🎯 Draft Started", data);
      setGameStarted(true);

      if (data.pool) setPool(data.pool);
      if (data.turnOrder) setTurnOrder(data.turnOrder);
      if (data.selectionPhase) setCurrentPhase(data.selectionPhase);

      // Set initial turn
      if (data.currentUser) {
        setTurn(data.currentUser);
        setIsMyTurn(data.currentUser === username);
      } else if (data.turnOrder && data.turnOrder.length > 0) {
        const firstUser = data.turnOrder[0];
        setTurn(firstUser);
        setIsMyTurn(firstUser === username);
      }

      setTurnTimer(30); // Default 30 seconds
      setSuccess("Draft has started!");
    });

    // Turn events
    socket.on(
      "turn-update",
      ({ currentUser, seconds, selectionPhase, userId }) => {
        console.log("🎯 Turn update:", currentUser, "has", seconds, "seconds");
        setTurn(currentUser);
        setTurnTimer(seconds || 30);
        setIsMyTurn(currentUser === username);
        if (selectionPhase) setCurrentPhase(selectionPhase);
      }
    );

    socket.on(
      "your-turn",
      ({ pool, selectionPhase, seconds, selectionsCount, maxPlayers }) => {
        console.log(
          "🎲 It's your turn! Phase:",
          selectionPhase,
          "Selections:",
          selectionsCount,
          "Max:",
          maxPlayers
        );
        if (pool) setPool(pool);
        if (selectionPhase) setCurrentPhase(selectionPhase);
        setIsMyTurn(true);
        setTurnTimer(seconds || 30);
        setSuccess(
          `It's your turn! ${
            selectionPhase === "main" ? "Main" : "Bench"
          } phase`
        );
      }
    );

    socket.on("turn-order", ({ order }) => {
      console.log("📋 Turn order:", order);
      setTurnOrder(order);
    });

    // Selection events
    socket.on(
      "player-selected",
      ({ selections, pool, player, username: selectedBy, selectionPhase }) => {
        console.log("✅ Player selected:", player.Name, "by", selectedBy);
        setSelections(selections);
        if (pool) setPool(pool);
        if (selectionPhase) setCurrentPhase(selectionPhase);
        setIsMyTurn(false);
        setTurnTimer(0);
        setSuccess(`${selectedBy} selected ${player.Name}`);
      }
    );

    socket.on(
      "auto-selected",
      ({ selections, pool, player, username: selectedBy, selectionPhase }) => {
        console.log("⏰ Auto-selected:", player.Name, "for", selectedBy);
        setSelections(selections);
        if (pool) setPool(pool);
        if (selectionPhase) setCurrentPhase(selectionPhase);
        setIsMyTurn(false);
        setTurnTimer(0);
        setSuccess(`Auto-selected ${player.Name} for ${selectedBy}`);
      }
    );

    socket.on(
      "auto-selected-disconnected",
      ({ selections, pool, player, username: selectedBy, selectionPhase }) => {
        console.log(
          "🔌 Auto-selected for disconnected:",
          player.Name,
          "for",
          selectedBy
        );
        setSelections(selections);
        if (pool) setPool(pool);
        if (selectionPhase) setCurrentPhase(selectionPhase);
        setIsMyTurn(false);
        setTurnTimer(0);
        setSuccess(
          `Auto-selected ${player.Name} for disconnected ${selectedBy}`
        );
      }
    );

    // Phase events
    socket.on("selection-phase-update", ({ phase, message }) => {
      console.log("🔄 Phase update:", phase, message);
      setCurrentPhase(phase);
      setSuccess(message);
    });

    socket.on("selection-ended", ({ results, finalPhase }) => {
      console.log("🏁 Selection ended:", results, finalPhase);
      setGameStarted(false);
      if (results) setSelections(results);
      setTurnTimer(0);
      setIsMyTurn(false);
      setTurn(null);
      setSuccess("Draft completed!");
    });

    // Preference events
    socket.on("preferred-players-updated", ({ preferredPlayers, message }) => {
      // Fix: always set preferred as an array
      setPreferred(Array.isArray(preferredPlayers) ? preferredPlayers : []);
      setPreferencesSubmitted(true);
      setSuccess(message);
    });

    // Play again event
    socket.on("play-again", ({ pool, phase }) => {
      console.log("🔄 Play again:", phase);
      if (pool) setPool(pool);
      if (phase) setCurrentPhase(phase);
      setGameStarted(false);
      setSelections({});
      setPreferencesSubmitted(false);
      setPreferred([]);
      setTurn(null);
      setIsMyTurn(false);
      setTurnTimer(0);
      setTurnOrder([]);
      setSuccess("Game reset! Set your preferences again.");
    });

    // Error events
    socket.on("error", ({ message }) => {
      console.error("❌ Socket Error:", message);
      setError(message);
    });

    socket.on("custom-error", ({ message }) => {
      console.error("❌ Custom Error:", message);
      setError(message);
    });

    socket.on("room-closed", ({ message }) => {
      console.log("🚪 Room closed:", message);
      setError(message);
      setInRoom(false);
    });

    socket.on("room-not-found", ({ message }) => {
      console.error("🚫 Room not found:", message);
      setError(message);
      setInRoom(false);
    });

    // Cleanup
    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("room-users");
      socket.off("disconnected-users");
      socket.off("host-status");
      socket.off("room-joined");
      socket.off("game-state");
      socket.off("pool-update");
      socket.off("draft-started");
      socket.off("turn-update");
      socket.off("your-turn");
      socket.off("turn-order");
      socket.off("player-selected");
      socket.off("auto-selected");
      socket.off("auto-selected-disconnected");
      socket.off("selection-phase-update");
      socket.off("selection-ended");
      socket.off("preferred-players-updated");
      socket.off("play-again");
      socket.off("error");
      socket.off("custom-error");
      socket.off("room-closed");
      socket.off("room-not-found");
    };
  }, [username, users]);

  // Timer countdown effect
  useEffect(() => {
    if (turnTimer > 0 && gameStarted) {
      const interval = setInterval(() => {
        setTurnTimer((prev) => {
          if (prev <= 1) {
            if (isMyTurn) {
              setIsMyTurn(false);
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [turnTimer, gameStarted, isMyTurn]);

  // Animate player removal when pool updates
  const [removingPlayers, setRemovingPlayers] = useState([]);
  const prevPoolRef = useRef([]);

  useEffect(() => {
    const prevPool = prevPoolRef.current;
    const removed = prevPool.filter(
      (p) => !pool.some((np) => np.PlayerID === p.PlayerID)
    );
    if (removed.length > 0) {
      setRemovingPlayers(removed.map((p) => p.PlayerID));
      setTimeout(() => setRemovingPlayers([]), 500); // match CSS transition
    }
    prevPoolRef.current = pool;
  }, [pool]);

  // Get preferred player details
  const preferredPlayerDetails = (Array.isArray(preferred) ? preferred : []).map(pid =>
    pool.find(p => p.PlayerID === pid)
  ).filter(Boolean);

  // Get current user's selections for display
  const mySelections = selections[username] || [];

  // Group pool by position for preferences UI
  const poolByPosition = pool.reduce((acc, player) => {
    if (!acc[player.Position]) acc[player.Position] = [];
    acc[player.Position].push(player);
    return acc;
  }, {});

  // Render login screen
  if (!inRoom) {
    return (
      <div
        style={{
          padding: "2rem",
          fontFamily: "Arial, sans-serif",
          maxWidth: "500px",
          margin: "0 auto",
        }}
      >
        <h2>🏈 NFL Draft Room</h2>

        {error && (
          <div
            style={{
              backgroundColor: "#ffebee",
              color: "#c62828",
              padding: "1rem",
              borderRadius: "4px",
              marginBottom: "1rem",
            }}
          >
            {error}
          </div>
        )}

        {success && (
          <div
            style={{
              backgroundColor: "#e8f5e8",
              color: "#2e7d32",
              padding: "1rem",
              borderRadius: "4px",
              marginBottom: "1rem",
            }}
          >
            {success}
          </div>
        )}

        <div style={{ marginBottom: "1rem" }}>
          <input
            placeholder="Enter your username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{
              padding: "0.5rem",
              marginRight: "0.5rem",
              borderRadius: "4px",
              border: "1px solid #ccc",
              width: "200px",
            }}
          />
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <input
            placeholder="Enter room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            style={{
              padding: "0.5rem",
              marginRight: "0.5rem",
              borderRadius: "4px",
              border: "1px solid #ccc",
              width: "200px",
            }}
          />
          <button
            onClick={joinRoom}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#4caf50",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Join Room
          </button>
        </div>

        <button
          onClick={createRoom}
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "#2196f3",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Create New Room
        </button>
      </div>
    );
  }

  // Render game screen
  return (
    <div style={{ padding: "2rem", fontFamily: "Arial, sans-serif" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h2>
          🏈 NFL Draft - Room: {roomId} {isHost && "👑"}
        </h2>

        {error && (
          <div
            style={{
              backgroundColor: "#ffebee",
              color: "#c62828",
              padding: "1rem",
              borderRadius: "4px",
              marginBottom: "1rem",
            }}
          >
            {error}
          </div>
        )}

        {success && (
          <div
            style={{
              backgroundColor: "#e8f5e8",
              color: "#2e7d32",
              padding: "1rem",
              borderRadius: "4px",
              marginBottom: "1rem",
            }}
          >
            {success}
          </div>
        )}
      </div>

      {/* Game Status */}
      <div
        style={{
          backgroundColor: "#f5f5f5",
          padding: "1rem",
          borderRadius: "8px",
          marginBottom: "2rem",
        }}
      >
        <h3>📊 Game Status</h3>
        <p>
          <strong>Status:</strong>{" "}
          {gameStarted
            ? `🎮 Playing (${currentPhase} phase)`
            : "⏳ Waiting to start"}
        </p>
        <p>
          <strong>Your Preferences:</strong>{" "}
          {preferencesSubmitted ? "✅ Submitted" : "❌ Not submitted"}
        </p>
        <p>
          <strong>Your Selections:</strong> {mySelections.length} players
        </p>
        <p>
          <strong>Players:</strong> {users.length} active,{" "}
          {disconnectedUsers.length} disconnected
        </p>
        <p>
          <strong>Available Players:</strong> {pool.length}
        </p>

        {gameStarted && turn && (
          <div
            style={{
              backgroundColor: isMyTurn ? "#ffcdd2" : "#e3f2fd",
              padding: "1rem",
              borderRadius: "4px",
              marginTop: "1rem",
            }}
          >
            <h4
              style={{
                margin: "0",
                color: isMyTurn ? "#c62828" : "#1976d2",
              }}
            >
              {isMyTurn
                ? `⏰ YOUR TURN! (${turnTimer}s remaining)`
                : `⏱️ ${turn}'s turn (${turnTimer}s remaining)`}
            </h4>
          </div>
        )}
      </div>

      {/* Players List */}
      <div style={{ marginBottom: "2rem" }}>
        <h3>👥 Players ({users.length})</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {users.map((user) => (
            <span
              key={user.username}
              style={{
                backgroundColor: user.preferencesSubmitted
                  ? "#e8f5e8"
                  : "#fff3cd",
                padding: "0.25rem 0.5rem",
                borderRadius: "4px",
                border: `1px solid ${
                  user.preferencesSubmitted ? "#4caf50" : "#ff9800"
                }`,
              }}
            >
              {user.username} {user.preferencesSubmitted ? "✅" : "⏳"}
            </span>
          ))}
        </div>

        {disconnectedUsers.length > 0 && (
          <div style={{ marginTop: "1rem" }}>
            <h4>💔 Disconnected ({disconnectedUsers.length})</h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {disconnectedUsers.map((user) => (
                <span
                  key={user.username}
                  style={{
                    backgroundColor: "#ffebee",
                    padding: "0.25rem 0.5rem",
                    borderRadius: "4px",
                  }}
                >
                  {user.username}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Turn Order */}
      {gameStarted && turnOrder.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <h3>📋 Draft Order</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {turnOrder.map((playerName, index) => (
              <span
                key={index}
                style={{
                  backgroundColor: playerName === turn ? "#4caf50" : "#f0f0f0",
                  color: playerName === turn ? "white" : "black",
                  padding: "0.25rem 0.5rem",
                  borderRadius: "4px",
                  fontWeight: playerName === turn ? "bold" : "normal",
                }}
              >
                {index + 1}. {playerName}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Pre-Game: Set Preferences */}
      {!gameStarted && (
        <div style={{ marginBottom: '2rem' }}>
          <h3>⭐ Set Your Preferences ({preferred.length}/7)</h3>
          <p>Select exactly 7 players in order of preference (5 main + 2 bench)</p>
          {pool.length === 0 ? (
            <div style={{ 
              backgroundColor: '#fff3cd', 
              padding: '1rem', 
              borderRadius: '4px', 
              marginBottom: '1rem' 
            }}>
              <p>⏳ Loading player pool...</p>
            </div>
          ) : (
            <div style={{
              display: 'flex',
              gap: '1rem',
              flexWrap: 'wrap',
              marginBottom: '1rem',
            }}>
              {Object.keys(poolByPosition).sort().map(position => (
                <div key={position} style={{
                  flex: '1 1 180px',
                  minWidth: '180px',
                  maxWidth: '220px',
                  backgroundColor: '#f9f9f9',
                  border: '1px solid #ccc',
                  borderRadius: '8px',
                  padding: '0.5rem',
                  maxHeight: '320px',
                  overflowY: 'auto',
                }}>
                  <h4 style={{
                    margin: '0 0 0.5rem 0',
                    textAlign: 'center',
                    background: '#e3f2fd',
                    borderRadius: '4px',
                    padding: '0.25rem 0',
                    fontSize: '1.1em',
                    letterSpacing: '1px',
                  }}>{position}</h4>
                  {poolByPosition[position].map(player => {
                    const isSelected = preferred.includes(player.PlayerID);
                    const isDisabled = !isSelected && preferred.length >= 7;
                    const priority = preferred.indexOf(player.PlayerID) + 1;
                    return (
                      <button
                        key={player.PlayerID}
                        onClick={() => togglePreferred(player.PlayerID)}
                        disabled={isDisabled}
                        style={{
                          display: 'block',
                          width: '100%',
                          margin: '5px 0',
                          padding: '0.5rem',
                          backgroundColor: isSelected ? '#4caf50' : '#fff',
                          color: isSelected ? 'white' : 'black',
                          border: isSelected ? '2px solid #45a049' : '1px solid #ddd',
                          borderRadius: '4px',
                          cursor: isDisabled ? 'not-allowed' : 'pointer',
                          textAlign: 'left',
                          opacity: isDisabled ? 0.5 : 1,
                          fontWeight: isSelected ? 'bold' : 'normal',
                        }}
                      >
                        {isSelected && `${priority}. `}
                        {player.Name}
                        {isSelected && ' ✅'}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* Selected Preferences */}
          {preferred.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <h4>Your Preferences ({preferred.length}/7):</h4>
              <ol>
                {preferredPlayerDetails.map((player, index) => (
                  <li key={player.PlayerID} style={{ marginBottom: "0.25rem" }}>
                    {player.Name} - {player.Position}
                    <span style={{ color: "#666" }}>
                      ({index < 5 ? "Main" : "Bench"})
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <button
              onClick={setPreferredPlayers}
              disabled={preferred.length !== 7}
              style={{
                padding: "0.75rem 1.5rem",
                backgroundColor: preferred.length === 7 ? "#4caf50" : "#ccc",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: preferred.length === 7 ? "pointer" : "not-allowed",
                fontSize: "1rem",
              }}
            >
              💡 Submit Preferences ({preferred.length}/7)
            </button>

            {isHost && (
              <button
                onClick={startDraft}
                disabled={users.length < 2 || !allPreferencesSubmitted}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: (users.length >= 2 && allPreferencesSubmitted) ? '#2196f3' : '#ccc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: (users.length >= 2 && allPreferencesSubmitted) ? 'pointer' : 'not-allowed',
                  fontSize: '1rem'
                }}
              >
                🚀 Start Draft
              </button>
            )}
          </div>

          {isHost && users.length >= 2 && !allPreferencesSubmitted && (
            <p style={{ color: "#f57c00", marginTop: "0.5rem" }}>
              ⚠️ Waiting for all players to submit their preferences
            </p>
          )}

          {isHost && users.length < 2 && (
            <p style={{ color: "#f57c00", marginTop: "0.5rem" }}>
              ⚠️ Need at least 2 players to start the draft
            </p>
          )}
        </div>
      )}

      {/* During Game: Player Selection */}
      {gameStarted && (
        <div style={{ marginBottom: "2rem" }}>
          <h3>
            🎯 Current Turn: {turn || "Waiting..."}
            {isMyTurn && (
              <span style={{ color: "#c62828" }}> - YOUR TURN!</span>
            )}
          </h3>
          <h4>
            Phase:{" "}
            {currentPhase === "main"
              ? "🎯 Main Players (5)"
              : "🪑 Bench Players (2)"}
          </h4>

          {/* My Current Team */}
          {mySelections.length > 0 && (
            <div
              style={{
                backgroundColor: "#e8f5e8",
                padding: "1rem",
                borderRadius: "4px",
                marginBottom: "1rem",
              }}
            >
              <h4>🎯 Your Team ({mySelections.length})</h4>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {mySelections.map((player, index) => (
                  <span
                    key={player.PlayerID}
                    style={{
                      backgroundColor: "#4caf50",
                      color: "white",
                      padding: "0.25rem 0.5rem",
                      borderRadius: "4px",
                      fontSize: "0.9rem",
                    }}
                  >
                    {player.Name} ({player.Position})
                  </span>
                ))}
              </div>
            </div>
          )}

          {pool.length === 0 ? (
            <div
              style={{
                backgroundColor: "#fff3cd",
                padding: "1rem",
                borderRadius: "4px",
              }}
            >
              <p>⏳ No players available or loading...</p>
            </div>
          ) : (
            <div
              style={{
                maxHeight: "400px",
                overflowY: "auto",
                border: "1px solid #ccc",
                borderRadius: "8px",
                padding: "1rem",
              }}
            >
              <h4>📋 Available Players ({pool.length})</h4>
              {pool.map((player) => {
                const isPreferred = preferred.includes(player.PlayerID);
                return (
                  <div
                    key={player.PlayerID}
                    className={`player-card${removingPlayers.includes(player.PlayerID) ? " removing" : ""}`}
                    style={{
                      margin: "8px 0",
                      padding: "0.75rem",
                      backgroundColor: isPreferred ? "#fff3e0" : "white",
                      border: isPreferred
                        ? "2px solid #ff9800"
                        : "1px solid #e0e0e0",
                      borderRadius: "4px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontSize: "1rem" }}>
                      {isPreferred && "⭐ "}
                      <strong>{player.Name}</strong> - {player.Position}
                    </span>
                    <button
                      onClick={() => selectPlayer(player.PlayerID)}
                      disabled={!isMyTurn}
                      style={{
                        padding: "0.5rem 1rem",
                        backgroundColor: isMyTurn ? "#4caf50" : "#ccc",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: isMyTurn ? "pointer" : "not-allowed",
                      }}
                    >
                      Select
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Show all users and their preferred players */}
      {users.length > 0 && (
        <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
          <h3>⭐ All Players' Preferences</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '0.5rem' }}>Player</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '0.5rem' }}>Preferred Players (in order)</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => {
                // Find this user's preferred array from preferredQueue (if available)
                let userPref = [];
                if (typeof preferredQueue === 'object' && preferredQueue !== null) {
                  if (user.id && preferredQueue[user.id]) {
                    userPref = preferredQueue[user.id];
                  } else if (preferredQueue[user.username]) {
                    userPref = preferredQueue[user.username];
                  }
                }
                // Get player details for each preferred PlayerID
                const details = (Array.isArray(userPref) ? userPref : []).map((pid, idx) => {
                  const p = pool.find(pl => pl.PlayerID === pid);
                  if (!p) return null;
                  return (
                    <span key={pid} style={{
                      display: 'inline-block',
                      backgroundColor: idx < 5 ? '#e3f2fd' : '#fffde7',
                      color: '#333',
                      borderRadius: '4px',
                      padding: '0.25rem 0.5rem',
                      marginRight: '0.25rem',
                      marginBottom: '0.25rem',
                      border: '1px solid #ccc',
                      fontSize: '0.95em'
                    }}>
                      {idx + 1}. {p.Name} ({p.Position}) {idx < 5 ? 'Main' : 'Bench'}
                    </span>
                  );
                }).filter(Boolean);
                return (
                  <tr key={user.username}>
                    <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>{user.username}</td>
                    <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>{details.length > 0 ? details : <span style={{ color: '#aaa' }}>No preferences</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default App;