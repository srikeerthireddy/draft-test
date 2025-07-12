require('dotenv').config()
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const setupSocket = require('./socketHandler');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin:"http://localhost:8000",
    methods: ['GET', 'POST'],
    credentials: true
  },
});

// app.use(cors({
//   origin: process.env.FRONTEND_URL || "http://localhost:8000",
//   methods: ['GET', 'POST'],
//   credentials: true
// }));
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8000;
const rooms = {};

// Initialize socket handling
setupSocket(io, rooms);

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    message: '✅ Real-time Cricket Team Selection Backend Running',
    activeRooms: Object.keys(rooms).length,
    timestamp: new Date().toISOString()
  });
});

// Create room endpoint
app.post('/api/create-room', (req, res) => {
  const roomId = generateRoomId();
  rooms[roomId] = {
    hostId: null,
    users: [],
    selections: {},
    turnOrder: [],
    currentTurnIndex: 0,
    started: false,
    pool: generatePlayerPool(), // This now uses the correct function
    timer: null,
    createdAt: new Date().toISOString(),
    disconnectedUsers: [] // Initialize disconnected users array
  };
  
  console.log(`Room ${roomId} created with ${rooms[roomId].pool.length} players`);
  res.json({ roomId, message: 'Room created successfully' });
});

// Get room info endpoint
app.get('/api/room/:roomId', (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
 
  res.json({
    roomId: req.params.roomId,
    userCount: room.users.length,
    users: room.users.map(u => ({ username: u.username })), // Don't expose socket IDs
    started: room.started,
    poolSize: room.pool.length,
    createdAt: room.createdAt
  });
});

