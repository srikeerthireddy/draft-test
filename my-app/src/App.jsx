import React, { useEffect, useState } from "react";
import * as Ably from "ably";
import axios from "axios";

const App = () => {
  // Connection state
  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("");
  const [inRoom, setInRoom] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [clientId, setClientId] = useState("");
  const [ably, setAbly] = useState(null);
  const [channel, setChannel] = useState(null);
  const [ablyConnectionStatus, setAblyConnectionStatus] = useState("disconnected");
  const [ablyConnectionDetails, setAblyConnectionDetails] = useState({});

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

  // Add state for chunk assembly
  const [poolChunks, setPoolChunks] = useState([]);
  const [poolTotalChunks, setPoolTotalChunks] = useState(0);
  const [selectionsChunks, setSelectionsChunks] = useState([]);
  const [selectionsTotalChunks, setSelectionsTotalChunks] = useState(0);

  // Add state for chunked draft started
  const [draftStartedPoolChunks, setDraftStartedPoolChunks] = useState([]);
  const [draftStartedPoolTotalChunks, setDraftStartedPoolTotalChunks] = useState(0);
  const [draftStartedMeta, setDraftStartedMeta] = useState(null);

  // Add state for chunked player-selected
  const [playerSelectedPoolChunks, setPlayerSelectedPoolChunks] = useState([]);
  const [playerSelectedPoolTotalChunks, setPlayerSelectedPoolTotalChunks] = useState(0);
  const [playerSelectedSelectionsChunks, setPlayerSelectedSelectionsChunks] = useState([]);
  const [playerSelectedSelectionsTotalChunks, setPlayerSelectedSelectionsTotalChunks] = useState(0);
  const [playerSelectedMeta, setPlayerSelectedMeta] = useState(null);

  // Assemble pool when all chunks are received
  useEffect(() => {
    if (poolChunks.length && poolChunks.filter(Boolean).length === poolTotalChunks && poolTotalChunks > 0) {
      setPool(poolChunks.flat());
      setPoolChunks([]);
      setPoolTotalChunks(0);
    }
  }, [poolChunks, poolTotalChunks]);
  // Assemble selections when all chunks are received
  useEffect(() => {
    if (selectionsChunks.length && selectionsChunks.filter(Boolean).length === selectionsTotalChunks && selectionsTotalChunks > 0) {
      const allEntries = selectionsChunks.flat();
      setSelections(Object.fromEntries(allEntries));
      setSelectionsChunks([]);
      setSelectionsTotalChunks(0);
    }
  }, [selectionsChunks, selectionsTotalChunks]);

  // Assemble draft started pool and update state
  useEffect(() => {
    if (
      draftStartedPoolChunks.length &&
      draftStartedPoolChunks.filter(Boolean).length === draftStartedPoolTotalChunks &&
      draftStartedPoolTotalChunks > 0 &&
      draftStartedMeta
    ) {
      setPool(draftStartedPoolChunks.flat());
      setTurnOrder(draftStartedMeta.turnOrder);
      setCurrentPhase(draftStartedMeta.selectionPhase);
      setGameStarted(true);
      setTurn(draftStartedMeta.currentUser);
      setIsMyTurn(draftStartedMeta.currentUser === username);
      setDraftStartedPoolChunks([]);
      setDraftStartedPoolTotalChunks(0);
      setDraftStartedMeta(null);
    }
  }, [draftStartedPoolChunks, draftStartedPoolTotalChunks, draftStartedMeta, username]);

  // Assemble player-selected pool and selections and update state
  useEffect(() => {
    if (
      playerSelectedPoolChunks.length &&
      playerSelectedPoolChunks.filter(Boolean).length === playerSelectedPoolTotalChunks &&
      playerSelectedPoolTotalChunks > 0 &&
      playerSelectedSelectionsChunks.length &&
      playerSelectedSelectionsChunks.filter(Boolean).length === playerSelectedSelectionsTotalChunks &&
      playerSelectedSelectionsTotalChunks > 0 &&
      playerSelectedMeta
    ) {
      setPool(playerSelectedPoolChunks.flat());
      const allEntries = playerSelectedSelectionsChunks.flat();
      setSelections(Object.fromEntries(allEntries));
      setSuccess(`${playerSelectedMeta.selectedBy} selected ${playerSelectedMeta.player.Name}`);
      setPlayerSelectedPoolChunks([]);
      setPlayerSelectedPoolTotalChunks(0);
      setPlayerSelectedSelectionsChunks([]);
      setPlayerSelectedSelectionsTotalChunks(0);
      setPlayerSelectedMeta(null);
    }
  }, [playerSelectedPoolChunks, playerSelectedPoolTotalChunks, playerSelectedSelectionsChunks, playerSelectedSelectionsTotalChunks, playerSelectedMeta]);

  // Initialize Ably connection
  useEffect(() => {
    const initAbly = async () => {
      try {
        // Generate a unique client ID
        const newClientId = `client_${Math.random().toString(36).substring(2, 15)}`;
        setClientId(newClientId);

        // Initialize Ably with token callback
        const ablyInstance = new Ably.Realtime({
          authCallback: async (tokenParams, callback) => {
            try {
              const response = await axios.post('http://localhost:8000/api/ably-token', {
                clientId: newClientId
              });
              callback(null, response.data);
            } catch (err) {
              callback(err);
            }
          }
        });

        setAbly(ablyInstance);

        // Handle connection events with detailed status
        ablyInstance.connection.on('connected', () => {
          console.log('🔗 Connected to Ably');
          setAblyConnectionStatus('connected');
          setAblyConnectionDetails({
            connectionId: ablyInstance.connection.id,
            clientId: ablyInstance.auth.clientId,
            timestamp: new Date().toISOString()
          });
        });

        ablyInstance.connection.on('disconnected', () => {
          console.log('🔌 Disconnected from Ably');
          setAblyConnectionStatus('disconnected');
        });

        ablyInstance.connection.on('failed', (err) => {
          console.error('❌ Ably connection failed:', err);
          setAblyConnectionStatus('failed');
          setAblyConnectionDetails({ error: err.message });
          setError('Connection failed. Please refresh the page.');
        });

        ablyInstance.connection.on('connecting', () => {
          console.log('🔄 Connecting to Ably...');
          setAblyConnectionStatus('connecting');
        });

        ablyInstance.connection.on('suspended', () => {
          console.log('⏸️ Ably connection suspended');
          setAblyConnectionStatus('suspended');
        });

        ablyInstance.connection.on('closed', () => {
          console.log('🔒 Ably connection closed');
          setAblyConnectionStatus('closed');
        });

      } catch (error) {
        console.error('Error initializing Ably:', error);
        setError('Failed to connect to server');
      }
    };

    initAbly();

    // Cleanup on unmount
    return () => {
      if (ably) {
        ably.close();
      }
    };
  }, []);

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
  const joinRoom = async () => {
    if (!username.trim() || !roomId.trim()) {
      setError("Please enter both username and room ID");
      return;
    }

    if (!ably || !clientId) {
      setError("Connection not ready. Please wait...");
      return;
    }

    try {
      console.log("🔗 Joining room:", roomId.trim(), "as", username.trim());
      
      const response = await axios.post('http://localhost:8000/api/join-room', {
        roomId: roomId.trim(),
        username: username.trim(),
        clientId: clientId
      });

      if (response.data.error) {
        setError(response.data.error);
        return;
      }

      if (response.data.status === 'generating_pool') {
        setSuccess("Generating player pool... Please wait.");
        // Poll for room readiness
        setTimeout(() => joinRoom(), 2000);
        return;
      }

      // Subscribe to room channel
      const roomChannel = ably.channels.get(`draft-room-${roomId.trim()}`);
      setChannel(roomChannel);

      // Subscribe to channel events
      roomChannel.subscribe('room-users', (message) => {
        console.log("👥 Room users updated:", message.data);
        setUsers(message.data);
      });

      roomChannel.subscribe('disconnected-users', (message) => {
        console.log("💔 Disconnected users:", message.data);
        setDisconnectedUsers(message.data);
      });

      roomChannel.subscribe('host-status', (message) => {
        console.log("👑 Host status:", message.data);
        const { isHost, started, clientId: hostClientId } = message.data;
        if (clientId === hostClientId) {
          setIsHost(isHost);
          setGameStarted(started);
        }
      });

      // Subscribe to chunked pool
      roomChannel.subscribe('game-state-pool', (message) => {
        const { chunk, chunkIndex, totalChunks } = message.data;
        setPoolChunks(prev => {
          const next = [...prev];
          next[chunkIndex] = chunk;
          return next;
        });
        setPoolTotalChunks(totalChunks);
      });
      // Subscribe to chunked selections
      roomChannel.subscribe('game-state-selections', (message) => {
        const { chunk, chunkIndex, totalChunks } = message.data;
        setSelectionsChunks(prev => {
          const next = [...prev];
          next[chunkIndex] = chunk;
          return next;
        });
        setSelectionsTotalChunks(totalChunks);
      });
      // Subscribe to meta info
      roomChannel.subscribe('game-state-meta', (message) => {
        const { started, selectionPhase, turnOrder, currentTurnIndex, preferredQueue, maxMainPlayers, maxBenchPlayers, clientId: stateClientId } = message.data;
        if (typeof started === "boolean") setGameStarted(started);
        if (selectionPhase) setCurrentPhase(selectionPhase);
        if (turnOrder) setTurnOrder(turnOrder);
        if (preferredQueue && clientId === stateClientId) setPreferred(Array.isArray(preferredQueue) ? preferredQueue : []);
        setPreferredQueue(preferredQueue);
        if (turnOrder && typeof currentTurnIndex === "number") {
          const currentTurnUser = turnOrder[currentTurnIndex];
          setTurn(currentTurnUser);
          setIsMyTurn(currentTurnUser === username);
        }
      });

      roomChannel.subscribe('draft-started-pool', (message) => {
        const { chunk, chunkIndex, totalChunks } = message.data;
        setDraftStartedPoolChunks(prev => {
          const next = [...prev];
          next[chunkIndex] = chunk;
          return next;
        });
        setDraftStartedPoolTotalChunks(totalChunks);
      });
      roomChannel.subscribe('draft-started-meta', (message) => {
        setDraftStartedMeta(message.data);
      });

      roomChannel.subscribe('turn-started', (message) => {
        console.log("🎯 Turn started:", message.data);
        const { currentUser, timeLeft, userId } = message.data;
        setTurn(currentUser);
        setIsMyTurn(userId === clientId);
        setTurnTimer(timeLeft);
      });

      roomChannel.subscribe('player-selected-pool', (message) => {
        const { chunk, chunkIndex, totalChunks } = message.data;
        setPlayerSelectedPoolChunks(prev => {
          const next = [...prev];
          next[chunkIndex] = chunk;
          return next;
        });
        setPlayerSelectedPoolTotalChunks(totalChunks);
      });
      roomChannel.subscribe('player-selected-selections', (message) => {
        const { chunk, chunkIndex, totalChunks } = message.data;
        setPlayerSelectedSelectionsChunks(prev => {
          const next = [...prev];
          next[chunkIndex] = chunk;
          return next;
        });
        setPlayerSelectedSelectionsTotalChunks(totalChunks);
      });
      roomChannel.subscribe('player-selected-meta', (message) => {
        setPlayerSelectedMeta(message.data);
      });

      roomChannel.subscribe('draft-completed', (message) => {
        console.log("🏁 Draft completed:", message.data);
        setSuccess("Draft completed! Check final selections.");
      });

      roomChannel.subscribe('preferred-players-updated', (message) => {
        console.log("📝 Preferences updated:", message.data);
        const { message: updateMessage } = message.data;
        setSuccess(updateMessage);
      });

      setInRoom(true);
      setSuccess("Successfully joined room!");

    } catch (error) {
      console.error('Error joining room:', error);
      setError("Error joining room: " + (error.response?.data?.error || error.message));
    }
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
  const setPreferredPlayers = async () => {
    if (preferred.length === 0) {
      setError("Please select at least one preferred player");
      return;
    }

    if (!clientId || !roomId) {
      setError("Not connected to room");
      return;
    }

    try {
      console.log("📤 Sending preferred players:", preferred);
      const response = await axios.post('http://localhost:8000/api/set-preferred-players', {
        roomId,
        clientId,
        preferredPlayers: preferred,
      });

      if (response.data.error) {
        setError(response.data.error);
        return;
      }

      setPreferencesSubmitted(true);
      setSuccess("Preferences submitted successfully!");
    } catch (error) {
      setError("Error setting preferences: " + (error.response?.data?.error || error.message));
    }
  };

  // Check if all players have submitted preferences
  const allPreferencesSubmitted = users.length > 0 && users.every(user => user.preferencesSubmitted);

  // Select a player during draft
  const selectPlayer = async (playerID) => {
    if (!isMyTurn) {
      setError("It's not your turn!");
      return;
    }

    if (!clientId || !roomId) {
      setError("Not connected to room");
      return;
    }

    try {
      console.log("🎯 Selecting player:", playerID);
      // Debug log for POST body
      console.log({ roomId, clientId, playerID });
      const response = await axios.post('http://localhost:8000/api/select-player', {
        roomId,
        clientId,
        playerID
      });

      if (response.data.error) {
        setError(response.data.error);
        return;
      }

      setSuccess("Player selected successfully!");
    } catch (error) {
      setError("Error selecting player: " + (error.response?.data?.error || error.message));
    }
  };

  // Start the draft (host only)
  const startDraft = async () => {
    console.log("🚀 Start Draft clicked");

    if (!isHost) {
      setError("Only host can start the draft");
      return;
    }

    if (!allPreferencesSubmitted) {
      setError("All players must submit their preferences first");
      return;
    }

    if (!clientId || !roomId) {
      setError("Not connected to room");
      return;
    }

    try {
      console.log("🚀 Starting draft for room:", roomId);
      const response = await axios.post('http://localhost:8000/api/start-draft', {
        roomId,
        clientId
      });

      if (response.data.error) {
        setError(response.data.error);
        return;
      }

      setSuccess("Draft started successfully!");
    } catch (error) {
      setError("Error starting draft: " + (error.response?.data?.error || error.message));
    }
  };

  // Toggle player in preferred list
  const togglePreferred = (playerID) => {
    if (preferred.includes(playerID)) {
      setPreferred(preferred.filter((id) => id !== playerID));
    } else {
      setPreferred([...preferred, playerID]);
    }
  };

  // Test Ably connection
  const testAblyConnection = async () => {
    try {
      const response = await axios.get('http://localhost:8000/api/ably-test');
      if (response.data.status === 'success') {
        setSuccess('Ably connection test successful!');
        console.log('Ably test response:', response.data);
      } else {
        setError('Ably connection test failed');
      }
    } catch (error) {
      setError('Ably connection test failed: ' + (error.response?.data?.error || error.message));
    }
  };

  // Get Ably status
  const getAblyStatus = async () => {
    try {
      const response = await axios.get('http://localhost:8000/api/ably-status');
      console.log('Ably status:', response.data);
      setSuccess('Ably status: ' + response.data.message);
    } catch (error) {
      setError('Failed to get Ably status: ' + (error.response?.data?.error || error.message));
    }
  };

  // Handle disconnect
  useEffect(() => {
    const handleBeforeUnload = async () => {
      if (clientId && roomId) {
        try {
          await axios.post('http://localhost:8000/api/disconnect', {
            roomId,
            clientId
          });
        } catch (error) {
          console.error('Error disconnecting:', error);
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [clientId, roomId]);

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

        {/* Ably Connection Status */}
        <div style={{ 
          marginBottom: "1rem", 
          padding: "0.5rem", 
          borderRadius: "4px",
          backgroundColor: 
            ablyConnectionStatus === 'connected' ? '#e8f5e8' :
            ablyConnectionStatus === 'connecting' ? '#fff3cd' :
            ablyConnectionStatus === 'failed' ? '#ffebee' :
            ablyConnectionStatus === 'suspended' ? '#fff3cd' :
            '#f5f5f5',
          border: `1px solid ${
            ablyConnectionStatus === 'connected' ? '#4caf50' :
            ablyConnectionStatus === 'connecting' ? '#ff9800' :
            ablyConnectionStatus === 'failed' ? '#f44336' :
            ablyConnectionStatus === 'suspended' ? '#ff9800' :
            '#ccc'
          }`
        }}>
          <strong>Ably Connection:</strong> 
          <span style={{ 
            color: 
              ablyConnectionStatus === 'connected' ? '#2e7d32' :
              ablyConnectionStatus === 'connecting' ? '#f57c00' :
              ablyConnectionStatus === 'failed' ? '#c62828' :
              ablyConnectionStatus === 'suspended' ? '#f57c00' :
              '#666'
          }}>
            {ablyConnectionStatus === 'connected' && '🟢 Connected'}
            {ablyConnectionStatus === 'connecting' && '🟡 Connecting...'}
            {ablyConnectionStatus === 'disconnected' && '🔴 Disconnected'}
            {ablyConnectionStatus === 'failed' && '🔴 Failed'}
            {ablyConnectionStatus === 'suspended' && '🟡 Suspended'}
            {ablyConnectionStatus === 'closed' && '🔴 Closed'}
          </span>
          {ablyConnectionDetails.connectionId && (
            <span style={{ marginLeft: "1rem", fontSize: "0.9em", color: "#666" }}>
              ID: {ablyConnectionDetails.connectionId}
            </span>
          )}
          {ablyConnectionDetails.clientId && (
            <span style={{ marginLeft: "1rem", fontSize: "0.9em", color: "#666" }}>
              Client: {ablyConnectionDetails.clientId}
            </span>
          )}
          <div style={{ marginTop: "0.5rem" }}>
            <button
              onClick={testAblyConnection}
              style={{
                padding: "0.25rem 0.5rem",
                marginRight: "0.5rem",
                backgroundColor: "#2196f3",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.8em"
              }}
            >
              🧪 Test Connection
            </button>
            <button
              onClick={getAblyStatus}
              style={{
                padding: "0.25rem 0.5rem",
                backgroundColor: "#4caf50",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.8em"
              }}
            >
              📊 Get Status
            </button>
          </div>
        </div>

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
        <div id="preferences-section" style={{ marginBottom: '2rem' }}>
          <h3>⭐ Set Your Preferences ({preferred.length})</h3>
          <p>Select as many players as you like in order of preference</p>
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
                    const isDisabled = false;
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
              <h4>Your Preferences ({preferred.length}):</h4>
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
              disabled={preferred.length === 0}
              style={{
                padding: "0.75rem 1.5rem",
                backgroundColor: preferred.length > 0 ? "#4caf50" : "#ccc",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: preferred.length > 0 ? "pointer" : "not-allowed",
                fontSize: "1rem",
              }}
            >
              💡 Submit Preferences ({preferred.length})
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
        <div id="selection-section" style={{ marginBottom: "2rem" }}>
          <h3>Player Selection</h3>
          {pool.length === 0 ? (
            <div style={{ backgroundColor: '#fff3cd', padding: '1rem', borderRadius: '4px' }}>
              <p>No players available. Please check your backend player pool.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #ccc' }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #ccc' }}>Position</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #ccc' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {pool.map(player => (
                  <tr key={player.PlayerID}>
                    <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>{player.Name}</td>
                    <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>{player.Position}</td>
                    <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

      {/* Show each user's team */}
      {Object.entries(selections).map(([user, team]) => (
        <div key={user}>
          <h4>{user}'s Team</h4>
          <ul>
            {team.map(player => (
              <li key={player.PlayerID}>{player.Name} - {player.Position}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default App;