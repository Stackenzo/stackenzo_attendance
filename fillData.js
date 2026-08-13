const express = require("express");
const router = express.Router();

const {createJwt,veriftJWT}=require("./jwt")
const {usermodel,userDatamodel,departments,fire_db, }=require("./db");
const {redis}=require("./DB/redis")
const {pool}=require("./DB/psql")
const rateLimiter = require("./rateLimiter");
const { messaging } = require("firebase-admin");

const OFFICE_LAT = 14.435987;   
const OFFICE_LNG = 79.991139;
const ALLOWED_RADIUS_METERS = 200; 
async function checkLate(time) {
const checkInTime = new Date(time);

const hours = checkInTime.getHours();
const minutes = checkInTime.getMinutes();

const totalMinutes = hours * 60 + minutes;

const lateLimit = 10 * 60 + 30; 

if(totalMinutes > lateLimit){
    return true
} 
   
return false
}

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
router.post("/in-timeCCTV", rateLimiter, async (req, res) => {
    try {
        const { time, userId } = req.body;

        console.log("time:", time);
        console.log("userId:", userId);

        // Temporary CCTV location
        const lat = 14.435987;
        const lng = 79.991139;

        if (!time || !userId) {
            return res.status(400).json({
                success: false,
                message: "userId and time are required"
            });
        }

        // Find member
        const memberResult = await pool.query(
            `
            SELECT
                id,
                name,
                emp_id
            FROM members
            WHERE id = $1
            LIMIT 1
            `,
            [userId]
        );

        const member = memberResult.rows[0];

        if (!member) {
            console.log("User not found:", userId);

            return res.status(401).json({
                success: false,
                message: "User not found"
            });
        }

        // Check today's attendance
        const existingAttendance = await pool.query(
            `
            SELECT *
            FROM members_daily_data
            WHERE member_id = $1
              AND attendance_date = CURRENT_DATE
            LIMIT 1
            `,
            [member.id]
        );

        if (existingAttendance.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Attendance already marked for today"
            });
        }

        // Create attendance
        const attendanceResult = await pool.query(
            `
            INSERT INTO members_daily_data (
                member_id,
                attendance_date,
                in_time,
                in_time_outside,
                in_time_outside_approved,
                in_time_late,
                out_time_outside,
                out_time_outside_approved,
                out_time_permission,
                out_time_permission_approved,
                in_latitude,
                in_longitude,
                cctv_in
               
            )
            VALUES (
                $1,
                CURRENT_DATE,
                $2,
                FALSE,
                FALSE,
                FALSE,
                FALSE,
                FALSE,
                FALSE,
                FALSE,
                $3,
                $4,
                TRUE
            )
            RETURNING *
            `,
            [
                member.id,
                time,
                lat,
                lng
            ]
        );

        const attendance = attendanceResult.rows[0];


        return res.status(201).json({
            success: true,
            message: "Attendance marked successfully",
            attendance
        });

    } catch (error) {

        console.error("In-Time error:", error);

        // PostgreSQL unique constraint
        if (error.code === "23505") {
            return res.status(400).json({
                success: false,
                message: "Attendance already marked for today"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});
router.post("/out-timeCCTV", rateLimiter, async (req, res) => {
    try {
        const { time, userId } = req.body;

        console.log("time:", time);
        console.log("userId:", userId);

        if (!time || !userId) {
            return res.status(400).json({
                success: false,
                message: "time and userId are required"
            });
        }

        // Temporary CCTV location
        const lat = 14.435987;
        const lng = 79.991139;

        // Find member
        const memberResult = await pool.query(
            `
            SELECT id, name, emp_id
            FROM members
            WHERE id = $1
            LIMIT 1
            `,
            [userId]
        );

        const member = memberResult.rows[0];

        if (!member) {
            console.log("User not found:", userId);

            return res.status(401).json({
                success: false,
                message: "User not found"
            });
        }

        // Get today's attendance
        const attendanceResult = await pool.query(
            `
            SELECT *
            FROM members_daily_data
            WHERE member_id = $1
              AND attendance_date = CURRENT_DATE
            LIMIT 1
            `,
            [member.id]
        );

        const todayRecord = attendanceResult.rows[0];

        if (!todayRecord || !todayRecord.in_time) {
            return res.status(400).json({
                success: false,
                message: "In time is not recorded for today"
            });
        }

        if (todayRecord.out_time) {
            return res.status(400).json({
                success: false,
                message: "Out time already marked for today"
            });
        }

      
        const parseTimeToMinutes = (timeStr) => {
            const cleaned = timeStr
                .trim()
                .replace(/\s+/g, " ");

            const match = cleaned.match(
                /^(\d{1,2}):(\d{2})\s?(AM|PM)$/i
            );

            if (!match) {
                console.error(
                    "Invalid time format:",
                    JSON.stringify(timeStr)
                );

                return null;
            }

            let hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            const modifier = match[3].toUpperCase();

            if (hours < 1 || hours > 12 || minutes > 59) {
                return null;
            }

            if (modifier === "PM" && hours !== 12) {
                hours += 12;
            }

            if (modifier === "AM" && hours === 12) {
                hours = 0;
            }

            return hours * 60 + minutes;
        };

        const outMinutes = parseTimeToMinutes(time);

        if (outMinutes === null) {
            return res.status(400).json({
                success: false,
                message:
                    "Invalid time format. Expected format: '6:11 PM'"
            });
        }

        /*
         * Compare with PostgreSQL's stored IN time.
         */
        const inTime = new Date(todayRecord.in_time);

        const inMinutes =
            inTime.getHours() * 60 +
            inTime.getMinutes();

        if (outMinutes <= inMinutes) {
            return res.status(400).json({
                success: false,
                message: "Out time must be after In time"
            });
        }

        /*
         * Calculate total worked minutes.
         */
        const totalMinutes = outMinutes - inMinutes;

        const hoursWorked = Math.floor(totalMinutes / 60);
        const minutesWorked = totalMinutes % 60;

        const totalHoursStr =
            `${hoursWorked}h ${minutesWorked}m`;

        console.log("Total hours:", totalHoursStr);

        /*
         * Create today's OUT timestamp.
         *
         * Use today's date + received time.
         */
        const today = new Date();

        const outDate = new Date(
            today.getFullYear(),
            today.getMonth(),
            today.getDate(),
            Math.floor(outMinutes / 60),
            outMinutes % 60,
            0,
            0
        );

        /*
         * Update attendance.
         */
        const updateResult = await pool.query(
            `
            UPDATE members_daily_data
            SET
                out_time = $1,
                out_time_outside = FALSE,
                cctv_out = TRUE,

                out_latitude = $2,
                out_longitude = $3,

                total_hours_worked =
                    ($1::timestamptz - in_time),

                updated_at = NOW()

            WHERE id = $4

            RETURNING *
            `,
            [
                outDate,
                lat,
                lng,
                todayRecord.id
            ]
        );

        const updated = updateResult.rows[0];

        return res.status(200).json({
            success: true,
            message: "Out time marked successfully",
            attendance: updated
        });

    } catch (error) {

        console.error("Out-Time error:", error);

        return res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});
router.post("/in-time", rateLimiter, async (req, res) => {
    try {

        const {
            lat,
            lng,
            time,
            userId,
            delay_in_reason
        } = req.body;

        // =========================
        // VALIDATION
        // =========================

        if (
            lat === undefined ||
            lng === undefined ||
            !userId ||
            !time
        ) {
            return res.status(400).json({
                success: false,
                message: "lat, lng, userId and time are required"
            });
        }

        // =========================
        // VALIDATE TIME
        // =========================

        const inputTime = new Date(time);

        if (Number.isNaN(inputTime.getTime())) {
            return res.status(400).json({
                success: false,
                message: "Invalid time format"
            });
        }

        /*
         * Make sure the frontend sends timezone information.
         *
         * Correct:
         * 2026-08-12T05:00:00+05:30
         *
         * Avoid:
         * 2026-08-12T05:00:00
         */

        // =========================
        // FIND MEMBER
        // =========================

        const memberResult = await pool.query(
            `
            SELECT
                id,
                name,
                emp_id
            FROM members
            WHERE id = $1
            LIMIT 1
            `,
            [userId]
        );

        const member = memberResult.rows[0];

        if (!member) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // =========================
        // GET TODAY'S DATE IN IST
        // =========================

        /*
         * Do NOT use CURRENT_DATE here if your PostgreSQL
         * server timezone is UTC.
         *
         * We want the attendance date according to India.
         */

        const attendanceDateResult = await pool.query(
            `
            SELECT
                ($1::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
                AS attendance_date
            `,
            [time]
        );

        const attendanceDate =
            attendanceDateResult.rows[0].attendance_date;

        // =========================
        // CHECK EXISTING ATTENDANCE
        // =========================

        const existingAttendance =
            await pool.query(
                `
                SELECT *
                FROM members_daily_data
                WHERE member_id = $1
                  AND attendance_date = $2
                LIMIT 1
                `,
                [
                    member.id,
                    attendanceDate
                ]
            );

        if (existingAttendance.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message:
                    "Attendance already marked for today"
            });
        }

        // =========================
        // CALCULATE DISTANCE
        // =========================

        const distance =
            getDistanceInMeters(
                parseFloat(lat),
                parseFloat(lng),
                OFFICE_LAT,
                OFFICE_LNG
            );

        const isOutside =
            distance > ALLOWED_RADIUS_METERS;

        // =========================
        // CHECK LATE
        // =========================

        const isLate =
            await checkLate(time);

        if (isLate && !delay_in_reason) {
            return res.status(400).json({
                success: false,
                message:
                    "You are late to office. Please enter the delay reason to continue."
            });
        }

        // =========================
        // CREATE ATTENDANCE
        // =========================

        const attendanceResult =
            await pool.query(
                `
                INSERT INTO members_daily_data (
                    member_id,
                    attendance_date,
                    in_time,
                    in_time_outside,
                    in_time_outside_approved,
                    in_time_outside_reason,
                    in_time_late,
                    in_time_late_reason,
                    in_latitude,
                    in_longitude,
                    cctv_in
                )
                VALUES (
                    $1,
                    $2::date,

                    /*
                     * IMPORTANT:
                     * Keep timezone information.
                     */
                    $3::timestamptz,

                    $4,
                    FALSE,
                    $5,

                    $6,
                    $7,

                    $8,
                    $9,

                    FALSE
                )
                RETURNING *
                `,
                [
                    member.id,

                    // Attendance date in IST
                    attendanceDate,

                    // Original timezone-aware timestamp
                    time,

                    isOutside,

                    isOutside
                        ? "Outside office premises"
                        : null,

                    isLate,

                    delay_in_reason || null,

                    parseFloat(lat),
                    parseFloat(lng)
                ]
            );

        const attendance =
            attendanceResult.rows[0];

        // =========================
        // RESPONSE
        // =========================

        return res.status(201).json({

            success: true,

            message:
                isOutside
                    ? "Attendance marked — but you are outside office premises. Send approval to your Head"
                    : "Attendance marked successfully",

            isOutside,

            isLate,

            distance_meters:
                Math.round(distance),

            attendance
        });

    } catch (error) {

        console.error(
            "In-Time error:",
            error
        );

        // PostgreSQL unique constraint
        if (error.code === "23505") {
            return res.status(400).json({
                success: false,
                message:
                    "Attendance already marked for today"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});
router.post("/out-time", rateLimiter, async (req, res) => {
    try {

        const {
            lat,
            lng,
            time,
            task,
            T_reason,
            remarks,
            userId,
            early_going_reason
        } = req.body;

        // =========================
        // VALIDATION
        // =========================

        if (
            lat === undefined ||
            lng === undefined ||
            !userId ||
            !time ||
            !task
        ) {
            return res.status(400).json({
                success: false,
                message: "lat, lng, time, userId and task are required"
            });
        }

        // =========================
        // VALIDATE OUT TIME
        // =========================

        const outTime = new Date(time);

        if (Number.isNaN(outTime.getTime())) {
            return res.status(400).json({
                success: false,
                message: `Invalid out time ${time}`
            });
        }

        // =========================
        // FIND MEMBER
        // =========================

        const memberResult = await pool.query(
            `
            SELECT
                id,
                name,
                emp_id
            FROM members
            WHERE id = $1
            LIMIT 1
            `,
            [userId]
        );

        const member = memberResult.rows[0];

        if (!member) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // =========================
        // GET TODAY'S ATTENDANCE
        // =========================

        const attendanceResult = await pool.query(
            `
            SELECT *
            FROM members_daily_data
            WHERE member_id = $1
              AND attendance_date = CURRENT_DATE
            LIMIT 1
            `,
            [member.id]
        );

        const todayRecord = attendanceResult.rows[0];

        if (!todayRecord) {
            return res.status(400).json({
                success: false,
                message: "Today's attendance record not found"
            });
        }

        if (!todayRecord.in_time) {
            return res.status(400).json({
                success: false,
                message: "In time is not recorded for today"
            });
        }

        if (todayRecord.out_time) {
            return res.status(400).json({
                success: false,
                message: "Out time already marked for today"
            });
        }

        // =========================
        // CHECK TIME
        // =========================

        const inTime = new Date(todayRecord.in_time);

        if (Number.isNaN(inTime.getTime())) {
            return res.status(500).json({
                success: false,
                message: "Invalid in time stored in database"
            });
        }

        const differenceMs =
            outTime.getTime() -
            inTime.getTime();

        const totalMinutes =
            Math.floor(
                differenceMs / (1000 * 60)
            );

        // =========================
        // OUT TIME BEFORE IN TIME
        // =========================

        if (differenceMs < 0) {

            console.log("TIME MISMATCH");

            console.log(
                "DB In Time:",
                todayRecord.in_time
            );

            console.log(
                "Parsed In Time:",
                inTime.toISOString()
            );

            console.log(
                "Received Out Time:",
                time
            );

            console.log(
                "Parsed Out Time:",
                outTime.toISOString()
            );

            return res.status(400).json({
                success: false,
                message: "Out time cannot be before in time",

                debug: {
                    in_time:
                        inTime.toISOString(),

                    out_time:
                        outTime.toISOString(),

                    difference_minutes:
                        totalMinutes
                }
            });
        }

        // =========================
        // EARLY GOING
        // =========================

        const isEarlyGoing =
            totalMinutes < (8 * 60);

        if (
            isEarlyGoing &&
            !early_going_reason
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "You are leaving early. Please mention a reason."
            });
        }

        // =========================
        // DISTANCE
        // =========================

        const distance =
            getDistanceInMeters(
                parseFloat(lat),
                parseFloat(lng),
                OFFICE_LAT,
                OFFICE_LNG
            );

        const isOutside =
            distance > ALLOWED_RADIUS_METERS;

        // =========================
        // UPDATE OUT TIME
        // =========================

        const updatedResult =
            await pool.query(
                `
                UPDATE members_daily_data
                SET
                    out_time = $1,
                    out_time_outside = $2,
                    todays_task = $3,
                    reason_for_task_delay = $4,
                    remarks = $5,
                    out_latitude = $6,
                    out_longitude = $7,
                    early_going = $8,
                    early_going_reason = $9,
                    early_going_approved = FALSE,
                    updated_at = NOW()

                WHERE id = $10

                RETURNING *
                `,
                [
                    outTime,
                    isOutside,
                    task || null,
                    T_reason || null,
                    remarks || null,
                    parseFloat(lat),
                    parseFloat(lng),
                    isEarlyGoing,
                    isEarlyGoing
                        ? early_going_reason
                        : null,
                    todayRecord.id
                ]
            );

        // =========================
        // CALCULATE TOTAL HOURS
        // =========================

        const totalHoursResult =
            await pool.query(
                `
                UPDATE members_daily_data
                SET
                    total_hours_worked =
                        out_time - in_time,

                    updated_at = NOW()

                WHERE id = $1

                RETURNING *
                `,
                [todayRecord.id]
            );

        const finalAttendance =
            totalHoursResult.rows[0];

        // =========================
        // RESPONSE
        // =========================

        return res.status(200).json({

            success: true,

            message:
                isEarlyGoing
                    ? "Out time marked — early going request submitted for approval"
                    : isOutside
                        ? "Out time marked — but you are outside office premises. Send approval to your Head"
                        : "Out time marked successfully",

            isOutside,

            early_going:
                isEarlyGoing,

            distance_meters:
                Math.round(distance),

            attendance:
                finalAttendance
        });

    } catch (error) {

        console.error(
            "Out-Time error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});
router.post("/sendOutsideReason", rateLimiter, async (req, res) => {
    try {
        const {
            reason,
            type,
            userId
        } = req.body;

        if (!reason || !type || !userId) {
            return res.status(400).json({
                success: false,
                message: "reason, type and userId are required"
            });
        }

        if (
            type !== "In_Time" &&
            type !== "Out_time"
        ) {
            return res.status(400).json({
                success: false,
                message: "type must be 'In_Time' or 'Out_time'"
            });
        }

        /*
         * Find today's attendance
         */
        const attendanceResult = await pool.query(
            `
            SELECT *
            FROM members_daily_data
            WHERE member_id = $1
              AND attendance_date = CURRENT_DATE
            LIMIT 1
            `,
            [userId]
        );

        const todayRecord = attendanceResult.rows[0];

        console.log("Today's attendance:", todayRecord);

        if (!todayRecord) {
            return res.status(404).json({
                success: false,
                message: "No attendance record found for today"
            });
        }

        /*
         * Determine which reason field to update
         */
        const reasonField =
            type === "In_Time"
                ? "in_time_outside_reason"
                : "out_time_outside_reason";

        /*
         * Update reason
         *
         * We cannot parameterize column names using $1,
         * so we select the column ourselves from a
         * controlled value above.
         */
        const updateQuery = `
            UPDATE members_daily_data
            SET
                ${reasonField} = $1,
                updated_at = NOW()
            WHERE id = $2
            RETURNING *
        `;

        const updatedResult = await pool.query(
            updateQuery,
            [
                reason.trim(),
                todayRecord.id
            ]
        );

        const updatedAttendance =
            updatedResult.rows[0];

        const memberResult = await pool.query(
            `
            SELECT
                m.id,
                m.name,
                m.emp_id,
                m.department_id,
                d.name AS department,
                d.head_id
            FROM members m
            LEFT JOIN departments d
                ON m.department_id = d.id
            WHERE m.id = $1
            LIMIT 1
            `,
            [userId]
        );

        const currentUser =
            memberResult.rows[0];

        if (!currentUser) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        /*
         * Check department head
         */
        if (!currentUser.head_id) {
            return res.status(404).json({
                success: false,
                message:
                    "No head found for your department"
            });
        }

        /*
         * Send Firebase notification
         */
        const notificationRef = fire_db
            .ref(`notifications/${currentUser.head_id}`)
            .push();

        await notificationRef.set({
            from_user_id: currentUser.id.toString(),

            from_name: currentUser.name,

            to_user_id:
                currentUser.head_id.toString(),

            department:
                currentUser.department,

            type,

            reason,

            attendance_id:
                todayRecord.id.toString(),

            is_read: false,

            timestamp: Date.now()
        });

        return res.status(200).json({
            success: true,
            message:
                "Reason saved and notification sent to head"
        });

    } catch (error) {

        console.error(
            "sendOutsideReason error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});
router.get("/getDepartments", rateLimiter, async (req, res) => {
    try {

        const result = await pool.query(
            `
            SELECT
                d.id,
                d.dept_id,
                d.name,
                d.created_at,
                d.updated_at,

                m.id AS head_id,
                m.name AS head_name,
                m.email AS head_email

            FROM departments d

            LEFT JOIN members m
                ON d.head_id = m.id

            ORDER BY d.name ASC
            `
        );

        return res.status(200).json({
            data: result.rows
        });

    } catch (error) {

        console.error(
            "getDepartments error:",
            error
        );

        return res.status(500).json({
            message: "Internal server error"
        });
    }
});
router.put("/approveOutside", rateLimiter, async (req, res) => {
    try {
        const {
            attendanceId,
            employeeId,
            type,
            action,
            headId,
            NotificationId
        } = req.body;

        console.log("attendanceId:", attendanceId);

        if (
            !attendanceId ||
            !employeeId ||
            !type ||
            !action ||
            !headId
        ) {
            return res.status(400).json({
                message:
                    "attendanceId, employeeId, type, action and headId are required"
            });
        }

        if (
            type !== "In_Time" &&
            type !== "Out_time"
        ) {
            return res.status(400).json({
                message:
                    "type must be 'In_Time' or 'Out_time'"
            });
        }

        if (
            action !== "approve" &&
            action !== "reject"
        ) {
            return res.status(400).json({
                message:
                    "action must be 'approve' or 'reject'"
            });
        }

        /*
         * Get the head and verify role
         */
        const headResult = await pool.query(
            `
            SELECT
                id,
                name,
                email,
                role
            FROM members
            WHERE id = $1
            LIMIT 1
            `,
            [headId]
        );

        const head = headResult.rows[0];

        if (!head || head.role !== "head") {
            return res.status(403).json({
                message:
                    "Unauthorized: only heads can approve"
            });
        }

        /*
         * Get attendance + employee + department
         */
        const attendanceResult = await pool.query(
            `
            SELECT
                a.*,

                m.id AS employee_id,
                m.name AS employee_name,
                m.email AS employee_email,
                m.department_id,

                d.name AS department_name,
                d.head_id AS department_head_id

            FROM members_daily_data a

            JOIN members m
                ON a.member_id = m.id

            LEFT JOIN departments d
                ON m.department_id = d.id

            WHERE a.id = $1
              AND a.member_id = $2

            LIMIT 1
            `,
            [
                attendanceId,
                employeeId
            ]
        );

        const attendance =
            attendanceResult.rows[0];

        if (!attendance) {
            return res.status(404).json({
                message:
                    "Attendance record not found"
            });
        }

        /*
         * Make sure the supplied head is actually
         * the head of this employee's department.
         */
        if (
            !attendance.department_head_id ||
            attendance.department_head_id !== head.id
        ) {
            return res.status(403).json({
                message:
                    "Unauthorized: you are not the head of this employee's department"
            });
        }

        /*
         * Determine approval column
         */
        const approvalField =
            type === "In_Time"
                ? "in_time_outside_approved"
                : "out_time_outside_approved";

        /*
         * Check whether already approved
         */
        if (attendance[approvalField]) {
            return res.status(400).json({
                success: false,
                message:
                    `${type} has already been approved`
            });
        }

        const isApproved =
            action === "approve";

        /*
         * Update approval
         */
        const updateResult = await pool.query(
            `
            UPDATE members_daily_data
            SET
                ${approvalField} = $1,
                updated_at = NOW()
            WHERE id = $2
            RETURNING *
            `,
            [
                isApproved,
                attendanceId
            ]
        );

        const updated =
            updateResult.rows[0];

        /*
         * Send notification to employee
         */
        const notificationRef = fire_db
            .ref(`notifications/${employeeId}`)
            .push();

        await notificationRef.set({
            from_user_id:
                head.id.toString(),

            from_name:
                head.name,

            to_user_id:
                employeeId.toString(),

            to_name:
                attendance.employee_name,

            type,

            action,

            attendance_id:
                attendanceId.toString(),

            message:
                `Your ${type} outside request has been ${action}d by ${head.name}`,

            is_read: false,

            timestamp: Date.now()
        });

        /*
         * Remove notification from head
         */
        if (NotificationId) {
            await fire_db
                .ref(
                    `notifications/${headId}/${NotificationId}`
                )
                .remove();
        }

        return res.status(200).json({
            success: true,

            message:
                `${type} has been ${action}d successfully`,

            attendance: updated
        });

    } catch (error) {

        console.error(
            "approveOutside error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});
router.get("/outsideRequest", rateLimiter, async (req, res) => {
    console.log("came to outsideRequest");

    try {
        const { headId } = req.query;

        if (!headId) {
            return res.status(400).json({
                message: "headId is required"
            });
        }

        /*
         * Verify that the user is actually a department head
         * and get their department.
         */
        const headResult = await pool.query(
            `
            SELECT
                m.id,
                m.name,
                m.email,
                m.role,
                m.department_id,
                d.name AS department_name
            FROM members m
            JOIN departments d
                ON m.department_id = d.id
            WHERE m.id = $1
              AND LOWER(m.role) = 'head'
              AND d.head_id = m.id
            LIMIT 1
            `,
            [headId]
        );

        const head = headResult.rows[0];

        if (!head) {
            return res.status(403).json({
                message:
                    "Unauthorized: only heads can view requests"
            });
        }

        /*
         * Get today's pending outside requests
         * belonging to employees of this head's department.
         */
        const requestsResult = await pool.query(
            `
            SELECT
                a.id AS attendance_id,

                m.id AS employee_id,
                m.name AS employee_name,
                m.email AS employee_email,

                a.in_time,
                a.in_time_outside_reason,
                a.in_time_outside,
                a.in_time_outside_approved,

                a.out_time,
                a.out_time_outside_reason,
                a.out_time_outside,
                a.out_time_outside_approved,

                a.attendance_date,
                a.created_at,
                a.updated_at

            FROM members_daily_data a

            JOIN members m
                ON a.member_id = m.id

            WHERE m.department_id = $1

              AND LOWER(m.role) <> 'head'

              AND a.attendance_date = CURRENT_DATE

              AND (
                    (
                        a.in_time_outside = TRUE
                        AND a.in_time_outside_approved = FALSE
                        AND a.in_time_outside_reason IS NOT NULL
                        AND TRIM(a.in_time_outside_reason) <> ''
                    )

                    OR

                    (
                        a.out_time_outside = TRUE
                        AND a.out_time_outside_approved = FALSE
                        AND a.out_time_outside_reason IS NOT NULL
                        AND TRIM(a.out_time_outside_reason) <> ''
                    )
              )

            ORDER BY a.created_at DESC
            `,
            [head.department_id]
        );

        const result = requestsResult.rows.map((record) => ({
            attendanceId: record.attendance_id,

            employeeId: record.employee_id,

            employeeName:
                record.employee_name || "Unknown",

            employeeEmail:
                record.employee_email || "Unknown",

            In_Time: record.in_time,

            In_Time_reason:
                record.in_time_outside_reason,

            In_time_outside:
                record.in_time_outside,

            In_time_approved:
                record.in_time_outside_approved,

            Out_time: record.out_time,

            Out_time_reason:
                record.out_time_outside_reason,

            Out_time_outside:
                record.out_time_outside,

            Out_time_approved:
                record.out_time_outside_approved,

            date: record.created_at
        }));

        return res.status(200).json({
            success: true,
            total: result.length,
            requests: result
        });

    } catch (error) {

        console.error(
            "outsideRequest error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});
router.get("/get_emp_status", rateLimiter, async (req, res) => {


    const { userId } = req.query;
console.log(userId)
    if (!userId) {
        return res.status(400).json({
            success: false,
            message: "User ID is required"
        });
    }

    try {
        const result = await pool.query(
            `
            SELECT
                a.*,

                m.name AS member_name,
                m.emp_id,
                m.email,
                m.role,

                d.name AS department

            FROM members_daily_data a

            JOIN members m
                ON a.member_id = m.id

            LEFT JOIN departments d
                ON m.department_id = d.id

            WHERE a.member_id = $1
              AND a.attendance_date = CURRENT_DATE

            LIMIT 1
            `,
            [userId]
        );

        const check = result.rows[0];

        /*
         * No attendance today
         */
        if (!check) {
            return res.status(200).json({
                success: true,
                message: "Today attendance not taken"
            });
        }

        /*
         * Outside attendance approval pending
         */
        if (
            (
                check.in_time_outside &&
                !check.in_time_outside_approved
            ) ||
            (
                check.out_time_outside &&
                !check.out_time_outside_approved
            )
        ) {
            return res.status(200).json({
                success: true,
                message:
                    "Attendance is taken but not approved",
                data: check
            });
        }

        /*
         * IN taken but OUT not taken
         */
        if (
            check.in_time &&
            !check.out_time
        ) {
            return res.status(200).json({
                success: true,
                message:
                    "In time is taken, out time is not taken",
                data: check
            });
        }

        /*
         * Both IN and OUT taken
         */
        if (
            check.in_time &&
            check.out_time
        ) {
            return res.status(200).json({
                success: true,
                message:
                    "Today's attendance completed",
                data: check
            });
        }

        /*
         * Fallback
         */
        return res.status(200).json({
            success: true,
            message:
                "Attendance status unavailable",
            data: check
        });

    } catch (error) {

        console.error(
            "get_emp_status error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});
router.post("/addDepartment", rateLimiter, async (req, res) => {
    try {
        const {
            deptName,
            headId,
            deptId
        } = req.body;

        if (!deptName || !headId || !deptId) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        /*
         * Check whether the department ID already exists
         */
        const existingDepartment = await pool.query(
            `
            SELECT id
            FROM departments
            WHERE dept_id = $1
            LIMIT 1
            `,
            [deptId]
        );

        if (existingDepartment.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Department ID already exists"
            });
        }

        /*
         * Check whether the department name already exists
         */
        const existingName = await pool.query(
            `
            SELECT id
            FROM departments
            WHERE LOWER(name) = LOWER($1)
            LIMIT 1
            `,
            [deptName.trim()]
        );

        if (existingName.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Department already exists"
            });
        }

        /*
         * Check whether the head exists
         */
        const headResult = await pool.query(
            `
            SELECT id, name, role
            FROM members
            WHERE id = $1
            LIMIT 1
            `,
            [headId]
        );

        const head = headResult.rows[0];

        if (!head) {
            return res.status(404).json({
                success: false,
                message: "Head not found"
            });
        }

        /*
         * Make sure the selected member is a head
         */
        if (head.role.toLowerCase() !== "head") {
            return res.status(400).json({
                success: false,
                message: "Selected member is not a department head"
            });
        }

        /*
         * Create department
         */
        const departmentResult = await pool.query(
            `
            INSERT INTO departments (
                dept_id,
                name,
                head_id
            )
            VALUES ($1, $2, $3)
            RETURNING *
            `,
            [
                deptId.trim(),
                deptName.trim(),
                headId
            ]
        );

        const department = departmentResult.rows[0];

        return res.status(201).json({
            success: true,
            message: "Successfully added department",
            department
        });

    } catch (error) {

        console.error(
            "addDepartment error:",
            error
        );

        /*
         * PostgreSQL unique constraint
         */
        if (error.code === "23505") {
            return res.status(400).json({
                success: false,
                message: "Department ID or name already exists"
            });
        }

        /*
         * Foreign key violation
         */
        if (error.code === "23503") {
            return res.status(400).json({
                success: false,
                message: "Invalid department head"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});
router.post("/getAttendance", rateLimiter, async (req, res) => {
    try {
        const { userId, filter } = req.body;
        // filter: today | week | month | all

        if (!userId) {
            return res.status(400).json({
                message: "userId is required"
            });
        }

        /*
         * Build PostgreSQL date condition
         */
        let dateCondition = "";
        const values = [userId];

        if (filter === "today") {

            dateCondition = `
                AND attendance_date = CURRENT_DATE
            `;

        } else if (filter === "week") {

            dateCondition = `
                AND attendance_date >= CURRENT_DATE - INTERVAL '7 days'
            `;

        } else if (filter === "month") {

            dateCondition = `
                AND attendance_date >= DATE_TRUNC('month', CURRENT_DATE)::DATE
            `;

        } else if (
            filter &&
            filter !== "all"
        ) {
            return res.status(400).json({
                message:
                    "Invalid filter. Use today, week, month or all"
            });
        }

        /*
         * Get attendance records
         */
        const attendanceResult = await pool.query(
            `
            SELECT
                a.*,

                m.name AS member_name,
                m.emp_id,
                m.email,

                d.name AS department

            FROM members_daily_data a

            JOIN members m
                ON a.member_id = m.id

            LEFT JOIN departments d
                ON m.department_id = d.id

            WHERE a.member_id = $1
            ${dateCondition}

            ORDER BY a.attendance_date DESC,
                     a.created_at DESC
            `,
            values
        );

        const attendance = attendanceResult.rows;

        if (attendance.length === 0) {
            return res.status(404).json({
                message: "No attendance records found"
            });
        }

        /*
         * Calculate total worked minutes.
         *
         * PostgreSQL returns INTERVAL as a string,
         * so we calculate using the actual timestamps
         * instead of parsing "8h 30m".
         */
        const totalMinutesResult = await pool.query(
            `
            SELECT
                COALESCE(
                    SUM(
                        EXTRACT(
                            EPOCH FROM total_hours_worked
                        ) / 60
                    ),
                    0
                ) AS total_minutes

            FROM members_daily_data

            WHERE member_id = $1
            ${dateCondition}
            `,
            values
        );

        const totalMinutes = Math.round(
            Number(
                totalMinutesResult.rows[0]
                    .total_minutes
            )
        );

        const totalDays = attendance.length;

        const avgMinutesPerDay =
            totalDays > 0
                ? Math.round(
                    totalMinutes / totalDays
                )
                : 0;

        /*
         * Convert minutes → "8h 30m"
         */
        const formatMinutes = (minutes) => {
            const hours = Math.floor(
                minutes / 60
            );

            const mins = minutes % 60;

            return `${hours}h ${mins}m`;
        };

        /*
         * Format attendance response
         */
        const formattedAttendance =
            attendance.map((record) => {

                return {
                    _id: record.id,

                    id: record.member_id,

                    date:
                        new Date(
                            record.attendance_date
                        ).toLocaleDateString(
                            "en-IN"
                        ),

                    In_Time:
                        record.in_time,

                    delay_in_reason:
                        record.in_time_late_reason,

                    In_Time_reason:
                        record.in_time_outside_reason,

                    In_time_outside:
                        record.in_time_outside,

                    In_time_approved:
                        record.in_time_outside_approved,

                    Out_time:
                        record.out_time,

                    Out_time_reason:
                        record.out_time_outside_reason,

                    Out_time_outside:
                        record.out_time_outside,

                    Out_time_approved:
                        record.out_time_outside_approved,

                    Todays_Task:
                        record.todays_task,

                    reason_for_task_delay:
                        record.reason_for_task_delay,

                    remarks:
                        record.remarks,

                    total_hours:
                        record.total_hours_worked,

                    createdAt:
                        record.created_at,

                    updatedAt:
                        record.updated_at
                };
            });

        return res.status(200).json({
            success: true,

            total_days: totalDays,

            total_hours:
                formatMinutes(totalMinutes),

            avg_per_day:
                formatMinutes(avgMinutesPerDay),

            attendance:
                formattedAttendance
        });

    } catch (error) {

        console.error(
            "getAttendance error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});
router.post("/getAttendanceAdmin", rateLimiter, async (req, res) => {
    try {
        const { filter } = req.body;

        console.log("filter:", filter);

        let dateCondition = "";

        // =========================
        // DATE FILTER
        // =========================

        if (filter === "today") {
            dateCondition = `
                AND a.attendance_date = CURRENT_DATE
            `;
        } else if (filter === "week") {
            // Last 7 calendar days including today
            dateCondition = `
                AND a.attendance_date >= CURRENT_DATE - INTERVAL '6 days'
            `;
        } else if (filter === "month") {
            dateCondition = `
                AND a.attendance_date >= DATE_TRUNC('month', CURRENT_DATE)::DATE
            `;
        } else if (filter && filter !== "all") {
            return res.status(400).json({
                success: false,
                message: "Invalid filter. Use today, week, month or all"
            });
        }

        // =========================
        // GET ATTENDANCE DATA
        // =========================

        const result = await pool.query(`
            SELECT
                a.id AS attendance_id,
                a.member_id,

                a.attendance_date,

                a.in_time,
                a.in_time_late_reason,
                a.in_time_outside_reason,
                a.in_time_outside,
                a.in_time_outside_approved,

                a.out_time,
                a.out_time_outside_reason,
                a.out_time_outside,
                a.out_time_outside_approved,

                a.todays_task,
                a.reason_for_task_delay,
                a.remarks,

                a.total_hours_worked,

                /*
                 * PostgreSQL INTERVAL -> minutes
                 *
                 * EXTRACT(EPOCH FROM interval)
                 * returns seconds.
                 *
                 * Divide by 60 to get minutes.
                 */
                CASE
                    WHEN a.total_hours_worked IS NOT NULL
                    THEN EXTRACT(EPOCH FROM a.total_hours_worked) / 60
                    ELSE 0
                END AS total_minutes_worked,

                a.created_at,
                a.updated_at,

                /*
                 * MEMBER INFORMATION
                 */
                m.id AS member_db_id,
                m.name,
                m.email,
                m.mobile_no,
                m.role,
                m.emp_id,

                /*
                 * DEPARTMENT
                 */
                d.id AS department_id,
                d.name AS department_name

            FROM members_daily_data a

            JOIN members m
                ON a.member_id = m.id

            LEFT JOIN departments d
                ON m.department_id = d.id

            WHERE 1 = 1

            ${dateCondition}

            ORDER BY a.created_at DESC
        `);

        const attendance = result.rows;

        // =========================
        // NO RECORDS
        // =========================

        if (attendance.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No attendance records found"
            });
        }

        // =========================
        // GROUP BY MEMBER
        // =========================

        const memberMap = {};

        for (const record of attendance) {

            const memberId = record.member_id.toString();

            // =========================
            // CREATE MEMBER
            // =========================

            if (!memberMap[memberId]) {

                memberMap[memberId] = {
                    member_info: {
                        _id: record.member_db_id,

                        Name: record.name,

                        Email: record.email,

                        mobile_no: record.mobile_no,

                        Role: record.role,

                        Department: record.department_name,

                        EmpId: record.emp_id
                    },

                    records: [],

                    totalMinutes: 0
                };
            }

            // =========================
            // ADD ATTENDANCE RECORD
            // =========================

            memberMap[memberId].records.push(record);

            // =========================
            // ADD WORKED MINUTES
            // =========================

            if (record.total_minutes_worked != null) {

                const totalMinutes = Math.round(
                    Number(record.total_minutes_worked)
                );

                if (!Number.isNaN(totalMinutes)) {

                    memberMap[memberId].totalMinutes +=
                        totalMinutes;
                }
            }
        }

        // =========================
        // FORMAT MINUTES
        // =========================

        const formatMinutes = (minutes) => {

            const safeMinutes =
                Number(minutes) || 0;

            const hours =
                Math.floor(safeMinutes / 60);

            const mins =
                safeMinutes % 60;

            return `${hours}h ${mins}m`;
        };

        // =========================
        // BUILD MEMBER SUMMARY
        // =========================

        const members = Object.entries(memberMap)
            .map(
                ([
                    memberId,
                    {
                        member_info,
                        records,
                        totalMinutes
                    }
                ]) => {

                    const totalDays =
                        records.length;

                    const avgMinutesPerDay =
                        totalDays > 0
                            ? Math.round(
                                totalMinutes /
                                totalDays
                            )
                            : 0;

                    return {

                        member_id:
                            memberId,

                        member_info,

                        total_days:
                            totalDays,

                        total_hours:
                            formatMinutes(
                                totalMinutes
                            ),

                        avg_per_day:
                            formatMinutes(
                                avgMinutesPerDay
                            ),

                        attendance:
                            records.map(
                                (record) => ({

                                    _id:
                                        record.attendance_id,

                                    date:
                                        new Date(
                                            record.attendance_date
                                        ).toLocaleDateString(
                                            "en-IN"
                                        ),

                                    In_Time:
                                        record.in_time,

                                    delay_in_reason:
                                        record.in_time_late_reason,

                                    In_Time_reason:
                                        record.in_time_outside_reason,

                                    In_time_outside:
                                        record.in_time_outside,

                                    In_time_approved:
                                        record.in_time_outside_approved,

                                    Out_time:
                                        record.out_time,

                                    Out_time_reason:
                                        record.out_time_outside_reason,

                                    Out_time_outside:
                                        record.out_time_outside,

                                    Out_time_approved:
                                        record.out_time_outside_approved,

                                    Todays_Task:
                                        record.todays_task,

                                    reason_for_task_delay:
                                        record.reason_for_task_delay,

                                    remarks:
                                        record.remarks,

                                    total_hours:
                                        record.total_hours_worked,

                                    createdAt:
                                        record.created_at,

                                    updatedAt:
                                        record.updated_at
                                })
                            )
                    };
                }
            );

        // =========================
        // OVERALL TOTAL
        // =========================

        const overallTotalMinutes =
            members.reduce(
                (total, member) => {

                    const totalHours =
                        member.total_hours;

                    const hoursMatch =
                        totalHours.match(
                            /(\d+)h/
                        );

                    const minutesMatch =
                        totalHours.match(
                            /(\d+)m/
                        );

                    const hours =
                        hoursMatch
                            ? Number(hoursMatch[1])
                            : 0;

                    const minutes =
                        minutesMatch
                            ? Number(minutesMatch[1])
                            : 0;

                    return total +
                        (hours * 60) +
                        minutes;
                },
                0
            );

        // =========================
        // RESPONSE
        // =========================

        return res.status(200).json({

            success: true,

            total_members:
                members.length,

            total_records:
                attendance.length,

            overall_total_hours:
                formatMinutes(
                    overallTotalMinutes
                ),

            members
        });

    } catch (error) {

        console.error(
            "getAttendanceAdmin error:",
            error
        );

        return res.status(500).json({

            success: false,

            message:
                "Server error",

            error:
                error.message
        });
    }
});
router.put("/updateDepartmentHead", rateLimiter, async (req, res) => {
    try {
        const { deptId, headId } = req.body;

        if (!deptId || !headId) {
            return res.status(400).json({
                success: false,
                message: "deptId and headId are required"
            });
        }

        /*
         * Determine whether deptId is:
         * - PostgreSQL UUID
         * - Department code such as IT, HR, RND
         */
        const isUUID =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
                .test(deptId);

        let departmentResult;

        if (isUUID) {
            departmentResult = await pool.query(
                `
                SELECT
                    id,
                    dept_id,
                    name,
                    head_id
                FROM departments
                WHERE id = $1
                LIMIT 1
                `,
                [deptId]
            );
        } else {
            departmentResult = await pool.query(
                `
                SELECT
                    id,
                    dept_id,
                    name,
                    head_id
                FROM departments
                WHERE dept_id = $1
                LIMIT 1
                `,
                [deptId]
            );
        }

        const department = departmentResult.rows[0];

        if (!department) {
            return res.status(404).json({
                success: false,
                message: "Department not found"
            });
        }

        /*
         * Find the new head
         */
        const headResult = await pool.query(
            `
            SELECT
                id,
                name,
                email,
                role,
                department_id
            FROM members
            WHERE id = $1
            LIMIT 1
            `,
            [headId]
        );

        const newHead = headResult.rows[0];

        if (!newHead) {
            return res.status(404).json({
                success: false,
                message: "Head member not found"
            });
        }

        /*
         * Check role
         */
        if (
            !newHead.role ||
            newHead.role.toLowerCase() !== "head"
        ) {
            return res.status(400).json({
                success: false,
                message: "Selected member is not a head"
            });
        }

        /*
         * Check department
         */
        if (
            newHead.department_id &&
            newHead.department_id !== department.id
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Selected head does not belong to this department"
            });
        }

        /*
         * Update department head
         */
        const updateResult = await pool.query(
            `
            UPDATE departments
            SET
                head_id = $1,
                updated_at = NOW()
            WHERE id = $2
            RETURNING *
            `,
            [
                newHead.id,
                department.id
            ]
        );

        const updatedDepartment =
            updateResult.rows[0];

        return res.status(200).json({
            success: true,
            message: "Department head updated successfully",
            department: updatedDepartment
        });

    } catch (error) {

        console.error(
            "updateDepartmentHead error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});
module.exports = router;
// router.post("/empL1", rateLimiter, async (req, res) => {
//   const { time, userId } = req.body;

//   let userids = Array.isArray(userId) ? userId : [userId];
// const startOfDay = new Date();
//     startOfDay.setHours(0, 0, 0, 0);
//     const endOfDay = new Date();
//     endOfDay.setHours(23, 59, 59, 999);

//   if (!userids.length || userids.some(id => !id)) {
//     ContentSteeringController.log("user id didn't come");
//     return res.status(400).json({ message: "not found user id" });
//   }

//   userids = [...new Set(userids)];

//   try {
   
//     const existingUsers = await usermodel.find({ id_alias: { $in: userids } }).select("_id id_alias");

//     const existingAliases = existingUsers.map(u => u.id_alias);
//     const missingIds = userids.filter(id => !existingAliases.includes(id));

//     if (missingIds.length) {
//       return res.status(404).json({
//         message: "Some user IDs do not exist",
//         missingIds
//       });
//     }

//     const mongoIds = existingUsers.map(u => u._id); // ObjectIds to match in users_data.id

//     const updateResult = await users_data.updateMany(
//       { id: { $in: mongoIds } },
//       { $set: { l1: true, l1Time:time.trim() } }
//     );

//     res.json({
//       time,
//       matched: updateResult.matchedCount,
//       modified: updateResult.modifiedCount
//     });

//   } catch (err) {
//     console.error(err);
//     return res.status(500).json({ message: "Error verifying user ids" });
//   }
// });
// router.post("/empL2", rateLimiter, async (req, res) => {
//   const { time, userId } = req.body;

//   let userids = Array.isArray(userId) ? userId : [userId];
// const startOfDay = new Date();
//     startOfDay.setHours(0, 0, 0, 0);
//     const endOfDay = new Date();
//     endOfDay.setHours(23, 59, 59, 999);

//   if (!userids.length || userids.some(id => !id)) {
//     ContentSteeringController.log("user id didn't come");
//     return res.status(400).json({ message: "not found user id" });
//   }

//   userids = [...new Set(userids)];

//   try {
   
//     const existingUsers = await usermodel.find({ id_alias: { $in: userids } }).select("_id id_alias");

//     const existingAliases = existingUsers.map(u => u.id_alias);
//     const missingIds = userids.filter(id => !existingAliases.includes(id));

//     if (missingIds.length) {
//       return res.status(404).json({
//         message: "Some user IDs do not exist",
//         missingIds
//       });
//     }

//     const mongoIds = existingUsers.map(u => u._id); // ObjectIds to match in users_data.id

//     const updateResult = await users_data.updateMany(
//       { id: { $in: mongoIds } },
//       { $set: { l2: true, l2Time:time.trim() } }
//     );

//     res.json({
//       time,
//       matched: updateResult.matchedCount,
//       modified: updateResult.modifiedCount
//     });

//   } catch (err) {
//     console.error(err);
//     return res.status(500).json({ message: "Error verifying user ids" });
//   }
// });
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