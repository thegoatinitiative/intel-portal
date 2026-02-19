/**
 * firebase-config.js — Firebase SDK initialization for Intel Portal
 * Project: intel-portal-9578e
 */

const firebaseConfig = {
  apiKey: "AIzaSyAYUYJ1ptEt_ohpPxF-47w8nhnizKsCqBE",
  authDomain: "intel-portal-9578e.firebaseapp.com",
  projectId: "intel-portal-9578e",
  storageBucket: "intel-portal-9578e.firebasestorage.app",
  messagingSenderId: "852658704724",
  appId: "1:852658704724:web:a8c33238855442e932b8c1"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

const fbAuth = firebase.auth();
const fbDb = firebase.firestore();
const fbStorage = firebase.storage();
