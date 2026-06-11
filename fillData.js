const express = require("express");
const router = express.Router();

const {createJwt,veriftJWT}=require("./jwt")
const {usermodel,userDatamodel,departments,fire_db, }=require("./db");
const rateLimiter = require("./rateLimiter");

const OFFICE_LAT = 14.407513;   
const OFFICE_LNG = 79.949118;
const ALLOWED_RADIUS_METERS = 100; 

function getDistanceInMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; 
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
router.post("/in-time", rateLimiter, async (req, res) => {
  try {
    const { lat, lng, time,userId,delay_in_reason } = req.body;

    if (!lat || !lng || !time) {
      return res.status(400).json({
        success: false,
        message: "lat, lng, and time are required",
      });
    }
  const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const existingAttendance = await userDatamodel.findOne({
      id: userId,
      createdAt: {
        $gte: startOfDay,
        $lte: endOfDay,
      },
      In_Time: { $ne: "" }
    });

    if (existingAttendance) {
      return res.status(400).json({
        success: false,
        message: "Attendance already marked for today",
      });
    }

    const distance = getDistanceInMeters(
      parseFloat(lat),
      parseFloat(lng),
      OFFICE_LAT,
      OFFICE_LNG
    );

    const isOutside = distance > ALLOWED_RADIUS_METERS;
    const attendance = await userDatamodel.create({
      id: userId,
      In_Time: time,
      In_time_outside: isOutside,
      delay_in_reason:delay_in_reason
    });

    return res.status(201).json({
      success: true,
      message: isOutside
        ? "Attendance marked — but you are outside office premises.send approval to your Head"
        : "Attendance marked successfully",
      isOutside,
      distance_meters: Math.round(distance),
      attendance,
    });

  } catch (error) {
    console.error("In-Time error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});
router.post("/out-time", rateLimiter, async (req, res) => {
  try {
    const { lat, lng, time, task, T_reason, remarks,userId } = req.body;
    if (!lat || !lng || !time || !task) {
      return res.status(400).json({ message: "lat, lng, time and task are required" });
    }
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const todayRecord = await userDatamodel.findOne({
      id: userId,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    });
    if (!todayRecord || !todayRecord.In_Time) {
      return res.status(400).json({ message: "In time is not recorded for today" });
    }
    if (todayRecord.Out_time) {
      return res.status(400).json({ message: "Out time already marked for today" });
    }
    const distance = getDistanceInMeters(
      parseFloat(lat),
      parseFloat(lng),
      OFFICE_LAT,
      OFFICE_LNG
    );
    const isOutside = distance > ALLOWED_RADIUS_METERS;
const parseTime = (timeStr) => {
  const [time, modifier] = timeStr.split(" ");
  let [hours, minutes] = time.split(":").map(Number);
  if (modifier === "PM" && hours !== 12) hours += 12;
  if (modifier === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes; 
};

const inMinutes = parseTime(todayRecord.In_Time);
const outMinutes = parseTime(time);
const totalMinutes = outMinutes - inMinutes;

if (totalMinutes <= 0) {
  return res.status(400).json({ message: "Out time must be after In time" });
}

const hoursWorked = Math.floor(totalMinutes / 60);
const minutesWorked = totalMinutes % 60;
const totalHoursStr = `${hoursWorked}h ${minutesWorked}m`;
    const updated = await userDatamodel.findByIdAndUpdate(
      todayRecord._id,
      {
        Out_time: time,
        Out_time_outside: isOutside,
        Todays_Task: task,
        reason_for_task_delay: T_reason || "",
        remarks: remarks || "",
          total_hours: totalHoursStr,
      },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: isOutside
        ? "Out time marked — but you are outside office premises .send approval to your Head"
        : "Out time marked successfully",
      isOutside,
      distance_meters: Math.round(distance),
      attendance: updated,
    });

  } catch (error) {
    console.error("Out-Time error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});
router.post("/sendOutsideReason", rateLimiter, async (req, res) => {
  try {
    const { reason, type ,userId} = req.body; 
    if (!reason || !type) {
      return res.status(400).json({ message: "reason and type are required" });
    }
    if (type !== "In_Time" && type !== "Out_time") {
      return res.status(400).json({ message: "type must be 'In_Time' or 'Out_time'" });
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const todayRecord = await userDatamodel.findOne({
      id: userId,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    });
console.log(todayRecord)
    if (!todayRecord) {
      return res.status(404).json({ message: "No attendance record found for today" });
    }

   
    const isOutsideField = type === "In_Time" ? "In_time_outside" : "Out_time_outside";
    if (!todayRecord[isOutsideField]) {
      return res.status(400).json({ message: `${type} is not marked as outside` });
    }

    
    const reasonField = type === "In_Time" ? "In_Time_reason" : "Out_time_reason";
    await userDatamodel.findByIdAndUpdate(todayRecord._id, {
      [reasonField]: reason,
    });

   
    const currentUser = await usermodel.findById(userId);
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const head = await departments.findOne({
      Department: currentUser.Department,
    });

    if (!head) {
      return res.status(404).json({ message: "No head found for your department" });
    }

    const notificationRef = fire_db.ref(`notifications/${head.id}`).push();
    await notificationRef.set({
      from_user_id: userId.toString(),
      from_name: currentUser.Name,
      to_user_id: head._id.toString(),
      department: currentUser.Department,
      type,           
      reason,
      attendance_id: todayRecord._id.toString(),
      is_read: false,
      timestamp: Date.now(),
    });

    return res.status(200).json({
      success: true,
      message: "Reason saved and notification sent to head",
    });

  } catch (e) {
    console.error("sendOutsideReason error:", e);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: e.message,
    });
  }
});
router.get("/getDepartments",rateLimiter,async(req,res)=>{
  const allDepartment=await departments.find({}) .populate("headId", "Name Email");
  if(!allDepartment){
    return res.status(500).json({message:"internal server error"})
  }
  console.log(allDepartment)
  res.status(200).json({data:allDepartment})
  
})
router.put("/approveOutside", rateLimiter, async (req, res) => {
  try {
    const { attendanceId, employeeId, type, action, headId } = req.body;
 
    if (!attendanceId || !employeeId || !type || !action || !headId) {
      return res.status(400).json({ message: "attendanceId, employeeId, type, action and headId are required" });
    }

    if (type !== "In_Time" && type !== "Out_time") {
      return res.status(400).json({ message: "type must be 'In_Time' or 'Out_time'" });
    }

    if (action !== "approve" && action !== "reject") {
      return res.status(400).json({ message: "action must be 'approve' or 'reject'" });
    }
    const head = await usermodel.findById(headId);
    if (!head || head.Role !== "head") {
      return res.status(403).json({ message: "Unauthorized: only heads can approve" });
    }

    const attendance = await userDatamodel.findById(attendanceId);
    if (!attendance) {
      return res.status(404).json({ message: "Attendance record not found" });
    }

    const approvalField = type === "In_Time" ? "In_time_approved" : "Out_time_approved";
    const isApproved = action === "approve";

    const updated = await userDatamodel.findByIdAndUpdate(
      attendanceId,
      { [approvalField]: isApproved },
      { new: true }
    );

 
    const employee = await usermodel.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }


    const notificationRef = fire_db.ref(`notifications/${employeeId}`).push();
    await notificationRef.set({
      from_user_id: headId.toString(),
      from_name: head.Name,
      to_user_id: employeeId.toString(),
      to_name: employee.Name,
      type,                 
      action,            
      attendance_id: attendanceId.toString(),
      message: `Your ${type} outside request has been ${action}d by ${head.Name}`,
      is_read: false,
      timestamp: Date.now(),
    });

    return res.status(200).json({
      success: true,
      message: `${type} has been ${action}d successfully`,
      attendance: updated,
    });

  } catch (e) {
    console.error("approveOutside error:", e);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: e.message,
    });
  }
});
router.get("/outsideRequest", rateLimiter, async (req, res) => {
       console.log("came to outsideRequest")
  try {
 
    const { headId } = req.query;

    if (!headId) {
      return res.status(400).json({ message: "headId is required" });
    }

  
    const head = await usermodel.findById(headId);
    if (!head || head.Role !== "head") {
      return res.status(403).json({ message: "Unauthorized: only heads can view requests" });
    }

    const employees = await usermodel.find({
      Department: head.Department,
      Role: { $ne: "head" }, 
    }).select("_id Name Email");

    const employeeIds = employees.map((e) => e._id);

    
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const pendingRequests = await userDatamodel.find({
      id: { $in: employeeIds },
      createdAt: { $gte: startOfDay, $lte: endOfDay },
      $or: [
        { In_time_outside: true,  In_time_approved: false,  In_Time_reason: { $ne: "" } },
        { Out_time_outside: true, Out_time_approved: false, Out_time_reason: { $ne: "" } },
      ],
    });

    const result = pendingRequests.map((record) => {
      const employee = employees.find(
        (e) => e._id.toString() === record.id.toString()
      );
      return {
        attendanceId: record._id,
        employeeId:   record.id,
        employeeName: employee?.Name || "Unknown",
        employeeEmail: employee?.Email || "Unknown",
        In_Time:          record.In_Time,
        In_Time_reason:   record.In_Time_reason,
        In_time_outside:  record.In_time_outside,
        In_time_approved: record.In_time_approved,
        Out_time:          record.Out_time,
        Out_time_reason:   record.Out_time_reason,
        Out_time_outside:  record.Out_time_outside,
        Out_time_approved: record.Out_time_approved,
        date: record.createdAt,
      };
    });

    return res.status(200).json({
      success: true,
      total: result.length,
      requests: result,
    });

  } catch (e) {
    console.error("outsideRequest error:", e);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: e.message,
    });
  }
});
router.get("/get_emp_status", rateLimiter, async (req, res) => {
  console.log("came to get emp status");

  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ message: "User ID is required" });
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const check = await userDatamodel.findOne({
    id: userId,
    createdAt: {
      $gte: startOfDay,
      $lte: endOfDay,
    },
  });

  if (!check) {
    return res.status(202).json({ message: "Today you didn't provide attendance" });
  }

  if (!check.Out_time) {
    // FIXED: Added 'data: check' so the frontend can read the In_Time!
    return res.status(203).json({ 
      message: "Today you didn't provide out time",
      data: check 
    });
  }

  return res.status(200).json({
    success: true,
    data: check,
  });
});
router.post("/addDepartment",rateLimiter,async(req,res)=>{
try{
      const{deptName,headId,deptId}=req.body
if(!deptName||!headId||!deptId){
  return res.status(400).json({message:"all feilds are required"})
}
const addDept=await departments.create({
  headId:headId,
      deptId:deptId,

  Department:deptName
})
if(!addDept){
  res.status(400).json({message:"error at adding data in departments"})
}
res.status(201).json({message:"successfully added department"})
}catch (error) {
    console.error("In-Time error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }

})
module.exports = router;
