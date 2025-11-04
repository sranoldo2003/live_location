// backend/server.js

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Use CORS to allow the frontend to connect (since they'll be on different ports)
app.use(cors({
    origin: "http://127.0.0.1:5500", // **IMPORTANT:** Replace with your actual frontend URL (e.g., if using Live Server)
    methods: ["GET", "POST"]
}));

// --- Socket.IO Setup ---
const io = new Server(server, {
    cors: {
        origin: "http://127.0.0.1:5500", // Must match the frontend origin
        methods: ["GET", "POST"]
    }
});

// Simple room storage
// Key: room ID, Value: Set of connected socket IDs
const activeRooms = new Map();

// --- Socket.IO Connection Handler ---
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

    // 3. Logic for sending location updates (will be fully implemented in Module 4)
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
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});