// Get all active rooms endpoint
app.get('/api/rooms', (req, res) => {
  const roomList = Object.keys(rooms).map(roomId => ({
    roomId,
    userCount: rooms[roomId].users.length,
    started: rooms[roomId].started,
    createdAt: rooms[roomId].createdAt
  }));
  
  res.json({ rooms: roomList, total: roomList.length });
});

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Use the same generatePlayerPool function as in socketHandler.js
function generatePlayerPool() {
  return [
    {
      name: 'Virat Kohli',
      role: 'Batsman',
      image: 'https://upload.wikimedia.org/wikipedia/commons/9/9b/Virat_Kohli_in_PMO_New_Delhi.jpg'
    },
    {
      name: 'Rohit Sharma',
      role: 'Batsman',
      image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSoVuOX9HV9kcrTird7QDU9Zul_7164R4_XBQ&s'
    },
    {
      name: 'MS Dhoni',
      role: 'Wicket-keeper',
      image: 'https://cdn.britannica.com/25/222725-050-170F622A/Indian-cricketer-Mahendra-Singh-Dhoni-2011.jpg'
    },
    {
      name: 'Jasprit Bumrah',
      role: 'Bowler',
      image: 'https://upload.wikimedia.org/wikipedia/commons/0/02/Jasprit_Bumrah_in_PMO_New_Delhi.jpg'
    },
    {
      name: 'Ravindra Jadeja',
      role: 'All-rounder',
      image: 'https://upload.wikimedia.org/wikipedia/commons/2/2c/PM_Shri_Narendra_Modi_with_Ravindra_Jadeja_%28Cropped%29.jpg'
    },
    {
      name: 'Shubman Gill',
      role: 'Batsman',
      image: 'https://documents.iplt20.com/ipl/IPLHeadshot2025/62.png'
    },
    {
      name: 'KL Rahul',
      role: 'Wicket-keeper',
      image: 'https://documents.bcci.tv/resizedimageskirti/1125_compress.png'
    },
    {
      name: 'Hardik Pandya',
      role: 'All-rounder',
      image: 'https://upload.wikimedia.org/wikipedia/commons/f/fc/Hardik_Pandya_in_PMO_New_Delhi.jpg'
    },
    {
      name: 'Ravichandran Ashwin',
      role: 'Bowler',
      image: 'https://i2.wp.com/crictoday.com/wp-content/uploads/2023/03/316521.webp?ssl=1'
    },
    {
      name: 'Suryakumar Yadav',
      role: 'Batsman',
      image: 'https://upload.wikimedia.org/wikipedia/commons/b/b7/Suryakumar_Yadav_in_PMO_New_Delhi.jpg'
    },
    {
      name: 'Mohammed Shami',
      role: 'Bowler',
      image: 'https://www.gujarattitansipl.com/static-assets/images/players/28994.png?v=5.55'
    },
    {
      name: 'Shreyas Iyer',
      role: 'Batsman',
      image: 'https://documents.bcci.tv/resizedimageskirti/1563_compress.png'
    },
    {
      name: 'Rishabh Pant',
      role: 'Wicket-keeper',
      image: 'https://media.gettyimages.com/id/2155145413/photo/new-york-new-york-rishabh-pant-of-india-poses-for-a-portrait-prior-to-the-icc-mens-t20.jpg?s=612x612&w=gi&k=20&c=I8p09aXSvPR_FK-zO9PPakfibNsDh8VJFqOuwgeKG0A='
    },
    {
      name: 'Yuzvendra Chahal',
      role: 'Bowler',
      image: 'https://media.gettyimages.com/id/2155703340/photo/new-york-new-york-yuzendra-chahal-of-india-poses-for-a-portrait-prior-to-the-icc-mens-t20.jpg?s=612x612&w=gi&k=20&c=SHJi9nPilxkpbl5t4zg103hZCFta17DfrCDgvQOwSOs='
    },
    {
      name: 'Bhuvneshwar Kumar',
      role: 'Bowler',
      image: 'https://i.pinimg.com/474x/a9/6d/0b/a96d0bbd8cb438403105ee8aaf840cfb.jpg'
    },
    {
      name: 'Axar Patel',
      role: 'All-rounder',
      image: 'https://upload.wikimedia.org/wikipedia/commons/a/ad/Axar_Patel_in_PMO_New_Delhi.jpg'
    },
    {
      name: 'Ishan Kishan',
      role: 'Wicket-keeper',
      image: 'https://documents.bcci.tv/resizedimageskirti/31_compress.png'
    },
    {
      name: 'Washington Sundar',
      role: 'All-rounder',
      image: 'https://static-files.cricket-australia.pulselive.com/headshots/440/10947-camedia.png'
    },
    {
      name: 'Kuldeep Yadav',
      role: 'Bowler',
      image: 'https://media.gettyimages.com/id/1713187439/photo/thiruvananthapuram-india-kuldeep-yadav-of-india-poses-for-a-portrait-ahead-of-the-icc-mens.jpg?s=612x612&w=gi&k=20&c=ztPCSdNAW_VLjXdpNzl4pBdKzuFp0w67swgy2Am-LZg='
    },
    {
      name: 'Deepak Chahar',
      role: 'Bowler',
      image: 'https://documents.iplt20.com/ipl/IPLHeadshot2025/91.png'
    },
    {
      name: 'Prithvi Shaw',
      role: 'Batsman',
      image: 'https://documents.iplt20.com/ipl/IPLHeadshot2024/51.png'
    },
    {
      name: 'Sanju Samson',
      role: 'Wicket-keeper',
      image: 'https://indiananchors.in/wp-content/uploads/2025/01/Sanju-samson.png'
    },
    {
      name: 'Umran Malik',
      role: 'Bowler',
      image: 'https://www.hindustantimes.com/static-content/1y/cricket-logos/players/umran-malik.png'
    },
    {
      name: 'Arshdeep Singh',
      role: 'Bowler',
      image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR3k_b9rdRgfm7MwregvYkkuIa7H0NMjSY9UQ&s'
    },
    {
      name: 'Tilak Varma',
      role: 'Batsman',
      image: 'https://www.mumbaiindians.com/static-assets/waf-images/14/fe/b4/16-9/1920-1080/aRWZYjG3Hb.png'
    },
    {
      name: 'Mohammed Siraj',
      role: 'Bowler',
      image: 'https://documents.bcci.tv/resizedimageskirti/3840_compress.png'
    },
    {
      name: 'Shardul Thakur',
      role: 'All-rounder',
      image: 'https://d1k8sn41pix00a.cloudfront.net/media/players/photos/shardul_thakur.webp'
    },
    {
      name: 'Dinesh Karthik',
      role: 'Wicket-keeper',
      image: 'https://static-files.cricket-australia.pulselive.com/headshots/440/10910-camedia.png'
    },
    {
      name: 'Deepak Hooda',
      role: 'All-rounder',
      image: 'https://cinetown.s3.ap-south-1.amazonaws.com/people/profile_img/1714157747.png'
    },
    {
      name: 'Ruturaj Gaikwad',
      role: 'Batsman',
      image: 'https://th.bing.com/th/id/R.c3a5f2a3df874ccbc6e2f2ee01944c66?rik=tCrAKGyIirvqKw&riu=http%3a%2f%2finstitute.careerguide.com%2fwp-content%2fuploads%2f2024%2f04%2fRuturaj-Gaikwad.png&ehk=A01ASVCX9%2bqkCdgWDKCOezcAOddxKAjVIWi91B4iGg0%3d&risl=&pid=ImgRaw&r=0'
    }
  ];
}

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`🎯 Socket.IO ready for connections`);
});