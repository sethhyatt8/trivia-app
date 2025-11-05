const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const fs = require('fs'); // We need this to read our content file

// --- Content set discovery + loader ---
function loadContentFile(filename) {
    const raw = fs.readFileSync(filename);
    const str = raw.toString('utf8').replace(/^\uFEFF/, ''); // strip BOM if present
    return JSON.parse(str);
}
const availableSets = fs.readdirSync(__dirname).filter(f => /^content.*\.json$/i.test(f));
const defaultSet = availableSets[0] || null;
let defaultContent = null;
if (defaultSet) {
    try { defaultContent = loadContentFile(defaultSet); } catch(e) { console.error('Failed to load default content', defaultSet, e); }
}
// --- In-Memory Room Storage ---
const rooms = {};

// --- Server Setup ---
app.use(express.static('public')); // A better way to serve files
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});
app.get('/content-numbers.json', (req, res) => {
    res.sendFile(__dirname + '/content-numbers.json');
});


// --- Game Logic ---
io.on('connection', (socket) => {

    // make available sets discoverable to clients (host will use)
    socket.emit('server:questionSets', availableSets, defaultSet);

    // HOST creates a new room
    socket.on('host:create', () => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[roomCode] = {
            hostId: socket.id,
            players: {},
            gameState: {
                currentQuestionIndex: -1,
                isQuestionActive: false,
                answers: {},
                timer: null,
                content: null // per-room content (null => use defaultContent)
            }
        };
        socket.join(roomCode);
        socket.emit('server:roomCreated', roomCode);
        // also send available sets just to the host socket (redundant-safe)
        socket.emit('server:questionSets', availableSets, defaultSet);
        console.log(`Room created: ${roomCode}`);
    });

    // HOST selects which content set to use for this room
    socket.on('host:selectSet', (roomCode, filename) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;
        if (!availableSets.includes(filename)) return;
        try {
            room.gameState.content = loadContentFile(filename);
            socket.emit('server:info', `Selected set ${filename}`);
            console.log(`Room ${roomCode} selected set ${filename}`);
        } catch (e) {
            console.error('Failed to load content file', filename, e);
            socket.emit('server:error', 'Failed to load selected question set.');
        }
    });

    // HOST starts the next question
    socket.on('host:nextQuestion', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        // pick content for room (selected or default)
        const content = room.gameState.content || defaultContent;
        if (!content) {
            socket.emit('server:error', 'No question set available.');
            return;
        }

        room.gameState.currentQuestionIndex++;
        const questionIndex = room.gameState.currentQuestionIndex;

        if (questionIndex >= content.questions.length) {
            io.to(roomCode).emit('server:gameOver');
            return;
        }

        room.gameState.isQuestionActive = true;
        room.gameState.answers = {}; // Clear previous answers
        
        const currentQuestion = content.questions[questionIndex];
        // Send question + timer to players
        io.to(roomCode).emit('server:newQuestion', { question: currentQuestion.question, timer: content.timer });

        // Start the timer
        clearTimeout(room.gameState.timer);
        room.gameState.timer = setTimeout(() => {
            endQuestionAndJudge(roomCode);
        }, content.timer * 1000); // timer is in seconds
    });

    // PLAYER submits an answer
    socket.on('player:submitAnswer', (roomCode, answer) => {
        const room = rooms[roomCode];
        if (!room || !room.gameState.isQuestionActive || !room.players[socket.id]) return;

        // Log the answer
        room.gameState.answers[socket.id] = answer;
        
        // Check if all players have answered
        const totalPlayers = Object.keys(room.players).length;
        const answeredPlayers = Object.keys(room.gameState.answers).length;

        if (answeredPlayers === totalPlayers) {
            clearTimeout(room.gameState.timer); // Stop the timer early
            endQuestionAndJudge(roomCode);
        }
    });
});

// --- Helper Function ---
function endQuestionAndJudge(roomCode) {
    const room = rooms[roomCode];
    if (!room || !room.gameState.isQuestionActive) return;

    room.gameState.isQuestionActive = false;
    const questionIndex = room.gameState.currentQuestionIndex;
    const correctAnswer = content.questions[questionIndex].answer;
    
    let closestPlayerId = null;
    let minDifference = Infinity;

    // Find the closest player
    for (const playerId in room.gameState.answers) {
        const playerAnswer = parseInt(room.gameState.answers[playerId], 10);
        const difference = Math.abs(playerAnswer - correctAnswer);

        if (difference < minDifference) {
            minDifference = difference;
            closestPlayerId = playerId;
        }
    }

    // Award point if someone answered
    if (closestPlayerId) {
        room.players[closestPlayerId].score++;
    }

    // Prepare results for the host
    const results = {
        correctAnswer: correctAnswer,
        playerAnswers: Object.entries(room.gameState.answers).map(([id, answer]) => ({
            name: room.players[id].name,
            answer: answer
        })),
        scores: Object.values(room.players)
    };

    io.to(room.hostId).emit('server:showResults', results);
}

// --- Server Start ---
server.listen(3000, () => {
    console.log('listening on *:3000');
});

