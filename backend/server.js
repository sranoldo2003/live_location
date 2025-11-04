const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path'); // NEW: Import path module for file serving

const app = express();
const server = http.createServer(app);

// --- Dynamic CORS Origin Setup for Deployment ---
// RENDER_EXTERNAL_URL is an environment variable provided by Render.
// It allows us to dynamically set the correct HTTPS domain for CORS.
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
// Use the Render URL if available (deployed), otherwise use the local test URL
const FRONTEND_ORIGIN = RENDER_EXTERNAL_URL ? RENDER_EXTERNAL_URL : 'http://127.0.0.1:5500'; 


// 1. Serve Static Frontend Files (The 'frontend' directory is assumed to be inside 'backend')
// The path.join(__dirname, 'frontend') points to the folder containing index.html, script.js, etc.
app.use(express.static(path.join(__dirname, 'frontend')));

// 2. CORS setup for Express and Socket.IO
app.use(cors({ origin: FRONTEND_ORIGIN, methods: ["GET", "POST"] }));

const io = new Server(server, {
    cors: {
        origin: FRONTEND_ORIGIN,
        methods: ["GET", "POST"]
    }
});


// 3. Define the root route
// This ensures that accessing the base URL (your Render domain) serves the index.html file.
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});


// Simple room storage (no changes needed)
const activeRooms = new Map();

// --- Socket.IO Connection Handler (No changes needed here) ---
io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);

    // 1. Logic for CREATING a room
    socket.on('createRoom', (roomId) => {
        if (!activeRooms.has(roomId)) {
            socket.join(roomId);
            activeRooms.set(roomId, new Set([socket.id]));
            socket.emit('roomCreated', roomId);
            console.log(`Room created and joined: ${roomId}`);
        } else {
            // If room exists, treat it as a join
            socket.emit('roomError', 'Room ID already exists. Try joining instead.');
        }
    });

    // 2. Logic for JOINING a room
    socket.on('joinRoom', (roomId) => {
        if (activeRooms.has(roomId)) {
            socket.join(roomId);
            activeRooms.get(roomId).add(socket.id);
            socket.emit('roomJoined', roomId);

            // Tell everyone in the room (except the new joiner) that a new user is here
            socket.to(roomId).emit('userJoined', socket.id);
            console.log(`User ${socket.id} joined room: ${roomId}`);
        } else {
            socket.emit('roomError', 'Room does not exist.');
        }
    });

    // 3. Logic for sending location updates 
    socket.on('locationUpdate', (data) => {
        // Find which room the socket is in (Socket.IO rooms property)
        const room = [...socket.rooms].find(r => r !== socket.id);
        if (room) {
            // Broadcast location to everyone else in the room
            socket.to(room).emit('otherUserLocation', data);
            console.log(`Location broadcasted in room: ${room} from ${socket.id.substring(0, 4)}`); 
        }
    });


    // 4. Cleanup when a user disconnects
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);

        // Remove the user from the room data structure
        for (const [roomId, socketIds] of activeRooms.entries()) {
            if (socketIds.has(socket.id)) {
                socketIds.delete(socket.id);
                console.log(`User ${socket.id} left room ${roomId}`);

                // Notify others in the room
                socket.to(roomId).emit('userLeft', socket.id);

                // Optional: Delete the room if it's now empty
                if (socketIds.size === 0) {
                    activeRooms.delete(roomId);
                    console.log(`Room deleted: ${roomId} (empty)`);
                }
                break;
            }
        }
    });
});

// --- Server Start ---
// Use the port provided by the environment (Render), or default to 10000
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});