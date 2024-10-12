// Establish socket connection
const socket = io();

let userName = "";
let userGender = "";

// DOM elements
const elements = {
  app: document.getElementById("app"),
  permissionScreen: document.getElementById("permissionScreen"),
  mainContent: document.getElementById("mainContent"),
  matchmakingControls: document.getElementById("matchmakingControls"),
  startMatchmakingBtn: document.getElementById("startMatchmakingBtn"),
  nextMatchBtn: document.getElementById("nextMatchBtn"),
  stopMatchmakingBtn: document.getElementById("stopMatchmakingBtn"),
  localVideo: document.getElementById("localVideo"),
  remoteVideo: document.getElementById("remoteVideo"),
  waitingScreen: document.getElementById("waitingScreen"),
  callScreen: document.getElementById("callScreen"),
  chatInput: document.getElementById("chatInput"),
  messages: document.getElementById("messages"),
  requestPermissionBtn: document.getElementById("requestPermissionBtn"),
  endCallBtn: document.getElementById("endCallBtn"),
  muteBtn: document.getElementById("muteBtn"),
  videoBtn: document.getElementById("videoBtn"),
  chatContainer: document.getElementById("chatContainer"),
};

// Global variables
let localStream;
let remoteStream = null;
let peerConnection;
let isMuted = false;
let isVideoOff = false;
let isMatchmaking = false;
let currentPartnerId = null;

// WebRTC configuration
const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.google.com:19302" },
  ],
};

// Event listeners
elements.requestPermissionBtn.addEventListener(
  "click",
  requestMediaPermissions
);
elements.startMatchmakingBtn.addEventListener("click", startMatchmaking);
elements.nextMatchBtn.addEventListener("click", nextMatch);
elements.stopMatchmakingBtn.addEventListener("click", stopMatchmaking);
elements.muteBtn.addEventListener("click", toggleMute);
elements.videoBtn.addEventListener("click", toggleVideo);
elements.endCallBtn.addEventListener("click", endCall);
elements.chatInput.addEventListener("keydown", handleChatInput);

// Functions
async function requestMediaPermissions() {
  userName = document.getElementById("userName").value.trim();
  userGender = document.getElementById("userGender").value;

  if (!userName || !userGender) {
    alert("Please enter your name and select your gender.");
    return;
  }

  try {
    const permissions = await Promise.all([
      navigator.permissions.query({ name: "camera" }),
      navigator.permissions.query({ name: "microphone" }),
    ]);

    // Only set up local stream if permissions are granted
    if (permissions.every((permission) => permission.state === "granted")) {
      console.log("Camera and microphone permission granted.");
      await setupLocalStream();
    } else {
      console.warn("Permissions not granted.");
      alert("Camera and microphone permissions are required.");
    }

    showMainContent();
  } catch (error) {
    console.error("Error accessing media devices:", error);
    alert("Failed to access camera and microphone.");
  }
}

async function setupLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    elements.localVideo.srcObject = localStream;
  } catch (error) {
    console.error("Error setting up local stream:", error);
  }
}

function showMainContent() {
  elements.permissionScreen.classList.add("hidden");
  elements.mainContent.classList.remove("hidden");
}

function startMatchmaking() {
  isMatchmaking = true;
  elements.startMatchmakingBtn.classList.add("hidden");
  elements.stopMatchmakingBtn.classList.remove("hidden");
  elements.waitingScreen.classList.remove("hidden");
  socket.emit("ready", { name: userName, gender: userGender });
}

function nextMatch() {
  endCurrentCall();
  startMatchmaking();
}

function stopMatchmaking() {
  isMatchmaking = false;
  elements.stopMatchmakingBtn.classList.add("hidden");
  elements.startMatchmakingBtn.classList.remove("hidden");
  elements.waitingScreen.classList.add("hidden");
  socket.emit("stopMatchmaking");
}

function toggleMute() {
  isMuted = !isMuted;
  localStream.getAudioTracks()[0].enabled = !isMuted;
  elements.muteBtn.textContent = isMuted ? "Unmute" : "Mute";
}

function toggleVideo() {
  isVideoOff = !isVideoOff;
  localStream.getVideoTracks()[0].enabled = !isVideoOff;
  elements.videoBtn.textContent = isVideoOff
    ? "Turn On Video"
    : "Turn Off Video";
}

async function setupPeerConnection() {
  if (peerConnection) {
    peerConnection.close();
  }

  // peerConnection = new RTCPeerConnection(configuration);
  peerConnection = new RTCPeerConnection();

  peerConnection.onicecandidate = (event) => {
    if (peerConnection.remoteDescription && event.candidate) {
      console.log("Sending ICE candidate:", event.candidate);
      socket.emit("signal", {
        to: currentPartnerId,
        signal: {
          ice: encodeURIComponent(JSON.stringify(event.candidate)),
        },
      });
    }
  };

  peerConnection.ontrack = (event) => {
    console.log("Received remote track:", event);
    if (!remoteStream) {
      remoteStream = new MediaStream();
      elements.remoteVideo.srcObject = remoteStream;
    }
    remoteStream.addTrack(event.track);

    // Ensure the video starts playing
    elements.remoteVideo
      .play()
      .catch((e) => console.error("Error playing remote video:", e));
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log(
      "ICE connection state changed:",
      peerConnection.iceConnectionState
    );
    console.log("Current connection state:", peerConnection.connectionState);
    if (peerConnection.iceConnectionState === "disconnected") {
      alert("Your partner has disconnected.");
      endCurrentCall();
      if (isMatchmaking) {
        startMatchmaking();
      }
    }
  };

  // Add local tracks to the peer connection
  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.addEventListener("connectionstatechange", (event) => {
    console.log("Connection state change:", peerConnection.connectionState);
  });

  peerConnection.addEventListener("icegatheringstatechange", (event) => {
    console.log(
      "ICE gathering state change:",
      peerConnection.iceGatheringState
    );
  });

  peerConnection.addEventListener("signalingstatechange", (event) => {
    console.log("Signaling state change:", peerConnection.signalingState);
  });
}

