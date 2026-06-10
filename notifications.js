const express = require("express");
const router = express.Router();

const {createJwt,veriftJWT}=require("./jwt")
const {usermodel,userDatamodel,fire_db}=require("./db");
const rateLimiter = require("./rateLimiter");
const notificationDB=fire_db.ref("notifications")

async function fetchUnreadAndMarkRead(userId) {
  console.log("userId=", userId);
  const snap = await fire_db
    .ref(`notifications/${userId}`)
    
    .once("value");

  const unreadNotifications = [];
  const updates = [];

  snap.forEach((child) => {
    const data = child.val();
    unreadNotifications.push({ id: child.key, ...data });
    updates.push(child.ref.update({ is_read: true }));
  });

  await Promise.all(updates);
  return unreadNotifications;
}
router.get("/getNotifications",rateLimiter,async(req,res)=>{
  try {
    console.log("came to notifications")
    //  const header = req.headers.authorization;
    // if (!header) {
    //   return res.status(401).json({ message: "Missing authorization headers" });
    // }
    
    // const token = header.split(" ")[1];
    // if (!token) {
    //   return res.status(401).json({ message: "Token not found" });
    // }

    // const payload = await veriftJWT(token);
    // if (!payload) {
    //   return res.status(401).json({ message: "Invalid or expired token" });
    // }

    const userId = "6a26fbb4f3108bbd35659f95"; 
    
console.log("email=",userId)
    const notifications = await fetchUnreadAndMarkRead(userId);
console.log("got notifications",notifications)
    res.status(200).json({
      success: true,
      notifications,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
    });
  }
})
router.get("/unreadCount", rateLimiter, async (req, res) => {
  try {
    const userId = "6a26fbb4f3108bbd35659f95";
    const snap = await fire_db
      .ref(`notifications/${userId}`)
      .orderByChild("is_read")
      .equalTo(false)
      .once("value");

    const unreadCount = snap.numChildren();

    res.status(200).json({
      success: true,
      count: unreadCount,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch unread count",
    });
  }
});
module.exports=router