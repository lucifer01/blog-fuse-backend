const functions = require("firebase-functions");
const algoliasearch = require("algoliasearch");
const app = require("express")();
const firebaseAuth = require("./utils/firebaseAuth");
const cors = require("cors");
app.use(cors());
const { db } = require("./utils/admin");
const {
  getPosts,
  createPost,
  updatePost,
  getPost,
  commentOnPost,
  likePost,
  unlikePost,
  deletePost,
} = require("./handlers/posts");
const {
  signup,
  login,
  uploadImage,
  addUserDetails,
  getAuthenticatedUser,
  getUserDetails,
  markNotificationsRead,
  checkGoogleUser,
} = require("./handlers/users");

// Example of hello world cloud function without express
// exports.helloWorld = functions.https.onRequest((request, response) => {
//   response.send("Hello World!");
// });

// Post routes
app.get("/posts", getPosts);
app.get("/posts/:postId", getPost);
app.post("/post", firebaseAuth, createPost);
app.post("/post/:posdId", firebaseAuth, updatePost);
app.delete("/posts/:postId", firebaseAuth, deletePost);
app.get("/posts/:postId/like", firebaseAuth, likePost);
app.get("/posts/:postId/unlike", firebaseAuth, unlikePost);
app.post("/posts/:postId/comment", firebaseAuth, commentOnPost);

// User routes
app.post("/signup", signup);
app.post("/login", login);
app.post("/user/image", firebaseAuth, uploadImage);
app.post("/user", firebaseAuth, addUserDetails);
app.get("/user", firebaseAuth, getAuthenticatedUser);
app.get("/user/:username", getUserDetails);
app.post("/notifications", firebaseAuth, markNotificationsRead);
app.get("/checkGoogleUser", checkGoogleUser);

// to set default region
exports.api = functions.region("asia-south1").https.onRequest(app);

// Notifications triggers on firestore events(onCreate, onDelete, onUpdate, onWrite)

// algolia search config
const env = functions.config();
//initialize the algolia client with key which we set via cli
const client = algoliasearch(env.algolia.appid, env.algolia.apikey);
const index = client.initIndex("post_search");

exports.addFirestoreDataToAlgolia = functions.https.onRequest((req, res) => {
  var arr = [];
  db.collection("posts")
    .get()
    .then((docs) => {
      docs.forEach((doc) => {
        let post = doc.data();
        post.objectID = doc.id;
        arr.push(post);
      });
      index.saveObjects(arr, function (err, content) {
        res.status(200).sen(content);
      });
    });
});

// setting up trigger functions
// when new post added add it to algolia index
exports.addIndex = functions.firestore
  .document("posts/{postId}")
  .onCreate((snapshot) => {
    const data = snapshot.data();
    const objectID = snapshot.id;
    // add it to algolia index
    // return index.addObject({ ...data, objectID });
    index.saveObject({ ...data, objectID });
  });

// when post is updated
exports.updateIndex = functions.firestore
  .document("posts/{postId}")
  .onUpdate((change) => {
    const newData = change.after.data();
    const objectID = change.after.id;
    // add it to algolia index
    return index.saveObject({ ...newData, objectID });
  });
// when post is deleted
exports.deleteIndex = functions.firestore
  .document("posts/{postId}")
  .onDelete((snapshot) => index.deleteObject(snapshot.id));

// On like create notification
exports.createNotificationOnLike = functions
  .region("asia-south1")
  .firestore.document("likes/{id}")
  .onCreate((snapshot) => {
    return db
      .doc(`/posts/${snapshot.data().postId}`)
      .get()
      .then((doc) => {
        // Don't set notification for liking your own post
        if (doc.exists && doc.data().user !== snapshot.data().user) {
          return db.doc(`/notifications/${snapshot.id}`).set({
            createdAt: new Date().toISOString(),
            recipient: doc.data().user,
            sender: snapshot.data().user,
            type: "like",
            read: false,
            postId: doc.id,
          });
        }
      })
      .catch((err) => console.error(err));
  });

// On Unlike/delete like set notification
exports.deleteNotificationOnUnLike = functions
  .region("asia-south1")
  .firestore.document("likes/{id}")
  .onDelete((snapshot) => {
    return db
      .doc(`/notifications/${snapshot.id}`)
      .delete()
      .catch((err) => {
        console.error(err);
        return;
      });
  });

// On comment create notification
exports.createNotificationOnComment = functions
  .region("asia-south1")
  .firestore.document("comments/{id}")
  .onCreate((snapshot) => {
    return db
      .doc(`/posts/${snapshot.data().postId}`)
      .get()
      .then((doc) => {
        // No notification for own comment
        if (doc.exists && doc.data().user !== snapshot.data().user) {
          return db.doc(`/notifications/${snapshot.id}`).set({
            createdAt: new Date().toISOString(),
            recipient: doc.data().user,
            sender: snapshot.data().user,
            type: "comment",
            read: false,
            postId: doc.id,
          });
        }
      })
      .catch((err) => {
        console.error(err);
        return;
      });
  });

// Triggers when users changes thier image, so that usersImage on a post also gets updated
exports.onUserImageChange = functions
  .region("asia-south1")
  .firestore.document("/users/{userId}")
  .onUpdate((change) => {
    console.log(change.before.data());
    console.log(change.after.data());
    if (change.before.data().imageUrl !== change.after.data().imageUrl) {
      console.log("image has changed");
      const batch = db.batch();
      return db
        .collection("posts")
        .where("user", "==", change.before.data().username)
        .get()
        .then((data) => {
          data.forEach((doc) => {
            const post = db.doc(`/posts/${doc.id}`);
            batch.update(post, { userImage: change.after.data().imageUrl });
          });
          return batch.commit();
        });
    } else return true;
  });

// Delete likes, comments and notifications on post delete
exports.onPostDelete = functions
  .region("asia-south1")
  .firestore.document("/posts/{postId}")
  .onDelete((snapshot, context) => {
    const postId = context.params.postId;
    const batch = db.batch();
    return db
      .collection("comments")
      .where("postId", "==", postId)
      .get()
      .then((data) => {
        data.forEach((doc) => {
          batch.delete(db.doc(`/comments/${doc.id}`));
        });
        return db.collection("likes").where("postId", "==", postId).get();
      })
      .then((data) => {
        data.forEach((doc) => {
          batch.delete(db.doc(`/likes/${doc.id}`));
        });
        return db
          .collection("notifications")
          .where("postId", "==", postId)
          .get();
      })
      .then((data) => {
        data.forEach((doc) => {
          batch.delete(db.doc(`/notifications/${doc.id}`));
        });
        return batch.commit();
      })
      .catch((err) => console.error(err));
  });
