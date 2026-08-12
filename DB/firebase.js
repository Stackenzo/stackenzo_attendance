const admin = require("firebase-admin");
const serviceAccount = require("../stackenzoemp-firebase-adminsdk-fbsvc-85118c0cce.json")
admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://stackenzoemp-default-rtdb.firebaseio.com"
})
const fire_db = admin.database(); 
module.exports=fire_db