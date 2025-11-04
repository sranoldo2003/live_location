// frontend/script.js - FINAL APPLICATION CODE (Modules 1-5)

// --- Global Variables ---
let map = null;
const INITIAL_ZOOM = 13;
let userMarker = null;
const userLocationData = {};
let currentRoomId = null;
const otherMarkers = {}; // Stores { socketId: L.Marker }

// --- Leaflet Marker Fix (Necessary to point to images) ---
// frontend/script.js (Around line 10 - Marker Fix)

delete L.Icon.Default.prototype._get;
L.Icon.Default.mergeOptions({
  // USE LOCAL RELATIVE PATHS
  iconRetinaUrl: "./images/marker-icon-2x.png",
  iconUrl: "./images/marker-icon.png",
  shadowUrl: "./images/marker-shadow.png",
});

// --- UI Elements ---
const uiContainer = document.createElement("div");
uiContainer.id = "ui-controls";
uiContainer.style.cssText =
  "position: fixed; top: 10px; right: 10px; background: white; padding: 10px; border: 1px solid #ccc; z-index: 1000;";
uiContainer.innerHTML = `
    <h3>Location Share</h3>
    <input type="text" id="roomIdInput" placeholder="Enter Room ID" value="MAP123" />
    <button id="createBtn">Create Room</button>
    <button id="joinBtn">Join Room</button>
    <p id="status">Status: Connecting...</p>
    
    <div id="shareLinkContainer" style="margin-top: 10px; display: none;">
        <p>Share this link:</p>
        <input type="text" id="shareLink" style="width: 100%; padding: 5px;" readonly>
        <button id="copyBtn">Copy</button>
    </div>
`;
document.body.appendChild(uiContainer);

// Get UI elements
const statusElement = document.getElementById("status");
const roomIdInput = document.getElementById("roomIdInput");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const shareLinkContainer = document.getElementById("shareLinkContainer");
const shareLinkInput = document.getElementById("shareLink");
const copyBtn = document.getElementById("copyBtn");

// --- SOCKET.IO CONNECTION ---
const socket = io("http://localhost:3000");

// --- HELPER FUNCTIONS ---

function initializeMap(lat, lon) {
  if (map) return;
  map = L.map("map").setView([lat, lon], INITIAL_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);
  console.log("Leaflet map initialized successfully.");
}

function updateMyMarker(lat, lon) {
  const latlng = [lat, lon];

  if (userMarker === null) {
    userMarker = L.marker(latlng)
      .addTo(map)
      .bindPopup("Your Location")
      .openPopup();

    map.setView(latlng, INITIAL_ZOOM);
  } else {
    userMarker.setLatLng(latlng);
  }
}

function updateOtherMarker(data) {
  const { lat, lon, socketId } = data;
  const latlng = [lat, lon];

  if (otherMarkers[socketId]) {
    otherMarkers[socketId].setLatLng(latlng);
  } else {
    // Creates a default Leaflet marker, which should now be visible due to the CSS/JS path fix
    const newMarker = L.marker(latlng)
      .addTo(map)
      .bindPopup(`User: ${socketId.substring(0, 4)}...`);

    otherMarkers[socketId] = newMarker;
    console.log(
      `NEW MARKER created for remote user: ${socketId.substring(0, 4)}`
    );
  }
}

function removeOtherMarker(socketId) {
  if (otherMarkers[socketId]) {
    map.removeLayer(otherMarkers[socketId]);
    delete otherMarkers[socketId];
    console.log(`Marker for ${socketId.substring(0, 4)}... removed.`);
  }
}

function watchUserPosition() {
  if (!("geolocation" in navigator)) {
    statusElement.textContent = "Status: Geolocation is not supported.";
    alert("Geolocation is not supported by your browser.");
    return;
  }

  const geoOptions = {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 30000, // 30 seconds to allow for location fix
  };

  navigator.geolocation.watchPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;

      if (!map) {
        initializeMap(lat, lon);
      }

      updateMyMarker(lat, lon);

      userLocationData.lat = lat;
      userLocationData.lon = lon;
      userLocationData.socketId = socket.id;

      if (currentRoomId && socket.connected) {
        socket.emit("locationUpdate", userLocationData);
      }
    },
    (error) => {
      console.error("Geolocation Error:", error.message);
      statusElement.textContent = `Status: Location Error - ${error.message}`;
      if (!map) {
        initializeMap(51.505, -0.09);
      }
    },
    geoOptions
  );
}

/** Module 5: Handles URL-based auto-joining. */
function handleUrlFlow() {
  const urlParams = new URLSearchParams(window.location.search);
  const urlRoomId = urlParams.get("room");

  if (urlRoomId) {
    roomIdInput.value = urlRoomId;
    createBtn.style.display = "none";
    joinBtn.style.display = "none";
    statusElement.textContent = `Status: Attempting to join room ${urlRoomId}...`;

    // Join when socket connects
    socket.once("connect", () => {
      socket.emit("joinRoom", urlRoomId);
    });
  }
}

// --- EVENT HANDLERS ---

copyBtn.onclick = () => {
  shareLinkInput.select();
  shareLinkInput.setSelectionRange(0, 99999);
  navigator.clipboard
    .writeText(shareLinkInput.value)
    .then(() => alert("Link copied to clipboard!"))
    .catch((err) => console.error("Could not copy text: ", err));
};

createBtn.onclick = () => {
  const roomId = roomIdInput.value.trim();
  if (roomId) {
    socket.emit("createRoom", roomId);
  }
};

joinBtn.onclick = () => {
  const roomId = roomIdInput.value.trim();
  if (roomId) {
    socket.emit("joinRoom", roomId);
  }
};

// --- SOCKET.IO LISTENERS ---

socket.on("connect", () => {
  statusElement.textContent = `Status: Connected (ID: ${socket.id}). Please join a room.`;
  watchUserPosition();
  handleUrlFlow(); // Check for URL parameter and auto-join
});

socket.on("roomCreated", (roomId) => {
  currentRoomId = roomId;
  statusElement.textContent = `Status: Room ${roomId} Created & Joined!`;

  // Display the shareable link
  const shareLinkUrl = `${window.location.origin}/?room=${roomId}`;
  shareLinkInput.value = shareLinkUrl;
  shareLinkContainer.style.display = "block";

  // Hide manual input
  roomIdInput.style.display = "none";
  createBtn.style.display = "none";
  joinBtn.style.display = "none";
});

socket.on("roomJoined", (roomId) => {
  currentRoomId = roomId;
  statusElement.textContent = `Status: Room ${roomId} Joined!`;
  // Hide manual input
  roomIdInput.style.display = "none";
  createBtn.style.display = "none";
  joinBtn.style.display = "none";
});

socket.on("roomError", (message) => {
  statusElement.textContent = `Status: Error - ${message}`;
  alert(message);
});

socket.on("otherUserLocation", (data) => {
  updateOtherMarker(data);
});

socket.on("userLeft", (socketId) => {
  removeOtherMarker(socketId);
});