async function initiateCall() {
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // Ensure local description is set before emitting the signal
    if (peerConnection.localDescription) {
      socket.emit("signal", {
        to: currentPartnerId,
        signal: {
          type: "offer",
          sdp: encodeURIComponent(offer.sdp),
        },
      });
    }
  } catch (error) {
    console.error("Error creating offer:", error);
  }
}

function endCall() {
  endCurrentCall();
  stopMatchmaking();
}

function endCurrentCall() {
  if (peerConnection) {
    peerConnection.close();
  }
  currentPartnerId = null;
  socket.emit("endCall");
  resetCallUI();
}

function resetCallUI() {
  elements.callScreen.classList.add("hidden");
  elements.nextMatchBtn.classList.add("hidden");
  elements.remoteVideo.srcObject = null;
  elements.messages.innerHTML = "";
  elements.chatInput.value = "";
}

function resetUI() {
  resetCallUI();
  elements.waitingScreen.classList.add("hidden");
  elements.startMatchmakingBtn.classList.remove("hidden");
  elements.stopMatchmakingBtn.classList.add("hidden");
  elements.nextMatchBtn.classList.add("hidden");
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
  }
  elements.localVideo.srcObject = null;
  isMuted = false;
  isVideoOff = false;
  elements.muteBtn.textContent = "Mute";
  elements.videoBtn.textContent = "Turn Off Video";
}

function handleChatInput(e) {
  if (e.key === "Enter" && elements.chatInput.value.trim() !== "") {
    const message = elements.chatInput.value;
    elements.chatInput.value = "";
    displayMessage("You", message);
    socket.emit("chatMessage", { to: currentPartnerId, message });
  }
}

function displayMessage(sender, message) {
  const messageEl = document.createElement("p");
  messageEl.innerHTML = `<strong>${sender}:</strong> ${message}`;
  elements.messages.appendChild(messageEl);
  elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

// Socket event handlers
socket.on("matched", async (data) => {
  console.log("Matched with a partner");
  currentPartnerId = data.partnerId;
  elements.waitingScreen.classList.add("hidden");
  elements.callScreen.classList.remove("hidden");
  elements.nextMatchBtn.classList.remove("hidden");
  await setupPeerConnection();
  await initiateCall();
});

socket.on("signal", async (data) => {
  if (!peerConnection) return;

  console.log("Received signal type:", data.signal.type);
  console.log("Current connection state:", peerConnection.connectionState);
  console.log(
    "Current ICE connection state:",
    peerConnection.iceConnectionState
  );

  try {
    console.log("Received signaling data:", data);

    // Handle ICE candidates
    if (data.signal.ice) {
      try {
        const iceCandidate = JSON.parse(decodeURIComponent(data.signal.ice));
        await peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidate));
        console.log("Added ICE candidate successfully");
      } catch (error) {
        console.error("Error adding ICE candidate:", error);
      }
    }

    // Handle SDP messages
    else if (data.signal.sdp) {
      const sdp = decodeURIComponent(data.signal.sdp);
      const signalType = data.signal.type;

      if (signalType === "offer") {
        // Set remote description with a check for the connection state
        if (
          peerConnection.connectionState !== "new" &&
          peerConnection.connectionState !== "have-remote-offer"
        ) {
          console.error(
            "Cannot set remote offer, connection is in an invalid state."
          );
          return;
        }

        await peerConnection.setRemoteDescription(
          new RTCSessionDescription({ type: signalType, sdp })
        );

        // Create an answer if receiving an offer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit("signal", {
          to: currentPartnerId,
          signal: {
            type: "answer",
            sdp: encodeURIComponent(answer.sdp),
          },
        });
      } else if (signalType === "answer") {
        if (peerConnection.connectionState !== "have-local-offer") {
          console.error(
            "Cannot set remote answer, connection is not in a valid state."
          );
          return;
        }

        console.info("Set remote answer, connection is in a valid state.");
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription({ type: signalType, sdp })
        );
      }
    }
  } catch (error) {
    console.error("Error handling signaling message:", error);
  }
});

socket.on("chatMessage", (data) => {
  displayMessage("Stranger", data.message);
});

socket.on("systemMessage", (data) => {
  console.info("System: ", data);
  if (data.code == 101) {
    remoteStream = null;
  }
  if (data.code == 100) {
    document.getElementById("strangerName").innerText = data.name;
  }
  displayMessage("System", data.message);
});
