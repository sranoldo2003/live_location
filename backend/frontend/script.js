// --- Global Variables ---
let map = null;
const INITIAL_ZOOM = 13;
let userMarker = null;
const userLocationData = {};
let currentRoomId = null;
const otherMarkers = {}; // { socketId: L.Marker }
let lastEmit = 0;
const EMIT_INTERVAL_MS = 1000; // throttle emits

// --- Name handling (prompt once, persist in localStorage) ---
let displayName = localStorage.getItem("displayName");
if (!displayName) {
  const suggested = "User-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  displayName = prompt("Enter your name (shown to others):", suggested) || suggested;
  displayName = displayName.trim() || suggested;
  localStorage.setItem("displayName", displayName);
}


// --- UI BOX ---
const uiContainer = document.createElement("div");
uiContainer.id = "ui-controls";
uiContainer.style.cssText =
  "position: fixed; top: 10px; right: 10px; background: white; padding: 10px; border: 1px solid #ccc; z-index: 1000; width: 240px;";
uiContainer.innerHTML = `
    <h3 style="margin:0 0 8px;">Location Share</h3>

    <label style="font-size:12px; display:block; margin-bottom:4px;">Your Name</label>
    <div style="display:flex; gap:6px; margin-bottom:8px;">
      <input type="text" id="nameInput" placeholder="Your name" value="${displayName}" style="flex:1; padding:6px;">
      <button id="saveNameBtn">Save</button>
    </div>

    <label style="font-size:12px; display:block; margin-bottom:4px;">Room ID</label>
    <input type="text" id="roomIdInput" placeholder="Enter Room ID" value="MAP123" style="width:100%; padding:6px; margin-bottom:6px;" />
    <div style="display:flex; gap:6px; margin-bottom:8px;">
      <button id="createBtn">Create Room</button>
      <button id="joinBtn">Join Room</button>
    </div>

    <p id="status" style="margin:6px 0;">Status: Connecting...</p>
    
    <div id="shareLinkContainer" style="margin-top: 8px; display: none;">
        <p style="margin:0 0 6px;">Share this link:</p>
        <input type="text" id="shareLink" style="width: 100%; padding: 5px;" readonly>
        <button id="copyBtn" style="margin-top:6px;">Copy</button>
    </div>
`;
document.body.appendChild(uiContainer);

// DOM refs
const statusElement = document.getElementById("status");
const roomIdInput = document.getElementById("roomIdInput");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const shareLinkContainer = document.getElementById("shareLinkContainer");
const shareLinkInput = document.getElementById("shareLink");
const copyBtn = document.getElementById("copyBtn");
const nameInput = document.getElementById("nameInput");
const saveNameBtn = document.getElementById("saveNameBtn");

// SOCKET IO
const socket = io();

// -------- Helpers --------

