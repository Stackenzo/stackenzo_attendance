const {createJwt,veriftJWT}=require("./jwt")
const {redis}=require("./DB/redis")
const {pool}=require("./DB/psql")
const rateLimiter=require("./rateLimiter")
const sendEmail=require("./email")
const bcrypt =require("bcrypt")
const router = require("./fillData")
async function CreateSendOTP(email) {
    const otp=Math.floor(100000 + Math.random() * 900000)
    console.log("otp=",otp)
        await redis.set(`otp:${email}`, otp, "EX", 300)
          await sendEmail(email, "OTP Verification", `Your OTP is ${otp} expires in 5 minutes`);
          return true
}
router.post("/createUser", rateLimiter, async (req, res) => {
    const {
        Name,
        Email,
        mobile_no,
        Role,
        Department,
        password
    } = req.body;

    if (
        !Name ||
        !Email ||
        !password ||
        !mobile_no ||
        !Role ||
        !Department
    ) {
        return res.status(400).json({
            message: "Missing required fields"
        });
    }

    try {
        const existingUser = await pool.query(
            `
            SELECT id
            FROM members
            WHERE email = $1
            LIMIT 1
            `,
            [Email.trim()]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({
                message: "User already exists"
            });
        }

        // Find department
        const departmentResult = await pool.query(
            `
            SELECT id
            FROM departments
            WHERE name = $1
            LIMIT 1
            `,
            [Department.trim()]
        );

        if (departmentResult.rows.length === 0) {
            return res.status(400).json({
                message: "Department not found"
            });
        }

        const departmentId = departmentResult.rows[0].id;

        // Encrypt password
        const encrypted_pass = await bcrypt.hash(password, 10);

        // Create member
        const newUserResult = await pool.query(
            `
            INSERT INTO members (
                name,
                email,
                mobile_no,
                role,
                department_id,
                password
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, email
            `,
            [
                Name.trim(),
                Email.trim(),
                mobile_no.trim(),
                Role.trim(),
                departmentId,
                encrypted_pass
            ]
        );

        const newUser = newUserResult.rows[0];

        // Send OTP
        const mailSend = await CreateSendOTP(Email);

        if (!mailSend) {

            // Delete newly created member
            await pool.query(
                `
                DELETE FROM members
                WHERE id = $1
                `,
                [newUser.id]
            );

            return res.status(500).json({
                message: "Failed to send OTP. Please try again."
            });
        }

        return res.status(200).json({
            message: "OTP sent",
            Email
        });

    } catch (e) {

        // PostgreSQL unique violation
        if (e.code === "23505") {

            return res.status(400).json({
                message: "Email already exists"
            });
        }

        console.error("Create user error:", e);

        return res.status(500).json({
            message: `Server error: ${e.message}`
        });
    }
});
router.put("/verifyuserRegister", rateLimiter, async (req, res) => {
    const { otp, email } = req.body;

    try {
      console.log(
    "stored OTP =",
    await redis.get(`otp:${email}`)
);
        const storedotp = await redis.get(`otp:${email}`);

        if (!storedotp) {
            return res.status(400).json({
                message: "OTP expired"
            });
        }

        if (storedotp !== otp) {
            return res.status(400).json({
                message: "OTP invalid"
            });
        }

        const result = await pool.query(
            `
            UPDATE members
            SET
                verified = TRUE,
                updated_at = NOW()
            WHERE email = $1
            RETURNING id, email, verified
            `,
            [email.trim()]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        await redis.del(`otp:${email}`);

        return res.status(200).json({
            message: "User verified successfully"
        });

    } catch (error) {
        console.error("Verify user error:", error);

        return res.status(500).json({
            message: `Server error: ${error.message}`
        });
    }
});
router.post("/userLogin", rateLimiter, async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            message: "Email and password are required"
        });
    }

    try {
        const result = await pool.query(
            `
            SELECT
                m.id,
                m.name,
                m.email,
                m.role,
                m.password,
                m.verified,
                m.status,
                m.department_id,
                d.name AS department
            FROM members m
            LEFT JOIN departments d
                ON m.department_id = d.id
            WHERE m.email = $1
            LIMIT 1
            `,
            [email.trim()]
        );

        const user = result.rows[0];

        if (!user) {
            return res.status(400).json({
                message: "User not registered"
            });
        }

        // Check account status
        if (user.status === "pending_deletion") {
            return res.status(403).json({
                message:
                    "Your account is deactivated and scheduled for permanent deletion."
            });
        }

        // Check password
        if (user.password) {
            const correctPassword = await bcrypt.compare(
                password,
                user.password
            );

            if (!correctPassword) {
                return res.status(401).json({
                    message: "Invalid password"
                });
            }
        }

        // Check email verification
        if (!user.verified) {
            const token = await createJwt({
                email: user.email,
                id: user.id,
                userType: "client"
            });

            return res.status(401).json({
                Verification_token: token
            });
        }

        // Create login JWT
        const token = await createJwt({
            id: user.id,
            Name: user.name,
            Role: user.role,
            email: user.email,
            departments: user.department,
            userType: "client"
        });

        console.log(token);

        if (!token) {
            return res.status(500).json({
                message: "JWT creation error"
            });
        }

        return res.status(200).json({
            Logintoken: token
        });

    } catch (e) {
        console.error("Error at /userLogin:", e);

        return res.status(500).json({
            message: "Internal server error"
        });
    }
});
router.post("/resendOTP", rateLimiter, async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                message: "Email is required"
            });
        }

        // Check if member exists
        const result = await pool.query(
            `
            SELECT id, email, verified
            FROM members
            WHERE email = $1
            LIMIT 1
            `,
            [email.trim()]
        );

        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        // Block if already verified
        if (user.verified) {
            return res.status(400).json({
                message: "User is already verified"
            });
        }

        // Generate and send OTP
        const mailSend = await CreateSendOTP(user.email);

        if (!mailSend) {
            return res.status(500).json({
                message: "Failed to send OTP email"
            });
        }

        return res.status(200).json({
            message: "Verification OTP sent successfully"
        });

    } catch (e) {
        console.error("Resend OTP Error:", e);

        return res.status(500).json({
            message: "Internal server error"
        });
    }
});

module.exports=router