const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// This will store our room data in memory
const rooms = {};

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
  // HOST: When a host creates a room
  socket.on('host:create', () => {
    // Generate a simple 4-digit room code
    const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    rooms[roomCode] = {
      host: socket.id,
      players: [],
      buzzerLocked: false,
      buzzes: []
    };
    socket.join(roomCode);
    console.log(`Room created: ${roomCode} by host ${socket.id}`);
    socket.emit('server:roomCreated', roomCode);
  });

  // PLAYER: When a player tries to join a room
  socket.on('player:join', (roomCode, playerName) => {
    if (rooms[roomCode]) {
      rooms[roomCode].players.push({ id: socket.id, name: playerName });
      socket.join(roomCode);
      console.log(`Player ${playerName} joined room ${roomCode}`);
      socket.emit('server:joined', roomCode);
      // Tell the host a new player has joined
      io.to(rooms[roomCode].host).emit('server:playerJoined', rooms[roomCode].players);
    } else {
      socket.emit('server:error', 'Room does not exist.');
    }
  });

  // PLAYER: When a player hits the buzzer
  socket.on('player:buzz', (roomCode, playerName) => {
    if (rooms[roomCode] && !rooms[roomCode].buzzerLocked) {
      rooms[roomCode].buzzerLocked = true; // Lock the buzzer
      const buzz = { name: playerName, time: new Date() };
      rooms[roomCode].buzzes.push(buzz);
      console.log(`Buzz in room ${roomCode} by ${playerName}`);
      // Send the buzz info to the host ONLY
      io.to(rooms[roomCode].host).emit('server:buzz', buzz);
    }
  });

  // HOST: When the host resets the buzzer
  socket.on('host:reset', (roomCode) => {
    if (rooms[roomCode] && rooms[roomCode].host === socket.id) {
      rooms[roomCode].buzzerLocked = false;
      rooms[roomCode].buzzes = []; // Clear the buzz log
      console.log(`Buzzer reset in room ${roomCode}`);
      // Tell everyone in the room (players) that the buzzer is reset
      io.to(roomCode).emit('server:reset');
    }
  });

  socket.on('disconnect', () => {
    // This is more complex, so we'll leave it simple for now
    console.log('user disconnected');
  });
});

server.listen(3000, () => {
  console.log('listening on *:3000');
});
