const express= require("express")
const cors = require("cors");
const { connectdb } = require("./db");
const user=require("./user")
const fillData=require("./fillData")
const notification=require("./notifications")
try{
    const env=require("dotenv").config()
    console.log("env files loaded")
}catch(e){
    console.log("error at loding env file",e)
}

const port=3003
const app= express()
app.use(express.json()); 
connectdb()
app.use(cors());

app.get("/",(req,res)=>{
    res.send("<h1>hello from emp server</h1>")
})
app.use("/api/users",user)
app.use("/api/notifications",notification)
app.use("/api/fill",fillData)
app.listen(port,"0.0.0.0",()=>{
    console.log("server is running on ",port)
})