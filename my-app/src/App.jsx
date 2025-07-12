// 📁 frontend/src/App.jsx
import React, { useEffect, useState, useCallback } from "react";
import { io } from "socket.io-client";
import "./App.css";

// Initialize socket connection
const socket = io(process.env.REACT_APP_BACKEND_URL, {
  transports: ['websocket'],
  withCredentials: true
});

function App() {
  const [roomId, setRoomId] = useState("");
  const [username, setUsername] = useState("");
  const [joined, setJoined] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [users, setUsers] = useState([]);
  const [disconnectedUsers, setDisconnectedUsers] = useState([]);
  const [turnOrder, setTurnOrder] = useState([]);
  const [currentTurn, setCurrentTurn] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [playerPool, setPlayerPool] = useState([]);
  const [selections, setSelections] = useState({});
  const [myTurn, setMyTurn] = useState(false);
  const [results, setResults] = useState(null);
  const [timer, setTimer] = useState(10);
  const [intervalId, setIntervalId] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [roomClosed, setRoomClosed] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [autoSelectionMessage, setAutoSelectionMessage] = useState("");

  // Clear timer function
  const clearTimer = useCallback(() => {
    if (intervalId) {
      clearInterval(intervalId);
      setIntervalId(null);
    }
  }, [intervalId]);

  // Show success message
  const showSuccessMessage = (message) => {
    const originalError = error;
    setError(message);
    setTimeout(() => setError(originalError), 3000);
  };

  // Show auto-selection message
  const showAutoSelectionMessage = (message) => {
    setAutoSelectionMessage(message);
    setTimeout(() => setAutoSelectionMessage(""), 5000);
  };

  useEffect(() => {
    console.log('🔧 Setting up socket listeners');

    // Connection status handlers
    socket.on('connect', () => {
      setConnectionStatus('connected');
      console.log('✅ Connected to server, Socket ID:', socket.id);

      // If we were reconnecting, try to rejoin the room
      if (isReconnecting && roomId && username) {
        console.log('🔄 Attempting to rejoin room after reconnection');
        socket.emit("join-room", {
          roomId: roomId.trim().toUpperCase(),
          username: username.trim(),
        });
      }
    });

    socket.on('disconnect', () => {
      setConnectionStatus('disconnected');
      console.log('❌ Disconnected from server');
      if (joined) {
        setIsReconnecting(true);
      }
    });

    socket.on('connect_error', (error) => {
      setConnectionStatus('error');
      console.log('💥 Connection error:', error);
    });

    // Handle custom errors (like room not found)
    socket.on('custom-error', ({ message }) => {
      console.log('🚨 Custom error:', message);
      setError(message);
      setLoading(false);
      setTimeout(() => setError(''), 5000);
    });

    // Handle successful reconnection
    socket.on('reconnection-success', ({ message, gameState }) => {
      console.log('🎉 Reconnection successful:', message);
      setIsReconnecting(false);
      showSuccessMessage('Successfully reconnected! 🎉');

      if (gameState) {
        // Restore game state
        setGameStarted(gameState.started || false);
        setSelections(gameState.selections || {});
        setPlayerPool(gameState.pool || []);
        setTurnOrder(gameState.turnOrder || []);
        setCurrentTurn(gameState.currentTurn || null);
        setCurrentUserId(gameState.currentUserId || null);
        setMyTurn(gameState.myTurn || false);
        setTimer(gameState.timer || 10);
      }
    });

    // Handle room users update
    socket.on('room-users', (userList) => {
      setUsers(userList);
      setLoading(false);
      console.log('👥 Users updated:', userList);
    });

    // Handle disconnected users update
    socket.on('disconnected-users', (disconnectedUserList) => {
      setDisconnectedUsers(disconnectedUserList);
      console.log('👥 Disconnected users updated:', disconnectedUserList);
    });

    // Handle host status
    socket.on('host-status', ({ isHost: hostStatus, started }) => {
      setIsHost(hostStatus);
      setGameStarted(started);
      setLoading(false);
      console.log('👑 Host status:', hostStatus, 'Started:', started);
    });

    // Handle game state
    socket.on('game-state', ({ turnOrder: order, currentTurnIndex, pool, selections: gameSelections, started }) => {
      console.log('🎮 Game state received:', { order, currentTurnIndex, poolSize: pool?.length, started });

      if (started) {
        setTurnOrder(order);
        setPlayerPool(pool);
        setSelections(gameSelections);
        setGameStarted(true);
        setLoading(false);

        if (order.length > 0 && currentTurnIndex < order.length) {
          setCurrentTurn(order[currentTurnIndex]);
        }
      }
    });

    // Handle turn order announcement
    socket.on('turn-order', ({ order }) => {
      console.log('📋 Turn order received:', order);
      setTurnOrder(order);
      setGameStarted(true);
      setLoading(false);
    });

    // Handle pool updates
    socket.on('pool-update', ({ pool }) => {
      console.log('🏊 Pool updated:', pool?.length, 'players');
      setPlayerPool(pool);
    });

    // Handle turn updates
    socket.on('turn-update', ({ currentUser, userId, seconds }) => {
      console.log('⏰ Turn update:', currentUser, 'User ID:', userId, 'Seconds:', seconds);
      setCurrentTurn(currentUser);
      setCurrentUserId(userId);
      setTimer(seconds);
      setMyTurn(userId === socket.id);
      setLoading(false);

      // Clear any existing timer
      clearTimer();

      // Start countdown timer
      const id = setInterval(() => {
        setTimer(prev => {
          if (prev <= 1) {
            clearInterval(id);
            setIntervalId(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      setIntervalId(id);
    });

    // Handle play again event
    socket.on('play-again', ({ pool }) => {
      console.log('🔄 Play again initiated');
      setResults(null);
      setGameStarted(false);
      setTurnOrder([]);
      setCurrentTurn(null);
      setCurrentUserId(null);
      setPlayerPool(pool || []);
      setSelections({});
      setMyTurn(false);
      setTimer(10);
      setLoading(false);
      setAutoSelectionMessage("");
      clearTimer();
    });

    // Handle room closed event
    socket.on('room-closed', ({ message }) => {
      console.log('🚪 Room closed:', message);
      setRoomClosed(true);
      setError(message);
      clearTimer();
    });

    // Handle errors
    socket.on('error', ({ message }) => {
      console.log('💥 Socket error:', message);
      setError(message);
      setLoading(false);
      setTimeout(() => setError(''), 5000);
    });

    // Handle your turn
    socket.on('your-turn', ({ pool }) => {
      setMyTurn(true);
      setPlayerPool(pool);
      setLoading(false);
      console.log('🎯 Your turn! Pool size:', pool.length);
    });

    // Handle player selection by active users
    socket.on('player-selected', ({ player, user, username, selections: updatedSelections, pool }) => {
      setPlayerPool(pool);
      setSelections(updatedSelections);
      setMyTurn(false);
      setLoading(false);
      clearTimer();
      console.log(`✅ ${username} selected ${player.name}`);
    });

    // Handle auto-selection for connected users
    socket.on('auto-selected', ({ player, user, username, selections: updatedSelections, pool }) => {
      setPlayerPool(pool);
      setSelections(updatedSelections);
      setMyTurn(false);
      setLoading(false);
      clearTimer();
      console.log(`🤖 Auto-selected ${player.name} for ${username}`);
      showAutoSelectionMessage(`⏰ Time's up! Auto-selected ${player.name} for ${username}`);
    });

    // Handle auto-selection for disconnected users
    socket.on('auto-selected-disconnected', ({ player, user, username, selections: updatedSelections, pool }) => {
      setPlayerPool(pool);
      setSelections(updatedSelections);
      setMyTurn(false);
      setLoading(false);
      clearTimer();
      console.log(`🤖 Auto-selected ${player.name} for disconnected user ${username}`);
      showAutoSelectionMessage(`🔴 Auto-selected ${player.name} for disconnected player ${username}`);
    });

    // Handle selection ended
    socket.on('selection-ended', ({ results: finalResults }) => {
      setResults(finalResults);
      setMyTurn(false);
      setGameStarted(false);
      setLoading(false);
      clearTimer();
      console.log('🏁 Selection ended:', finalResults);
    });

    // Cleanup function
    return () => {
      console.log('🧹 Cleaning up socket listeners');
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('room-users');
      socket.off('disconnected-users');
      socket.off('host-status');
      socket.off('game-state');
      socket.off('turn-order');
      socket.off('pool-update');
      socket.off('turn-update');
      socket.off('your-turn');
      socket.off('player-selected');
      socket.off('auto-selected');
      socket.off('auto-selected-disconnected');
      socket.off('selection-ended');
      socket.off('play-again');
      socket.off('room-closed');
      socket.off('error');
      socket.off('custom-error');
      socket.off('reconnection-success');
      clearTimer();
    };
  }, [clearTimer, isReconnecting, roomId, username, joined, error]);

  const createRoom = async () => {
    if (!username.trim()) {
      setError("Please enter your username");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `${process.env.REACT_APP_BACKEND_URL}/api/create-room`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const data = await response.json();
      if (response.ok) {
        setRoomId(data.roomId);
        handleJoin(data.roomId);
      } else {
        setError(data.error || "Failed to create room");
        setLoading(false);
      }
    } catch (err) {
      setError("Failed to create room. Please try again.");
      setLoading(false);
      console.error("Create room error:", err);
    }
  };

  const handleJoin = (targetRoomId = null) => {
    const roomToJoin = targetRoomId || roomId;

    if (!roomToJoin.trim() || !username.trim()) {
      setError("Please enter both Room ID and Username");
      return;
    }

    setLoading(true);
    setError("");
    setRoomClosed(false);
    socket.emit("join-room", {
      roomId: roomToJoin.trim().toUpperCase(),
      username: username.trim(),
    });
    setJoined(true);
    setRoomId(roomToJoin.trim().toUpperCase());
  };

  const handleStart = () => {
    console.log("🎯 handleStart called");
    console.log("Users length:", users.length);
    console.log("Room ID:", roomId);
    console.log("Socket connected:", socket.connected);
    console.log("Socket ID:", socket.id);

    if (users.length < 2) {
      setError("Need at least 2 players to start");
      return;
    }

    setLoading(true);
    setError("");

    console.log("🚀 Emitting start-selection event");
    socket.emit("start-selection", { roomId });

    // Add timeout to reset loading if no response
    setTimeout(() => {
      console.log("⏰ Timeout reached, checking if still loading");
      if (loading) {
        console.log("❌ Still loading, resetting...");
        setLoading(false);
        setError("Failed to start game. Please try again.");
      }
    }, 10000);
  };

  const handlePlayAgain = () => {
    if (isHost) {
      setLoading(true);
      socket.emit("play-again", { roomId });
    }
  };

  const handleExit = () => {
    if (isHost) {
      socket.emit("exit-room", { roomId });
      resetGame();
    }
  };

  const selectPlayer = (player) => {
    if (myTurn && !loading) {
      setLoading(true);
      socket.emit("select-player", { roomId, player: player.name });

      // Reset loading after a delay in case of no response
      setTimeout(() => {
        if (!results && !error) {
          setLoading(false);
        }
      }, 5000);
    }
  };

  const resetGame = () => {
    clearTimer();
    setJoined(false);
    setIsHost(false);
    setGameStarted(false);
    setUsers([]);
    setDisconnectedUsers([]);
    setTurnOrder([]);
    setCurrentTurn(null);
    setCurrentUserId(null);
    setPlayerPool([]);
    setSelections({});
    setMyTurn(false);
    setResults(null);
    setTimer(10);
    setError("");
    setLoading(false);
    setRoomId("");
    setUsername("");
    setRoomClosed(false);
    setIsReconnecting(false);
    setAutoSelectionMessage("");
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId).then(() => {
      showSuccessMessage("Room ID copied to clipboard! 📋");
    });
  };

  const getTimerClass = () => {
    if (timer <= 3) return 'critical';
    if (timer <= 5) return 'warning';
    return 'normal';
  };

  // Helper function to check if a user is disconnected
  const isUserDisconnected = (username) => {
    return disconnectedUsers.some(user => user.username === username);
  };

  if (roomClosed) {
    return (
      <div className="app">
        <div className="container">
          <div className="room-closed-card">
            <div className="icon">🚪</div>
            <h2>Room Closed</h2>
            <p>{error}</p>
            <button onClick={resetGame} className="btn-primary">
              Go Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="app">
        <div className="container">
          <div className="welcome-card">
            <div className="welcome-header">
              <h1>🏏 Cricket Team Selection</h1>
              <p>Create or join a room to start selecting your dream team!</p>
            </div>

            <div className="form-section">
              <div className="input-group">
                <label>Username</label>
                <input
                  type="text"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  className="form-input"
                />
              </div>

              <div className="input-group">
                <label>Room ID (Optional)</label>
                <input
                  type="text"
                  placeholder="Enter Room ID to join existing room"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  disabled={loading}
                  className="form-input"
                />
              </div>

              <div className="button-group">
                <button
                  onClick={() => handleJoin()}
                  disabled={loading || !roomId.trim() || !username.trim()}
                  className="btn-secondary"
                >
                  {loading ? (
                    <>
                      <div className="spinner"></div>
                      Joining...
                    </>
                  ) : (
                    <>
                      🚪 Join Room
                    </>
                  )}
                </button>

                <button
                  onClick={createRoom}
                  disabled={loading || !username.trim()}
                  className="btn-primary"
                >
                  {loading ? (
                    <>
                      <div className="spinner"></div>
                      Creating...
                    </>
                  ) : (
                    <>
                      ✨ Create Room
                    </>
                  )}
                </button>
              </div>

              {error && (
                <div className={`message ${error.includes('copied') || error.includes('reconnected') ? 'success' : 'error'}`}>
                  {error}
                </div>
              )}

              <div className="connection-status">
                <span className="status-label">Connection Status:</span>
                <span className={`status-indicator ${connectionStatus}`}>
                  {connectionStatus === 'connected' && '🟢 Connected'}
                  {connectionStatus === 'connecting' && '🟡 Connecting...'}
                  {connectionStatus === 'disconnected' && '🔴 Disconnected'}
                  {connectionStatus === 'error' && '❌ Connection Error'}
                </span>
                {isReconnecting && (
                  <span className="reconnecting">
                    <div className="spinner"></div>
                    Reconnecting...
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="container">
        <div className="room-header">
          <div className="room-info">
            <h1>Room: <span className="room-id">{roomId}</span></h1>
            <button onClick={copyRoomId} className="copy-btn">
              📋 Copy Room ID
            </button>
          </div>
          {isHost && (
            <div className="host-badge">
              <span>👑 Host</span>
            </div>
          )}
          {isReconnecting && (
            <div className="reconnecting-badge">
              <div className="spinner"></div>
              <span>Reconnecting...</span>
            </div>
          )}
        </div>

        {error && (
          <div className={`message ${error.includes('copied') || error.includes('reconnected') ? 'success' : 'error'}`}>
            {error}
          </div>
        )}

        {autoSelectionMessage && (
          <div className="message info">
            {autoSelectionMessage}
          </div>
        )}

        <div className="users-section">
          <div className="section-header">
            <h3>👥 Players ({users.length})</h3>
          </div>
          <div className="users-list">
            {users.map((user) => (
              <div key={user.id} className="user-item">
                <div className="user-avatar">
                  {user.username.charAt(0).toUpperCase()}
                </div>
                <span className="user-name">{user.username}</span>
                {user.id === users.find(u => u.id === roomId)?.hostId && (
                  <span className="host-indicator">👑</span>
                )}
                {user.id === socket.id && (
                  <span className="you-indicator">You</span>
                )}
              </div>
            ))}
          </div>

          {disconnectedUsers.length > 0 && (
            <div className="disconnected-section">
              <div className="section-header">
                <h4>🔴 Disconnected Players ({disconnectedUsers.length})</h4>
              </div>
              <div className="disconnected-list">
                {disconnectedUsers.map((user, index) => (
                  <div key={index} className="disconnected-user">
                    <div className="user-avatar disconnected">
                      {user.username.charAt(0).toUpperCase()}
                    </div>
                    <span className="user-name">{user.username}</span>
                    <span className="disconnected-indicator">
                      {gameStarted ? 'Playing (Auto)' : 'Disconnected'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {!gameStarted && !results && (
          <div className="pre-game">
            {isHost ? (
              <div className="host-controls">
                <div className="host-message">
                  <h3>🎮 Ready to Start?</h3>
                  <p>You are the host and can also play! Start the game when everyone is ready.</p>
                  {disconnectedUsers.length > 0 && (
                    <p className="warning">
                      ⚠️ Disconnected players will have their turns auto-selected
                    </p>
                  )}
                </div>
                <button
                  onClick={handleStart}
                  disabled={loading || users.length < 2}
                  className="btn-primary start-btn"
                >
                  {loading ? (
                    <>
                      <div className="spinner"></div>
                      Starting...
                    </>
                  ) : (
                    <>
                      🚀 Start Selection
                    </>
                  )}
                </button>
                {users.length < 2 && (
                  <p className="warning">⚠️ Need at least 2 players to start</p>
                )}
              </div>
            ) : (
              <div className="waiting">
                <div className="waiting-content">
                  <div className="waiting-icon">⏳</div>
                  <h3>Waiting for Host</h3>
                  <p>The host will start the game when everyone is ready...</p>
                  <div className="loading-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {gameStarted && !results && (
          <div className="game-section">
            <div className="game-info">
              {turnOrder.length > 0 && (
                <div className="turn-order-section">
                  <h3>📋 Turn Order</h3>
                  <div className="turn-order">
                    {turnOrder.map((username, index) => (
                      <div
                        key={index}
                        className={`turn-item ${username === currentTurn ? 'current' : ''} ${isUserDisconnected(username) ? 'disconnected' : ''}`}
                      >
                        <div className="turn-number">{index + 1}</div>
                        <span className="turn-username">{username}</span>
                        {username === currentTurn && <div className="current-indicator">⏰</div>}
                        {isUserDisconnected(username) && (
                          <div className="disconnected-indicator">🔴</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {currentTurn && (
                <div className="current-turn-section">
                  <div className="turn-header">
                    <h3>
                      {myTurn ? "🎯 Your Turn!" :
                        isUserDisconnected(currentTurn) ?
                          `${currentTurn}'s Turn (Auto-selecting...)` :
                          `${currentTurn}'s Turn`}
                    </h3>
                    {timer > 0 && !isUserDisconnected(currentTurn) && (
                      <div className="timer-container">
                        <div className={`timer ${getTimerClass()}`}>
                          <div className="timer-circle">
                            <span className="countdown">{timer}</span>
                          </div>
                          <span className="timer-label">seconds left</span>
                        </div>
                      </div>
                    )}
                    {isUserDisconnected(currentTurn) && (
                      <div className="auto-selection-notice">
                        <span>🤖 Auto-selecting for disconnected player...</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {myTurn && playerPool.length > 0 && (
              <div className="player-selection">
                <div className="selection-header">
                  <h3>⚡ Select Your Player</h3>
                  <p>Choose wisely! You have {timer} seconds.</p>
                </div>
                <div className="player-pool">
                  {playerPool.map((player, index) => (
                    <div
                      key={index}
                      className={`player-card ${loading ? 'disabled' : ''}`}
                      onClick={() => selectPlayer(player)}
                    >
                      <div className="player-image-container">
                        <img
                          src={player.image}
                          alt={player.name}
                          className="player-image"
                          onError={(e) => {
                            e.target.src = 'https://via.placeholder.com/120x140/4F46E5/FFFFFF?text=' + player.name.split(' ').map(n => n[0]).join('');
                          }}
                        />
                        <div className="player-role-badge">{player.role}</div>
                      </div>
                      <div className="player-info">
                        <div className="player-name">{player.name}</div>
                      </div>
                      {loading && <div className="card-loading"><div className="spinner"></div></div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!myTurn && (
              <div className="spectator-view">
                <div className="spectator-content">
                  <h3>👀 Game in Progress</h3>
                  <p>
                    {isUserDisconnected(currentTurn) ?
                      `Auto-selecting for disconnected player ${currentTurn}...` :
                      `Waiting for ${currentTurn} to make their selection...`
                    }
                  </p>

                  <div className="available-players-section">
                    <h4>Available Players ({playerPool.length})</h4>
                    <div className="available-players">
                      {playerPool.slice(0, 12).map((player, index) => (
                        <div key={index} className="mini-player-card">
                          <img
                            src={player.image}
                            alt={player.name}
                            className="mini-player-image"
                            onError={(e) => {
                              e.target.src = 'https://via.placeholder.com/60x70/6B7280/FFFFFF?text=' + player.name.split(' ').map(n => n[0]).join('');
                            }}
                          />
                          <div className="mini-player-info">
                            <div className="mini-player-name">{player.name}</div>
                            <div className="mini-player-role">{player.role}</div>
                          </div>
                        </div>
                      ))}
                      {playerPool.length > 12 && (
                        <div className="more-players">
                          <span>+{playerPool.length - 12}</span>
                          <span>more players</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {Object.keys(selections).length > 0 && (
              <div className="selections-display">
                <h3>🏆 Current Selections</h3>
                <div className="selections-grid">
                  {Object.entries(selections).map(([username, playerList]) => (
                    <div key={username} className="user-selection">
                      <div className="selection-header">
                        <h4>
                          {username}
                          {isUserDisconnected(username) && (
                            <span className="disconnected-badge">🔴 Auto</span>
                          )}
                        </h4>
                        <span className="selection-count">
                          {playerList.length}/5
                        </span>
                      </div>
                      <div className="selected-players">
                        {playerList.map((player, index) => (
                          <div key={index} className="selected-player">
                            <img
                              src={player.image}
                              alt={player.name}
                              className="selected-player-image"
                              onError={(e) => {
                                e.target.src = 'https://via.placeholder.com/50x60/10B981/FFFFFF?text=' + player.name.split(' ').map(n => n[0]).join('');
                              }}
                            />
                            <div className="selected-player-info">
                              <div className="selected-player-name">{player.name}</div>
                              <div className="selected-player-role">{player.role}</div>
                            </div>
                          </div>
                        ))}
                        {/* Empty slots */}
                        {Array.from({ length: 5 - playerList.length }).map((_, index) => (
                          <div key={`empty-${index}`} className="empty-slot">
                            <div className="empty-icon">?</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {loading && (
              <div className="loading-overlay">
                <div className="loading-content">
                  <div className="spinner large"></div>
                  <p>Processing your selection...</p>
                </div>
              </div>
            )}
          </div>
        )}

        {results && (
          <div className="results-section">
            <div className="results-header">
              <h2>🏆 Final Teams</h2>
              <p>Here are the complete teams selected by all players!</p>
            </div>

            <div className="results-grid">
              {Object.entries(results).map(([username, team]) => (
                <div key={username} className="team-result">
                  <div className="team-header">
                    <h3>{username}'s Team</h3>
                    <div className="team-badge">Complete</div>
                  </div>
                  <div className="final-team">
                    {team.map((player, index) => (
                      <div key={index} className="final-player">
                        <div className="final-player-image-container">
                          <img
                            src={player.image}
                            alt={player.name}
                            className="final-player-image"
                            onError={(e) => {
                              e.target.src = 'https://via.placeholder.com/80x95/F59E0B/FFFFFF?text=' + player.name.split(' ').map(n => n[0]).join('');
                            }}
                          />
                          <div className="player-number">{index + 1}</div>
                        </div>
                        <div className="final-player-info">
                          <div className="final-player-name">{player.name}</div>
                          <div className="final-player-role">{player.role}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="end-game-controls">
              {isHost ? (
                <div className="host-end-controls">
                  <h4>What's next?</h4>
                  <div className="button-group">
                    <button
                      onClick={handlePlayAgain}
                      disabled={loading}
                      className="btn-primary"
                    >
                      {loading ? (
                        <>
                          <div className="spinner"></div>
                          Starting...
                        </>
                      ) : (
                        <>
                          🔄 Play Again
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleExit}
                      className="btn-danger"
                    >
                      🚪 Close Room
                    </button>
                  </div>
                </div>
              ) : (
                <div className="player-end-view">
                  <div className="waiting-content">
                    <div className="waiting-icon">⏳</div>
                    <h4>Waiting for Host</h4>
                    <p>The host will decide whether to play again or close the room...</p>
                    <div className="loading-dots">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;