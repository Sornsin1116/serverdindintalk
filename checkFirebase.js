const admin = require("firebase-admin");
const serviceAccount = require("./firebase-service.json"); // ไฟล์ของคุณ

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://dindintalk-5717a-default-rtdb.firebaseio.com/",
});

const db = admin.database();

db.ref("/").once("value")
  .then(snapshot => {
    console.log("✅ เชื่อมต่อ Firebase Realtime Database ได้แล้ว");
    console.log(snapshot.val()); // แสดงข้อมูล root
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ ไม่สามารถเชื่อมต่อ Firebase:", error);
    process.exit(1);
  });
