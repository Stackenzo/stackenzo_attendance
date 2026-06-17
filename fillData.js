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
    const { lat, lng, time, task, T_reason, remarks, userId } = req.body;

    if (!lat || !lng || !time || !task || !userId) {
      return res.status(400).json({ message: "lat, lng, time, task and userId are required" });
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

    // ✅ Robust time parser — handles "6:11 PM", "06:11 PM", "12:00 AM", "12:00 PM"
    const parseTimeToMinutes = (timeStr) => {
      const cleaned = timeStr.trim().replace(/\s+/g, " "); // remove extra spaces
      const match = cleaned.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);

      if (!match) {
        console.error("Invalid time format:", JSON.stringify(timeStr));
        return null;
      }

      let hours = parseInt(match[1], 10);
      let minutes = parseInt(match[2], 10);
      const modifier = match[3].toUpperCase();

      if (modifier === "PM" && hours !== 12) hours += 12;
      if (modifier === "AM" && hours === 12) hours = 0;

      return hours * 60 + minutes;
    };

    const inMinutes = parseTimeToMinutes(todayRecord.In_Time);
    const outMinutes = parseTimeToMinutes(time);

    console.log("In_Time raw :", JSON.stringify(todayRecord.In_Time));
    console.log("Out_Time raw:", JSON.stringify(time));
    console.log("inMinutes:", inMinutes, "| outMinutes:", outMinutes);

    if (inMinutes === null || outMinutes === null) {
      return res.status(400).json({ message: "Invalid time format. Expected format: '6:11 PM'" });
    }

    if (outMinutes <= inMinutes) {
      return res.status(400).json({ message: "Out time must be after In time" });
    }

    const totalMinutes = outMinutes - inMinutes;
    const hoursWorked = Math.floor(totalMinutes / 60);
    const minutesWorked = totalMinutes % 60;
    const totalHoursStr = `${hoursWorked}h ${minutesWorked}m`;

    console.log("totalHoursStr:", totalHoursStr);

    const updated = await userDatamodel.findByIdAndUpdate(
      todayRecord._id,
      {
        Out_time: time.trim(),
        Out_time_outside: isOutside,
        Todays_Task: task,
        reason_for_task_delay: T_reason || "",
        remarks: remarks || "",
        total_hours: totalHoursStr,
      },
      { returnDocument: "after" }
    );

    return res.status(200).json({
      success: true,
      message: isOutside
        ? "Out time marked — but you are outside office premises. Send approval to your Head"
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

    const notificationRef = fire_db.ref(`notifications/${head.headId}`).push();
    await notificationRef.set({
      from_user_id: userId.toString(),
      from_name: currentUser.Name,
      to_user_id: head.headId.toString(),
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
    if (attendance[approvalField]) {
  return res.status(400).json({
    success: false,
    message: `${type} has already been approved`,
  });
}
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
// router.get("/get_emp_status", rateLimiter, async (req, res) => {

//   console.log("came to get emp status");

//   const { userId } = req.query;

//   if (!userId) {
//     return res.status(400).json({ message: "User ID is required" });
//   }

//   const startOfDay = new Date();
//   startOfDay.setHours(0, 0, 0, 0);
//   const endOfDay = new Date();
//   endOfDay.setHours(23, 59, 59, 999);

//   const check = await userDatamodel.findOne({
//     id: userId,
//     createdAt: {
//       $gte: startOfDay,
//       $lte: endOfDay,
//     },
//   });

//   if (!check) {
//     return res.status(202).json({ message: "Today you didn't provide attendance" });
//   }

//   if (!check.Out_time) {
//     // FIXED: Added 'data: check' so the frontend can read the In_Time!
//     return res.status(203).json({ 
//       message: "Today you didn't provide out time",
//       data: check 
//     });
//   }

//   return res.status(200).json({
//     success: true,
//     data: check,
//   });
// });
router.get("/get_emp_status", rateLimiter, async (req, res) => {
  console.log("came to get emp status");

  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "User ID is required",
    });
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  try {
    const check = await userDatamodel.findOne({
      id: userId,
      createdAt: {
        $gte: startOfDay,
        $lte: endOfDay,
      },
    });

    // No attendance at all
    if (!check) {
      return res.status(200).json({
        success: true,
        message: "Today attendance not taken",
      });
    }

    // Attendance taken but approval pending
    if (
      (check.In_time_outside && !check.In_time_approved) ||
      (check.Out_time_outside && !check.Out_time_approved)
    ) {
      return res.status(200).json({
        success: true,
        message: "Attendance is taken but not approved",
        data: check,
      });
    }

    // In-time taken, Out-time not taken
    if (check.In_Time && !check.Out_time) {
      return res.status(200).json({
        success: true,
        message: "In time is taken, out time is not taken",
        data: check,
      });
    }

    // Both taken
    if (check.In_Time && check.Out_time) {
      return res.status(200).json({
        success: true,
        message: "Today's attendance completed",
        data: check,
      });
    }

    // Fallback
    return res.status(200).json({
      success: true,
      message: "Attendance status unavailable",
      data: check,
    });
  } catch (error) {
    console.error("get_emp_status error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
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
router.post("/getAttendance", rateLimiter, async (req, res) => {
  try {
    const { userId, filter } = req.body; // filter: "today" | "week" | "month" | "all"

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    let dateFilter = {};

    if (filter === "today") {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      dateFilter = { createdAt: { $gte: startOfDay, $lte: endOfDay } };

    } else if (filter === "week") {
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - 7);
      startOfWeek.setHours(0, 0, 0, 0);
      dateFilter = { createdAt: { $gte: startOfWeek } };

    } else if (filter === "month") {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      dateFilter = { createdAt: { $gte: startOfMonth } };
    }


    const attendance = await userDatamodel
      .find({ id: userId, ...dateFilter })
      .sort({ createdAt: -1 }); 

    if (!attendance || attendance.length === 0) {
      return res.status(404).json({ message: "No attendance records found" });
    }

    const totalDays = attendance.length;
    const totalHoursWorked = attendance.reduce((acc, record) => {
      if (!record.total_hours) return acc;
      const match = record.total_hours.match(/(\d+)h\s(\d+)m/);
      if (!match) return acc;
      return acc + parseInt(match[1]) * 60 + parseInt(match[2]);
    }, 0);

    const avgMinutesPerDay = totalDays > 0 ? Math.round(totalHoursWorked / totalDays) : 0;

   return res.status(200).json({
  success: true,
  total_days: totalDays,
  total_hours: `${Math.floor(totalHoursWorked / 60)}h ${totalHoursWorked % 60}m`,
  avg_per_day: `${Math.floor(avgMinutesPerDay / 60)}h ${avgMinutesPerDay % 60}m`,
  attendance: attendance.map((record) => ({
    _id: record._id,
    id: record.id,

    date: record.createdAt.toLocaleDateString("en-IN"),

    In_Time: record.In_Time,
    delay_in_reason: record.delay_in_reason,
    In_Time_reason: record.In_Time_reason,
    In_time_outside: record.In_time_outside,
    In_time_approved: record.In_time_approved,

    Out_time: record.Out_time,
    Out_time_reason: record.Out_time_reason,
    Out_time_outside: record.Out_time_outside,
    Out_time_approved: record.Out_time_approved,

    Todays_Task: record.Todays_Task,
    reason_for_task_delay: record.reason_for_task_delay,
    remarks: record.remarks,

    total_hours: record.total_hours,

    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }))
});

  } catch (error) {
    console.error("getAttendance error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});
module.exports = router;
