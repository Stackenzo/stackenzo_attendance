const nodemailer=require("nodemailer")
require("dotenv").config()
const transporter=nodemailer.createTransport({
service:"gmail",
auth:{
user:"shaikno150@gmail.com",
pass:process.env.nodemailer_pass
}
})
async function sendEmail(to,subject,body,attachments = []) {
        await transporter.sendMail({
    from: "shaikno150@gmail.com",
    to,
    subject,
    text: body,
    attachments
  });
}
module.exports=sendEmail; 