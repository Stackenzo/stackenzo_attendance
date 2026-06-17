const {createJwt,veriftJWT}=require("./jwt")
const {usermodel,userDatamodel, redis, departments}=require("./db")
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
  const { Name, Email, mobile_no, Role, Department, password } = req.body;

  if (!Name || !Email || !password || !mobile_no || !Role || !Department) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const isUser = await usermodel.findOne({ Email });
    if (isUser) {
      return res.status(400).json({ message: "User already exists" });
    }
    const encrypted_pass = await bcrypt.hash(password, 10);
    const newUser = await usermodel.create({
      Name,
      Email,
      mobile_no,
      Role,
      Department,
      password: encrypted_pass,
    });


    const mailSend = await CreateSendOTP(Email);
    if (!mailSend) {
      await usermodel.findByIdAndDelete(newUser._id); 
      return res.status(500).json({ message: "Failed to send OTP. Please try again." });
    }

    return res.status(200).json({ message: "OTP sent", Email });

  } catch (e) {
    if (e.code === 11000) {
      const field = Object.keys(e.keyValue)[0];
      return res.status(400).json({ message: `${field} already exists` });
    }
    return res.status(500).json({ message: `Server error: ${e.message}` });
  }
});
router.put("/verifyuserRegister", rateLimiter, async (req, res) => {
  const { otp, email } = req.body;

  const storedotp = await redis.get(`otp:${email}`);
  if (!storedotp) {
    return res.status(400).json({ message: "OTP expired" });
  }

  if (storedotp != otp) {
    return res.status(400).json({ message: "OTP invalid" });
  }

  await usermodel.findOneAndUpdate(
    { Email: email },
    { verified: true }
  );

  await redis.del(`otp:${email}`);

  return res.status(200).json({ message: "User verified successfully" });
});
router.post("/userLogin", rateLimiter, async (req, res) => {
  const { email, password } = req.body;


  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {

    const user = await usermodel.findOne({ Email: email });

    if (!user) {
      return res.status(400).json({ message: "User not registered" });
    }


    if (user.status === "pending_deletion") {
      return res.status(403).json({
        message: "Your account is deactivated and scheduled for permanent deletion.",
      });
    }


    if (user.password) {
      const correctPassword = await bcrypt.compare(password, user.password);
      if (!correctPassword) {
        return res.status(401).json({ message: "Invalid password" });
      }
    }

    if (!user.verified) {
      const token = await createJwt({ email: user.Email, id: user._id, userType: "client" });
      return res.status(401).json({ Verification_token: token });
    }


    const token = await createJwt({
      id: user._id,
      Name: user.Name,
      Role: user.Role,
      email: user.Email,
      departments:user.Department,
      userType: "client",
    });
console.log(token)
    if (!token) {
      return res.status(500).json({ message: "JWT creation error" });
    }

    return res.status(200).json({ Logintoken: token });

  } catch (e) {
    console.error("Error at /userLogin:", e.message);
    return res.status(500).json({ message: "Internal server error" });
  }
});
router.post("/resendOTP", rateLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Check if user exists
    const user = await usermodel.findOne({ Email: email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Block if already verified
    if (user.is_verified) {
      return res.status(400).json({ message: "User is already verified" });
    }

    const mailSend = await CreateSendOTP(email);
    if (!mailSend) {
      return res.status(500).json({ message: "Failed to send OTP email" });
    }

    return res.status(200).json({ message: "Verification OTP sent successfully" });

  } catch (e) {
    console.error("Resend OTP Error:", e);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports=router