// deterministic bright color per id
function getColorForUser(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 85%, 50%)`;
}

// Create a CSS-only “anchor pin” using a DivIcon
function createPinIcon(color) {
  const html =
    `<div class="pin-marker" style="--pin-color:${color}">
        <div class="pin-dot"></div>
     </div>`;
  return L.divIcon({
    html,
    className: "pin-wrapper",      // keep Leaflet from adding default img styles
    iconSize: [28, 42],            // visual size of the pin box
    iconAnchor: [14, 42],          // tip points at the coordinate
    popupAnchor: [0, -36]
  });
}

// permanent tooltip label above marker
function bindOrUpdateNameLabel(marker, nameText) {
  if (marker.getTooltip && marker.getTooltip()) marker.unbindTooltip();
  marker.bindTooltip(nameText, {
    permanent: true,
    direction: "top",
    offset: [0, -10],
    className: "name-label",
    opacity: 1
  });
}

// -------- Map --------
function initializeMap(lat, lon) {
  if (map) return;
  map = L.map("map").setView([lat, lon], INITIAL_ZOOM);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);
}

function updateMyMarker(lat, lon) {
  const latlng = [lat, lon];
  const color = getColorForUser(socket.id);
  const icon = createPinIcon(color);

  if (!userMarker) {
    userMarker = L.marker(latlng, { icon }).addTo(map).bindPopup("You");
    bindOrUpdateNameLabel(userMarker, displayName);
    map.setView(latlng, INITIAL_ZOOM);
  } else {
    userMarker.setLatLng(latlng);
    userMarker.setIcon(icon);
    bindOrUpdateNameLabel(userMarker, displayName);
  }
}

function updateOtherMarker(data) {
  const { lat, lon, socketId, displayName: otherName } = data;
  const latlng = [lat, lon];
  const color = getColorForUser(socketId);
  const icon = createPinIcon(color);
  const label = (otherName && otherName.trim()) || `User-${socketId.substring(0, 4)}`;

  if (otherMarkers[socketId]) {
    otherMarkers[socketId].setLatLng(latlng);
    otherMarkers[socketId].setIcon(icon);
    bindOrUpdateNameLabel(otherMarkers[socketId], label);
  } else {
    const mark = L.marker(latlng, { icon })
      .addTo(map)
      .bindPopup(`ID: ${socketId.substring(0, 6)}…`);
    bindOrUpdateNameLabel(mark, label);
    otherMarkers[socketId] = mark;
  }
}

function removeOtherMarker(socketId) {
  if (otherMarkers[socketId]) {
    map.removeLayer(otherMarkers[socketId]);
    delete otherMarkers[socketId];
  }
}

// -------- Geolocation --------
function watchUserPosition() {
  if (!("geolocation" in navigator)) {
    statusElement.textContent = "❌ Geolocation not supported";
    alert("Geolocation not supported");
    return;
  }

  const geoOptions = { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 };

  navigator.geolocation.watchPosition(
    (position) => {
      const now = Date.now();
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;

      if (!map) initializeMap(lat, lon);
      updateMyMarker(lat, lon);

      userLocationData.lat = lat;
      userLocationData.lon = lon;
      userLocationData.socketId = socket.id;
      userLocationData.displayName = displayName;

      if (currentRoomId && socket.connected && now - lastEmit >= EMIT_INTERVAL_MS) {
        lastEmit = now;
        socket.emit("locationUpdate", userLocationData);
      }
    },
    (error) => {
      statusElement.textContent = `Location Error: ${error.message}`;
      if (!map) initializeMap(51.505, -0.09);
    },
    geoOptions
  );
}

// -------- URL auto-join --------
function handleUrlFlow() {
  const urlParams = new URLSearchParams(window.location.search);
  const urlRoomId = urlParams.get("room");
  if (urlRoomId) {
    roomIdInput.value = urlRoomId;
    createBtn.style.display = "none";
    joinBtn.style.display = "none";
    statusElement.textContent = `Attempting to join room ${urlRoomId}...`;
    socket.once("connect", () => socket.emit("joinRoom", urlRoomId));
  }
}

// -------- UI events --------
copyBtn.onclick = () => {
  shareLinkInput.select();
  shareLinkInput.setSelectionRange(0, 99999);
  navigator.clipboard.writeText(shareLinkInput.value);
  alert("Link copied ✅");
};

createBtn.onclick = () => {
  const roomId = roomIdInput.value.trim();
  if (roomId) socket.emit("createRoom", roomId);
};

joinBtn.onclick = () => {
  const roomId = roomIdInput.value.trim();
  if (roomId) socket.emit("joinRoom", roomId);
};

saveNameBtn.onclick = () => {
  const newName = (nameInput.value || "").trim();
  if (!newName) return alert("Name cannot be empty.");
  displayName = newName;
  localStorage.setItem("displayName", displayName);
  if (userMarker) bindOrUpdateNameLabel(userMarker, displayName);
  statusElement.textContent = `✅ Name saved as "${displayName}"`;
};

// -------- Socket events --------
socket.on("connect", () => {
  statusElement.textContent = `✅ Connected (ID: ${socket.id})`;
  watchUserPosition();
  handleUrlFlow();
  if (currentRoomId) socket.emit("joinRoom", currentRoomId); // auto-rejoin
});

socket.on("roomCreated", (roomId) => {
  currentRoomId = roomId;
  statusElement.textContent = `✅ Room ${roomId} Created & Joined`;
  const shareUrl = `${window.location.origin}/?room=${roomId}`;
  shareLinkInput.value = shareUrl;
  shareLinkContainer.style.display = "block";
  roomIdInput.style.display = "none";
  createBtn.style.display = "none";
  joinBtn.style.display = "none";
});

socket.on("roomJoined", (roomId) => {
  currentRoomId = roomId;
  statusElement.textContent = `✅ Joined room ${roomId}`;
  roomIdInput.style.display = "none";
  createBtn.style.display = "none";
  joinBtn.style.display = "none";
});

socket.on("roomError", (message) => {
  statusElement.textContent = `⚠️ ${message}`;
  alert(message);
});

socket.on("otherUserLocation", (data) => updateOtherMarker(data));
socket.on("userLeft", (socketId) => removeOtherMarker(socketId));

// Clean up
window.addEventListener("beforeunload", () => {
  try { socket.close(); } catch {}
});



