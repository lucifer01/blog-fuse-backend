const admin = require("firebase-admin");
const functions = require("firebase-functions");

// To run locally (firebase serve)
// generate serviceAccountKey file and place it to root directory
// var serviceAccount = require("../../serviceAccountKey.json");

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
//   databaseURL: "https://blog-fuse.firebaseio.com",
// });

// firebase deploy
admin.initializeApp(functions.config().firebase);
const db = admin.firestore();

module.exports = { admin, db };
