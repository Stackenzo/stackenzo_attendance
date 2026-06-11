const mongoose = require("mongoose");
require("dotenv").config();
const serviceAccount = require("./stackenzoemp-firebase-adminsdk-fbsvc-85118c0cce.json")
const admin = require("firebase-admin");
const Redis = require("ioredis");
admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://stackenzoemp-default-rtdb.firebaseio.com"
})
const fire_db = admin.database(); 
const users = new mongoose.Schema(
  {
    Name: {
      type: String,
      required: true,
      trim: true,
    },
    Email: {
      type: String,
      required: true,
      trim: true,
      unique:true
    },
    Role:{
type:String,
trim:true
    },
    password:{
        type:String,
        trim:true
    },
    mobile_no: {
      type: String,
      required: true,
      trim: true,
    },

    Department: {
      type: String,
      required: true,
      trim: true,
    },
    verified:{
type:Boolean,
default:false
    },
    EmpId:{
      type:String,
default: "pending",
    },
   
  },
  { timestamps: true }
);
const users_data = new mongoose.Schema(
  {
    id: {
      type: mongoose.Schema.ObjectId,
      ref: "usermodel",
    },
    In_Time: {
      type: String,
      trim: true,
      default: "",
    },
   delay_in_reason:{
type: String,
      trim: true,
      default: "",
    },
    In_Time_reason: {
      type: String,
      trim: true,
      default: "",
    },
    In_time_outside: {
      type: Boolean,
      required: true,
      default: false,
    },
    In_time_approved: {
      type: Boolean,
      required: true,
      default: false,
    },
    Out_time: {
      type: String,
      trim: true,
      default: "",
    },
    Out_time_reason: {
      type: String,
      trim: true,
      default: "",
    },
    Out_time_outside: {
      type: Boolean,
      required: true,
      default: false,
    },
    Out_time_approved: {
      type: Boolean,
      required: true,
      default: false,
    },
    Todays_Task: {
      type: String,
      trim: true,
      default: "",
    },
    reason_for_task_delay: {
      type: String,
      trim: true,
      default: "",
    },
    remarks: {
      type: String,
      trim: true,
      default: "",
    },
     total_hours:{
        type:String,
        trim:true,
        default:""
     }
  },
  { timestamps: true }
);
const department = new mongoose.Schema(
  {
    headId:{
      type:mongoose.Schema.ObjectId,
      ref:"user"
    },
    deptId:{
      type:String,
    unique: true,
    },
Department:{
  type:String
},   
  },
  { timestamps: true }
);
const usermodel = mongoose.model(
  "user",
  users
);
const userDatamodel = mongoose.model(
  "user_data",
  users_data
);
const departments=mongoose.model(
  "department",
  department
)
const redis = new Redis("redis://100.117.158.50:6379", {
    
  retryStrategy: (times) => {
    console.log("Retrying Redis...", times);
    return Math.min(times * 100, 2000);
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
async function connectdb() {
  try {
    console.log("mongoURI:", process.env.mongo_URI);
    if(!process.env.mongo_URI){
      return false
    }
    await mongoose.connect(process.env.mongo_URI);
    console.log("Connected to DB");
    return true;
  } catch (e) {
    console.error("DB Connection Error:", e);
    return false;
  }
}

module.exports = { usermodel,userDatamodel, connectdb,redis ,fire_db,departments};