const express = require("express");
const admin = require("firebase-admin");
const jwt = require("jsonwebtoken");
const serviceAccount = require("./firebase-service.json");
const path = require('path');
const multer = require("multer");


const app = express();
const PORT = 3000;
const JWT_KEY = "m0bile1easydin";

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://dindintalk-5717a-default-rtdb.firebaseio.com/",
});

// Reference to Database
const db = admin.database();

// ------------------------
// Middleware ตรวจสอบ JWT
// ------------------------
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: "No token provided" });

  const token = authHeader.split(' ')[1]; // Bearer <token>
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const decoded = jwt.verify(token, JWT_KEY);
    req.user = decoded; // ใส่ข้อมูล user ลง req.user
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// =================== USERS ===================
// Register user
app.post('/users', async (req, res) => {
  try {
    const { username, displayname, role, password, pfimage } = req.body;

    // ตรวจสอบค่าที่จำเป็น
    if (!username || role === undefined || !password || !displayname) {
      return res.status(400).json({ error: 'กรุณาใส่ username, displayname, role, password' });
    }

    // ตรวจสอบว่า role เป็นตัวเลข
    const roleNumber = Number(role);
    if (isNaN(roleNumber)) {
      return res.status(400).json({ error: 'role ต้องเป็นตัวเลข' });
    }

    // อ่าน counter ปัจจุบัน
    const counterRef = db.ref('user_counter');
    const counterSnapshot = await counterRef.get();
    let id = 1;
    if (counterSnapshot.exists()) id = counterSnapshot.val() + 1;

    // สร้างผู้ใช้ใหม่ พร้อม pfimage และ displayname
    const userRef = db.ref(`users/${id}`);
    await userRef.set({
      username,
      displayname,
      role: roleNumber,
      password,
      pfimage: pfimage || ''
    });

    // อัพเดต counter
    await counterRef.set(id);

    res.status(201).json({ id, username, displayname, role: roleNumber, pfimage: pfimage || '' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการสร้างผู้ใช้' });
  }
});


// Login
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "username and password are required" });
    }

    const ref = db.ref("users");
    const snapshot = await ref.once("value");
    const users = snapshot.val() || {};

    let foundUser = null;
    let foundId = null;
    for (const uid in users) {
      if (users[uid].username === username) {
        foundUser = users[uid];
        foundId = uid;
        break;
      }
    }

    if (!foundUser || foundUser.password !== password) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = jwt.sign(
      { user_id: foundId, username: foundUser.username, role: foundUser.role },
      JWT_KEY,
      { expiresIn: "1h" }
    );

    res.json({
      message: "Login successful",
      token,
      user: { user_id: foundId, username: foundUser.username, role: foundUser.role }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/users", async (req, res) => {
  try {
    const snapshot = await db.ref("users").once("value");
    const users = snapshot.val() || {};
    res.json(users);
  } catch (err) {
    console.error("Get users error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

app.get('/users/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.params.id;
    const userRef = db.ref(`users/${userId}`);
    const snapshot = await userRef.once('value');

    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(snapshot.val());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// ------------------ 1. อัปเดทรูปโปรไฟล์ ------------------
app.put('/users/:id/pfimage', verifyToken, async (req, res) => {
  const userId = req.params.id;
  const { pfimage } = req.body;

  if (!pfimage) return res.status(400).json({ error: 'pfimage is required' });

  try {
    await db.ref(`users/${userId}/pfimage`).set(pfimage);
    return res.json({ message: 'Profile image updated successfully', pfimage });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update profile image' });
  }
});

// ------------------ 2. แก้ไข displayname ------------------
app.put('/users/:id/displayname', verifyToken, async (req, res) => {
  const userId = req.params.id;
  const { displayname } = req.body;

  if (!displayname) return res.status(400).json({ error: 'displayname is required' });

  try {
    await db.ref(`users/${userId}/displayname`).set(displayname);
    return res.json({ message: 'Display name updated successfully', displayname });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update displayname' });
  }
});

// =================== POSTS ===================
app.get("/posts", async (req, res) => {
  try {
    const snapshot = await db.ref("posts").once("value");
    res.json(snapshot.val() || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET post by postId
app.get("/posts/:postId", async (req, res) => {
  try {
    const postId = parseInt(req.params.postId, 10); // รับเป็น int
    if (isNaN(postId)) return res.status(400).json({ message: "Invalid postId" });

    const snapshot = await db.ref("posts").once("value");
    if (!snapshot.exists()) return res.status(404).json({ message: "No posts found" });

    const data = snapshot.val();

    // หา post ที่ตรงกับ postId
    const postEntry = Object.entries(data).find(
      ([key, value]) => Number(value.postId) === postId
    );

    if (!postEntry) return res.status(404).json({ message: "Post not found" });

    const post = postEntry[1];

    res.status(200).json(post);
  } catch (err) {
    console.error("🔥 Error in /posts/:postId:", err.message, err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});




// GET all comments
app.get("/comments", async (req, res) => {
  try {
    const snapshot = await db.ref("comments").once("value"); // correct ref
    const data = snapshot.val() || {};
    
    const commentsArray = Object.entries(data).map(([key, value]) => ({
      commentKey: key,
      ...value
    }));

    console.log("✅ Fetched comments:", commentsArray.length);
    res.status(200).json(commentsArray);
  } catch (err) {
    console.error("❌ Error fetching comments:", err.message);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

app.get('/comments/:postId', async (req, res) => {
  const postId = parseInt(req.params.postId, 10); 
  if (isNaN(postId)) {
    return res.status(400).json({ message: 'Invalid postId' });
  }

  try {
    const snapshot = await db
      .ref('comments')
      .orderByChild('postId')
      .equalTo(postId) 
      .once('value');

    const data = snapshot.val() || {};
    const count = Object.keys(data).length;

    res.status(200).json({
      count,
      comments: data
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching comments' });
  }
});

app.post('/comments/:postId', verifyToken, async (req, res) => {
  const postId = parseInt(req.params.postId, 10); 
  if (isNaN(postId)) {
    return res.status(400).json({ message: 'Invalid postId' });
  }

  const userID = req.user.user_id; // ✅ ดึงจาก token
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ message: 'Missing text' });
  }

  const newCommentRef = db.ref('comments').push();
  const commentData = {
    commentId: newCommentRef.key,
    postId,
    userID,
    text,
    createdAt: new Date().toISOString(),
  };

  try {
    await newCommentRef.set(commentData);
    res.status(201).json(commentData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error adding comment' });
  }
});



const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "D:/my-firebase-server/images"); // โฟลเดอร์เก็บรูป
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });

app.put("/update/:postId", verifyToken, upload.single("img"), async (req, res) => {
  try {
    const postId = parseInt(req.params.postId, 10);
    if (isNaN(postId)) return res.status(400).json({ error: "Invalid postId" });

    const userID = req.user.user_id;

    // 🔍 หาโพสต์ใน Firebase
    const postsSnapshot = await db.ref("posts").once("value");
    if (!postsSnapshot.exists()) return res.status(404).json({ error: "No posts found" });

    let postKey = null;
    let postData = null;

    postsSnapshot.forEach((child) => {
      if (child.val().postId === postId) {
        postKey = child.key;
        postData = child.val();
      }
    });

    if (!postKey) return res.status(404).json({ error: "Post not found" });

    // 🔒 ตรวจสอบเจ้าของโพสต์
    if (String(postData.userID) !== String(userID)) {
      return res.status(403).json({ error: "Not allowed to update this post" });
    }

    // 📌 อ่านค่าเดิม
    let text = postData.text;
    let Catid = postData.Catid;
    let img = postData.img || "";

    // ✅ อ่านค่า body (รองรับ form-data และ JSON)
    if (req.body) {
      if (req.body.text !== undefined) text = req.body.text;
      if (req.body.Catid !== undefined) Catid = parseInt(req.body.Catid);
      if (req.body.img !== undefined) img = req.body.img; // อาจเป็น "null" string
    }

    // ✅ ถ้ามีไฟล์รูปใหม่
    if (req.file) img = req.file.filename;

    // 🔹 ถ้า client ส่ง img = null หรือ "null" → ลบรูป (เซ็ตเป็น "")
    if (img === null || img === "null") img = "";

    const updatedPost = {
      ...postData,
      text,
      Catid,
      img,
      updatedAt: new Date().toISOString(),
    };

    // อัปเดตโพสต์ใน Firebase
    await db.ref(`posts/${postKey}`).set(updatedPost);

    res.json({ message: "Post updated successfully", post: updatedPost });
  } catch (err) {
    console.error("UpdatePost error:", err);
    res.status(500).json({ error: err.message });
  }
});


app.post("/addPost", verifyToken, upload.single("img"), async (req, res) => {
  try {
    const text = req.body?.text || "";
    const Catid = req.body?.Catid ? parseInt(req.body.Catid) : 1;

    if (!text && !req.file) {
      return res.status(400).json({ error: "You must provide text or image" });
    }

    const userID = req.user.user_id;
    const postsSnapshot = await db.ref("posts").orderByChild("postId").limitToLast(1).once("value");
    let lastPostId = 0;

    postsSnapshot.forEach((child) => {
      lastPostId = child.val().postId;
    });

    const postID = lastPostId + 1;

    const imageFileName = req.file ? req.file.filename : "";

    const postRef = db.ref("posts").push();
    const postData = {
      postId: postID,
      text,
      img: imageFileName,
      userID,
      Catid,
      datetime: new Date().toISOString(),
      like: null,
      comment: null,
    };

    await postRef.set(postData);

    res.status(201).json({ message: "Post added successfully", post: postData });
  } catch (err) {
    console.error("AddPost error:", err);
    res.status(500).json({ error: err.message });
  }
});

 app.delete("/delete/:postId", verifyToken, async (req, res) => {
  try {
    const userID = req.user.user_id;
    const role = req.user.role;
    const postId = parseInt(req.params.postId, 10);
    const reason = req.body?.reason || "No reason"; // ✅ แก้ตรงนี้

    console.log(`🔹 Request to delete postId: ${postId} by userID: ${userID} (role ${role})`);

    const postsRef = db.ref('posts');
    const snapshot = await postsRef.orderByChild('postId').equalTo(postId).once('value');

    if (!snapshot.exists()) {
      return res.status(404).json({ error: "Post not found" });
    }

    const postsData = snapshot.val();
    const postKey = Object.keys(postsData)[0];
    const post = postsData[postKey];

    if (post.userID !== String(userID) && role !== 2) {
      return res.status(403).json({ error: "Not allowed to delete this post" });
    }

    if (role === 2) {
      const logRef = db.ref('deleted_logs').push();
      await logRef.set({
        postId,
        deletedBy: userID,
        deletedAt: new Date().toISOString(),
        reason: reason,
        ownerId: post.userID,
        postText: post.text || "",
      });
      console.log('🗒️ Logged deletion reason:', reason);
    }

    await postsRef.child(postKey).remove();
    console.log('✅ Post deleted successfully:', postKey);

    res.json({ message: "Post deleted successfully", postId, reason });
  } catch (err) {
    console.error('❌ Delete error:', err);
    res.status(500).json({ error: err.message });
  }
});




// =================== EVENTS ===================

// GET: ดึง events ทั้งหมด
app.get("/events", verifyToken, async (req, res) => {
  try {
    const snapshot = await db.ref("events").once("value");
    const data = snapshot.val() || {};
    const eventsArray = Object.values(data); // แปลงเป็น array
    res.status(200).json(eventsArray);
  } catch (err) {
    console.error("Get events error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/addevents", verifyToken, upload.single("eventImage"), async (req, res) => {
  try {
    const { title, description, startDate, endDate, location } = req.body;

    if (!title || !startDate || !endDate || !location) {
      return res.status(400).json({ error: "title, startDate, endDate, location required" });
    }

    // ดึง events ทั้งหมดเพื่อหา eventId ล่าสุด
    const eventsSnapshot = await db.ref("events").orderByChild("eventId").limitToLast(1).once("value");
    let newEventId = 0;

    if (eventsSnapshot.exists()) {
      const lastEvent = Object.values(eventsSnapshot.val())[0];
      newEventId = Number(lastEvent.eventId) + 1;
    }

    const eventImage = req.file ? req.file.filename : ""; // ใช้ชื่อไฟล์ที่อัปโหลด

    const newEvent = {
      eventId: newEventId,
      title,
      description: description || "",
      startDate,
      endDate,
      location,
      eventImage,
      createdBy: req.user.user_id,
      createdAt: new Date().toISOString(),
    };

    await db.ref(`events/${newEventId}`).set(newEvent);
    res.status(201).json({ message: "Event created successfully", event: newEvent });
  } catch (err) {
    console.error("Add event error:", err);
    res.status(500).json({ error: err.message });
  }
});


app.delete("/events/:eventId", verifyToken, async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // เช็ก role
    if (req.user.role !== 3) {
      return res.status(403).json({ error: "Not allowed to delete this event" });
    }

    const eventRef = db.ref(`events/${eventId}`);
    const snapshot = await eventRef.once("value");

    if (!snapshot.exists()) {
      return res.status(404).json({ error: "Event not found" });
    }

    await eventRef.remove();
    res.json({ message: "Event deleted successfully", eventId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/updateevent/:id", verifyToken, upload.single("eventImage"), async (req, res) => {
  try {
    const eventId = parseInt(req.params.id, 10);
    if (isNaN(eventId)) return res.status(400).json({ error: "Invalid eventId" });

    const userRole = req.user.role; // assume token มี field role
    console.log("User role:", userRole);

    // ❌ ตรวจสอบ role
    if (userRole !== 3) {
      return res.status(403).json({ error: "Not allowed to update this event" });
    }

    // 🔍 ดึง events จาก Firebase
    const eventsSnapshot = await db.ref("events").once("value");
    if (!eventsSnapshot.exists()) return res.status(404).json({ error: "No events found" });

    let eventKey = null;
    let eventData = null;

    eventsSnapshot.forEach((child) => {
      if (Number(child.val().eventId) === eventId) {
        eventKey = child.key;
        eventData = child.val();
      }
    });

    if (!eventKey) return res.status(404).json({ error: "Event not found" });

    // 📌 อ่านค่าเดิม
    let { title, description, location, startDate, endDate, eventImage } = eventData;
    eventImage = eventImage || "";

    // ✅ อ่านค่าใหม่จาก body
    if (req.body) {
      if (req.body.title !== undefined) title = req.body.title;
      if (req.body.description !== undefined) description = req.body.description;
      if (req.body.location !== undefined) location = req.body.location;
      if (req.body.startDate !== undefined) startDate = req.body.startDate;
      if (req.body.endDate !== undefined) endDate = req.body.endDate;
      if (req.body.eventImage !== undefined) eventImage = req.body.eventImage; 
    }

    // ✅ ถ้ามีไฟล์รูปใหม่
    if (req.file) eventImage = req.file.filename;

    // 🔹 ลบรูปถ้า client ส่ง "null"
    if (eventImage === null || eventImage === "null") eventImage = "";

    const updatedEvent = {
      ...eventData,
      title,
      description,
      location,
      startDate,
      endDate,
      eventImage,
      updatedAt: new Date().toISOString(),
    };

    await db.ref(`events/${eventKey}`).set(updatedEvent);

    res.json({ message: "Event updated successfully", event: updatedEvent });
  } catch (err) {
    console.error("UpdateEvent error:", err);
    res.status(500).json({ error: err.message });
  }
});


// app.post("/user/bookmark/:postId", verifyToken, async (req, res) => {
//   try {
//     const userID = req.user.user_id;
//     const postId = parseInt(req.params.postId);

//     const postsRef = db.ref("posts");
//     const snapshot = await postsRef.orderByChild("postId").equalTo(postId).once("value");

//     if (!snapshot.exists()) 
//       return res.status(404).json({ error: "Post not found" });

//     const postKey = Object.keys(snapshot.val())[0]; // key จริงของโพสต์
//     const bookmarkRef = db.ref(`bookmarks/${userID}/${postKey}`);
//     const bookmarkSnapshot = await bookmarkRef.once("value");

//     if (bookmarkSnapshot.exists()) {
//       // ถ้ามีอยู่แล้ว → ลบ (ยกเลิก bookmark)
//       await bookmarkRef.remove();
//       return res.status(200).json({ message: "Bookmark removed", bookmarked: 0 });
//     } else {
//       // ถ้ายังไม่มี → เพิ่ม
//       await bookmarkRef.set({
//         postId,
//         userID,
//         bookmarkedAt: new Date().toISOString(),
//       });
//       return res.status(201).json({ message: "Bookmarked successfully", bookmarked: 1 });
//     }
//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// });



// GET all reports
app.get("/reports", verifyToken, async (req, res) => {
  try {
    const reportsSnapshot = await db.ref("reports").once("value");

    if (!reportsSnapshot.exists()) {
      return res.status(404).json({ message: "No reports found" });
    }

    const reportsObj = reportsSnapshot.val();
    const reports = Object.values(reportsObj).map(r => ({
      reportID: r.reportID,
      postID: r.postID,
      reason: r.reason,
      reportedBy: r.reportedBy,
      datetime: r.datetime,
      details: r.details || ""
    }));

    res.status(200).json({
      reports
    });
  } catch (err) {
    console.error("Get reports error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/report/:postId", verifyToken, async (req, res) => {
  try {
    const userID = req.user.user_id; // รหัสผู้ใช้จาก token
    const postIdParam = req.params.postId; // postId จาก URL
    const { reason, details } = req.body;

    // หาโพสต์ที่มี postId ตรงกับ param
    const postsSnapshot = await db.ref("posts").once("value");
    const posts = postsSnapshot.val() || {};

    // ค้นหาโพสต์ตาม postId
    const postEntry = Object.values(posts).find((p) => String(p.postId) === String(postIdParam));

    if (!postEntry) {
      return res.status(404).json({ error: "Post not found" });
    }

    // ห้ามรายงานโพสต์ตัวเอง
    if (postEntry.userID === userID) {
      return res.status(403).json({ error: "You cannot report your own post" });
    }

    // ตรวจสอบว่ารายงานซ้ำหรือไม่
    const reportsSnapshot = await db.ref("reports").once("value");
    const reports = reportsSnapshot.val() || {};
    const alreadyReported = Object.values(reports).some(
      (report) => String(report.postID) === String(postIdParam) && report.reportedBy === userID
    );

    if (alreadyReported) {
      return res.status(400).json({ error: "You have already reported this post" });
    }

    // สร้างรายงานใหม่
    const reportRef = db.ref("reports").push();
    const reportID = reportRef.key;
    const newReport = {
      reportID,
      postID: postIdParam,
      reportedBy: userID,
      reason: reason || "No reason provided",
      details: details || "",
      datetime: new Date().toISOString(),
    };

    await reportRef.set(newReport);

    res.status(201).json({ message: "Post reported successfully", report: newReport });
  } catch (err) {
    console.error("Report post error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// =================== BOOKMARK ===================
app.get("/user/bookmarks", verifyToken, async (req, res) => {
  try {
    const userID = req.user.user_id;
    const userBookmarksRef = db.ref(`bookmarks/${userID}`);
    const snapshot = await userBookmarksRef.once("value");

    if (!snapshot.exists()) {
      return res.json({ bookmarks: [] });
    }

    const bookmarksData = snapshot.val();

    // แปลง object -> array
    const bookmarks = Object.values(bookmarksData);

    res.json({ bookmarks });
  } catch (err) {
    console.error("Show bookmarks error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/user/bookmark/:postId", verifyToken, async (req, res) => {
  try {
    const userID = req.user.user_id;
    const postId = parseInt(req.params.postId);

    const postsRef = db.ref("posts");
    const snapshot = await postsRef.orderByChild("postId").equalTo(postId).once("value");

    if (!snapshot.exists()) {
      return res.status(404).json({ error: "Post not found" });
    }

    const postKey = Object.keys(snapshot.val())[0];
    const bookmarkRef = db.ref(`bookmarks/${userID}/${postKey}`);
    const bookmarkSnapshot = await bookmarkRef.once("value");

    // ถ้ามีข้อมูลเดิมอยู่แล้ว → toggle สถานะ
    if (bookmarkSnapshot.exists()) {
      const currentData = bookmarkSnapshot.val();
      const newStatus = currentData.status === 1 ? 0 : 1;

      await bookmarkRef.update({
        status: newStatus,
        updatedAt: new Date().toISOString(),
      });

      return res.status(200).json({
        message: newStatus === 1 ? "Bookmarked" : "Unbookmarked",
        status: newStatus,
      });
    }

    // ถ้ายังไม่มีข้อมูล → เพิ่มใหม่เป็น bookmark
    await bookmarkRef.set({
      postId,
      userID,
      status: 1,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({
      message: "Bookmarked successfully",
      status: 1,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});



app.delete("/user/bookmark/:postId", verifyToken, async (req, res) => {
  try {
    const userID = req.user.user_id;
    const postId = parseInt(req.params.postId);

    const postsRef = db.ref("posts");
    const snapshot = await postsRef.orderByChild("postId").equalTo(postId).once("value");

    if (!snapshot.exists()) return res.status(404).json({ error: "Post not found" });

    const postKey = Object.keys(snapshot.val())[0]; // key จริงของโพสต์

    const bookmarkRef = db.ref(`bookmarks/${userID}/${postKey}`);
    const bookmarkSnapshot = await bookmarkRef.once("value");

    if (!bookmarkSnapshot.exists())
      return res.status(404).json({ error: "Bookmark not found" });

    await bookmarkRef.remove();
    res.json({ message: "Bookmark removed successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET posts ของ user
app.get("/user/:userId/posts", async (req, res) => {
  const userId = req.params.userId;
  const snapshot = await db.ref("posts").once("value");
  const data = snapshot.val() || {};
  
  const userPosts = Object.values(data).filter(p => String(p.userID) === String(userId));
  res.status(200).json(userPosts);
});

app.use('/images', express.static(path.join(__dirname, 'images')));

app.post("/sendMessage", verifyToken, async (req, res) => {
  try {
    const senderId = req.user.user_id.toString();
    const { receiverId, message } = req.body;

    if (!receiverId || !message) 
      return res.status(400).json({ error: "Missing fields" });

    // เก็บข้อความแบบเดิม
    const msgRef = db.ref("messages").push();
    await msgRef.set({
      senderId,
      receiverId,
      message,
      timestamp: new Date().toISOString(), // ใช้เวลาปัจจุบัน
    });

    // เก็บข้อความลง chats/{senderId_receiverId}/messages
    const chatId = [senderId, receiverId].sort().join("_");
    const chatMsgRef = db.ref(`chats/${chatId}/messages`).push();
    await chatMsgRef.set({
      senderId,
      receiverId,
      message,
      timestamp: new Date().toISOString(), // ใช้เวลาปัจจุบันอีกครั้ง
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});



// ดึงข้อความทั้งหมดของผู้ใช้
app.get("/chat/messages", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id.toString();

    // ดึง chats ทั้งหมด
    const snap = await db.ref("chats").once("value");
    const chatsData = snap.val() || {};

    const chatList = [];

    for (const chatId in chatsData) {
      const chat = chatsData[chatId];
      if (!chat.messages) continue;

      // แปลง messages เป็น array และ sort ตาม timestamp
      const messages = Object.values(chat.messages)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .map(msg => ({
          senderId: msg.senderId,
          receiverId: msg.receiverId,
          message: msg.message,
          timestamp: msg.timestamp,
        }));

      // ตรวจสอบว่าผู้ใช้มีส่วนร่วมในแชทนี้ไหม
      const participants = chatId.split("_");
      if (!participants.includes(userId)) continue;

      // หาคู่ผู้ใช้คนอื่น
      const otherId = participants.find(id => id !== userId);

      // ดึงชื่อจริงจาก users database
      let name = `User ${otherId}`;
      try {
        const userSnap = await db.ref(`users/${otherId}`).once("value");
        const userData = userSnap.val();
        if (userData && userData.displayname) name = userData.displayname;
      } catch (e) {
        console.error(`Error fetching user ${otherId}:`, e);
      }

      chatList.push({
        userId: otherId,
        name,
        avatarPath: "assets/images/profile/pfp01.jpg",
        messages, // ส่ง array ของข้อความทั้งหมด
      });
    }

    res.json(chatList);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


// =================== CHAT REQUEST ===================

// ส่งคำขอแชท
app.post("/chat/request", verifyToken, async (req, res) => {
  try {
    const senderId = req.user.user_id;
    const { receiverId } = req.body;

    if (!receiverId) return res.status(400).json({ error: "receiverId is required" });
    if (senderId === receiverId) return res.status(400).json({ error: "Cannot send request to yourself" });

    const requestRef = db.ref(`chat_requests/${receiverId}/${senderId}`);
    const snapshot = await requestRef.once("value");
    if (snapshot.exists()) return res.status(400).json({ error: "Request already sent" });

    await requestRef.set({
      senderId,
      receiverId,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({ message: "Chat request sent" });
  } catch (err) {
    console.error("Send chat request error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 แก้ไข GET /chat/requests → ส่ง array
app.get("/chat/requests", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const snapshot = await db.ref(`chat_requests/${userId}`).once("value");
    const requests = snapshot.val() || {};

    // แปลงเป็น array
    const requestsArray = Object.entries(requests).map(([key, value]) => ({
      id: key,
      ...value
    }));

    res.status(200).json(requestsArray);
  } catch (err) {
    console.error("Get chat requests error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Accept request
app.post("/chat/accept", verifyToken, async (req, res) => {
  try {
    const receiverId = req.user.user_id.toString();
    const senderId = req.body.senderId?.toString();
    if (!senderId) return res.status(400).json({ error: "senderId required" });

    // สร้าง chatId โดยเรียงเลขต่ำ->สูง เพื่อให้เป็น unique
    const ids = [receiverId, senderId].sort();
    const chatId = `${ids[0]}_${ids[1]}`;

    const chatRef = db.ref(`chats/${chatId}`);
    const snapshot = await chatRef.once("value");

    if (!snapshot.exists()) {
      // สร้าง chat เปล่า
      await chatRef.set({ messages: {} });
    }

    // ลบ chat request หลัง Accept
    await db.ref(`chat_requests/${receiverId}/${senderId}`).remove();

    res.json({ success: true, chatId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});



// Reject request
app.post("/chat/request/reject", verifyToken, async (req, res) => {
  try {
    const receiverId = req.user.user_id;
    const { senderId } = req.body;

    if (!senderId) return res.status(400).json({ error: "senderId is required" });

    const requestRef = db.ref(`chat_requests/${receiverId}/${senderId}`);
    const snapshot = await requestRef.once("value");
    if (!snapshot.exists()) return res.status(404).json({ error: "Request not found" });

    await requestRef.remove();

    res.status(200).json({ message: "Chat request rejected" });
  } catch (err) {
    console.error("Reject chat request error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================== other API ==================
// ✅ API: Like / Unlike
app.post("/like", verifyToken, async (req, res) => {
  try {
    const userID = req.user.user_id;
    const { postID, action } = req.body;

    if (!postID || action == null) {
      return res.status(400).json({ error: "postID and action are required" });
    }

    const likeRef = db.ref(`likes/${postID}/${userID}`);

    if (action === 1) {
      // ✅ กด Like
      await likeRef.set(true);
      return res.json({ message: "Post liked successfully" });
    } else if (action === 0) {
      // ✅ ถอด Like
      await likeRef.remove();
      return res.json({ message: "Post unliked successfully" });
    } else {
      return res.status(400).json({ error: "Invalid action value" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/likes/:postId", verifyToken, async (req, res) => {
  try {
    const postID = req.params.postId;
    const userID = req.user.user_id;

    const snapshot = await db.ref(`likes/${postID}`).once("value");
    const likes = snapshot.val() || {};
    const likeCount = Object.keys(likes).length;
    const userLiked = !!likes[userID];

    return res.json({ count: likeCount, userLiked });
  } catch (error) {
    console.error("Error fetching likes:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});


function isWithinRange(datetime, range) {
  if (!datetime) return false;
  const date = new Date(datetime);
  const now = new Date();

  switch (range) {
    case "today":
      return date.toDateString() === now.toDateString();
    case "week":
      const weekAgo = new Date();
      weekAgo.setDate(now.getDate() - 7);
      return date >= weekAgo && date <= now;
    case "month":
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    default:
      return true;
  }
}

app.get("/stats", async (req, res) => {
  const range = req.query.range || "today";

  try {
    // ดึงข้อมูลทั้งหมดจาก Firebase
    const [postsSnap, commentsSnap, reportsSnap, likesSnap, bookmarksSnap] = await Promise.all([
      db.ref("posts").once("value"),
      db.ref("comments").once("value"),
      db.ref("reports").once("value"),
      db.ref("likes").once("value"),
      db.ref("bookmarks").once("value"),
    ]);

    const posts = postsSnap.val() || {};
    const comments = commentsSnap.val() || {};
    const reports = reportsSnap.val() || {};
    const likes = likesSnap.val() || {};
    const bookmarks = bookmarksSnap.val() || {};

    // 📊 กรองข้อมูลตามช่วงเวลา (ดู field datetime หรือ createdAt)
    const filteredPosts = Object.values(posts).filter(
      (p) => p.datetime && isWithinRange(p.datetime, range)
    );

    const filteredComments = Object.values(comments).filter(
      (c) => c.createdAt && isWithinRange(c.createdAt, range)
    );

    const filteredReports = Object.values(reports).filter(
      (r) => r.datetime && isWithinRange(r.datetime, range)
    );

    // ❤️ รวมจำนวน likes ทั้งหมด
    let likesCount = 0;
    Object.values(likes).forEach((postLikes) => {
      if (typeof postLikes === "object") likesCount += Object.keys(postLikes).length;
    });

    // 🔖 รวมจำนวน bookmarks ทั้งหมด
    const bookmarksCount = Object.keys(bookmarks).length;

    // 🚨 Breakdown reports
    const breakdown = {
      scam: 0,
      bullying: 0,
      falseInfo: 0,
      spam: 0,
      inappropriate: 0,
    };

    filteredReports.forEach((r) => {
      const reason = (r.reason || "").toLowerCase();
      if (breakdown.hasOwnProperty(reason)) breakdown[reason]++;
    });

    // 📈 barData (post / comment / report)
    const barData = [
      filteredPosts.length,
      filteredComments.length,
      filteredReports.length,
    ];

    // ✅ สร้างข้อมูลส่งกลับ
    const stats = {
      range,
      postsCount: filteredPosts.length,
      commentsCount: filteredComments.length,
      reportsCount: filteredReports.length,
      likesCount,
      bookmarksCount,
      barData,
      reportBreakdown: breakdown,
      // 🔍 แสดงตัวอย่างข้อมูลจริงด้วย (เพื่อตรวจสอบ)
      samples: {
        posts: filteredPosts.slice(0, 3),
        comments: filteredComments.slice(0, 3),
        reports: filteredReports.slice(0, 3),
      },
    };

    console.log(`📊 Stats for ${range}:`, stats);
    res.json(stats);
  } catch (error) {
    console.error("❌ Error fetching stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/events/:id/mark-read", verifyToken, async (req, res) => {
  try {
    const userID = req.user.user_id;
    const eventId = req.params.id;

    if (!userID || !eventId) return res.status(400).json({ error: "Missing userID or eventId" });

    // path สำหรับเก็บ notification ของผู้ใช้
    const notifRef = db.ref(`eventNotifications/${userID}/${eventId}`);

    // upsert → ถ้าไม่มี record จะสร้างใหม่
    await notifRef.set({
      eventId,
      userID,
      isRead: true,
      readAt: new Date().toISOString()
    });

    console.log(`✅ User ${userID} marked event ${eventId} as read`);

    res.status(200).json({ message: "Event marked as read" });
  } catch (err) {
    console.error("❌ Failed to mark event as read:", err);
    res.status(500).json({ error: "Failed to mark event as read" });
  }
});

app.post('/posts/:id/mark-read', verifyToken, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.user_id;

    if (!postId || !userId) {
      return res.status(400).json({ error: "Missing postId or userId" });
    }

    // path สำหรับเก็บสถานะอ่านของผู้ใช้
    const readRef = db.ref(`postNotifications/${userId}/${postId}`);

    // upsert → ถ้าไม่มี record จะสร้างใหม่
    await readRef.set({
      postId,
      userId,
      isRead: true,
      readAt: new Date().toISOString()
    });

    console.log(`✅ User ${userId} marked post ${postId} as read`);

    res.status(200).json({ message: "Post marked as read" });
  } catch (err) {
    console.error("❌ Failed to mark post as read:", err);
    res.status(500).json({ error: "Failed to mark post as read" });
  }
});
// =================== NOTIFICATIONS ===================

// GET: ดึง noti ของผู้ใช้ปัจจุบัน
app.get("/notifications", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id.toString();
    const notiRef = db.ref(`notifications/${userId}`);
    const snapshot = await notiRef.once("value");

    if (!snapshot.exists()) {
      return res.status(200).json({ notifications: [] });
    }

    const data = snapshot.val();

    // แปลง object → array และเรียงตามเวลาล่าสุด
    const notifications = Object.keys(data)
      .map((key) => ({
        id: key,
        ...data[key],
      }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.status(200).json({ notifications });
  } catch (err) {
    console.error("❌ Error fetching notifications:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});
// =================== NOTIFICATIONS ===================
app.post("/notifications/:receiverId", verifyToken, async (req, res) => {
  try {
    const senderId = req.user.user_id.toString();
    const receiverId = req.params.receiverId.toString();
    const { type, postId, eventId, title, message } = req.body;

    if (!message || !type) {
      return res.status(400).json({ error: "type and message are required" });
    }

    const newNotiRef = db.ref(`notifications/${receiverId}`).push();

    const notiData = {
      senderId,
      type, // "event" | "post" | "system"
      postId: postId || null,
      eventId: eventId || null,
      title: title || "",
      message,
      isRead: false,
      timestamp: new Date().toISOString(),
    };

    await newNotiRef.set(notiData);

    res.status(201).json({
      message: "Notification sent",
      notification: notiData,
    });
  } catch (err) {
    console.error("❌ Error adding notification:", err);
    res.status(500).json({ error: "Failed to add notification" });
  }
});

app.get("/postNotifications/:userId", async (req, res) => {
  const userId = req.params.userId;
  try {
    const snapshot = await db.ref(`post_notifications/${userId}`).once("value");
    const data = snapshot.val() || {};

    // map ให้เหมือนโค้ดเดิม
    const map = {};
    Object.keys(data).forEach(postId => {
      map[postId] = { isRead: !!data[postId].isRead };
    });

    res.json(map);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch post notifications" });
  }
});

// ดึง event notifications
app.get("/eventNotifications/:userId", async (req, res) => {
  const userId = req.params.userId;
  try {
    const snapshot = await db.ref(`event_notifications/${userId}`).once("value");
    const data = snapshot.val() || {};

    const map = {};
    Object.keys(data).forEach(eventId => {
      map[eventId] = { isRead: !!data[eventId].isRead };
    });

    res.json(map);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch event notifications" });
  }
});

// =================== START SERVER ===================
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
