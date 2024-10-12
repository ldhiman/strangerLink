const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.static("public"));

let matchmakingQueue = [];
const userPartners = new Map();

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("ready", (userData) => {
    try {
      const { name, gender } = userData;
      socket.userName = name;
      socket.userGender = gender;
      socket.available = true; // Set availability when user is ready
      matchmakingQueue.push(socket);
      console.log("User added to matchmaking queue:", socket.id, name, gender);
      matchUsers();
    } catch (error) {
      console.error("Error in ready event:", error);
      socket.emit("error", {
        message: "An error occurred while processing your request.",
      });
    }
  });

  const matchUsers = () => {
    if (matchmakingQueue.length < 2) return;

    const genderQueues = {
      male: [],
      female: [],
      other: [],
    };

    for (const user of matchmakingQueue) {
      if (user.available) {
        (genderQueues[user.userGender] || genderQueues.other).push(user);
      }
    }

    const matchedUsers = new Set();
    const matches = [];

    matchOppositeGender(
      genderQueues.male,
      genderQueues.female,
      matches,
      matchedUsers
    );

    for (const queue of Object.values(genderQueues)) {
      matchSameGender(queue, matches, matchedUsers);
    }

    for (const [user1, user2] of matches) {
      processMatch(user1, user2);
    }

    matchmakingQueue = matchmakingQueue.filter(
      (user) => !matchedUsers.has(user.id)
    );
  };

  const matchOppositeGender = (males, females, matches, matchedUsers) => {
    const minLength = Math.min(males.length, females.length);
    for (let i = 0; i < minLength; i++) {
      matches.push([males[i], females[i]]);
      matchedUsers.add(males[i].id);
      matchedUsers.add(females[i].id);
    }
  };

  const matchSameGender = (queue, matches, matchedUsers) => {
    for (let i = 0; i < queue.length - 1; i += 2) {
      if (!matchedUsers.has(queue[i].id)) {
        matches.push([queue[i], queue[i + 1]]);
        matchedUsers.add(queue[i].id);
        matchedUsers.add(queue[i + 1].id);
      }
    }
  };

  const processMatch = (user1, user2) => {
    [user1, user2].forEach((user) => {
      user.available = false;
      const partner = user === user1 ? user2 : user1;
      userPartners.set(user.id, partner.id);

      user.emit("matched", { partnerId: partner.id });
      user.emit("systemMessage", {
        code: 100,
        name: partner.userName,
        message: `Matched with ${partner.userName}, ${partner.userGender}`,
      });
    });

    console.log("Matched:", user1.id, user2.id);
  };

  socket.on("signal", (data) => {
    try {
      const targetSocket = io.sockets.sockets.get(data.to);
      if (targetSocket) {
        targetSocket.emit("signal", {
          from: socket.id,
          signal: data.signal,
        });
      } else {
        throw new Error("Target socket not found");
      }
    } catch (error) {
      console.error("Error in signal event:", error);
      socket.emit("error", { message: "Failed to send signal." });
    }
  });

  socket.on("chatMessage", (data) => {
    try {
      const targetSocket = io.sockets.sockets.get(data.to);
      if (targetSocket) {
        targetSocket.emit("chatMessage", {
          message: data.message,
        });
      } else {
        throw new Error("Target socket not found");
      }
    } catch (error) {
      console.error("Error in chatMessage event:", error);
      socket.emit("error", { message: "Failed to send message." });
    }
  });

  socket.on("endCall", () => {
    try {
      console.log("Call ended by:", socket.id);
      const partnerId = userPartners.get(socket.id);
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit("endCall");
      }

      userPartners.delete(socket.id);
      userPartners.delete(partnerId);
    } catch (error) {
      console.error("Error in endCall event:", error);
      socket.emit("error", {
        message: "An error occurred while ending the call.",
      });
    }
  });

  socket.on("disconnect", () => {
    try {
      console.log("User disconnected:", socket.id);

      const partnerId = userPartners.get(socket.id);
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit("systemMessage", {
          code: 101,
          message: "Your partner has disconnected.",
        });
      }

      userPartners.delete(socket.id);
      userPartners.delete(partnerId);

      matchmakingQueue = matchmakingQueue.filter((s) => s.id !== socket.id);
    } catch (error) {
      console.error("Error in disconnect event:", error);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
