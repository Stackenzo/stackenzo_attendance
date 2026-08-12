
const { createClient } = require("redis");
const redis = createClient({
    username: 'default',
    password: 'WM68ZTm1I2QCuVnzVofuRaC8VzjfcK5L',
    socket: {
        host: 'suggestion-iris-moon-49927.db.redis.io',
        port: 11198
    }
});
redis.on("connect", () => {
  console.log("✅ Redis TCP connection established");
});

redis.on("ready", () => {
  console.log("✅ Redis is ready to accept commands");
});

redis.on("error", (err) => {
  console.error("❌ Redis Error:", err.message);
});

redis.on("close", () => {
  console.log("⚠️ Redis connection closed");
});

redis.on("reconnecting", () => {
  console.log("🔄 Reconnecting to Redis...");
});
async function connectRedis() {
  try {
    if (!redis.isOpen) {
      await redis.connect();
      console.log("✅ Redis connected");
    }
  } catch (err) {
    console.error("❌ Redis connection failed:", err);
  }
}
module.exports={redis,connectRedis}