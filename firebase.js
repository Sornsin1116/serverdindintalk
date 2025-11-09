// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDZasS8mncA0d_23F_T5RHKjUyssagatB0",
  authDomain: "dindintalk-5717a.firebaseapp.com",
  databaseURL: "https://dindintalk-5717a-default-rtdb.firebaseio.com",
  projectId: "dindintalk-5717a",
  storageBucket: "dindintalk-5717a.firebasestorage.app",
  messagingSenderId: "286377008769",
  appId: "1:286377008769:web:905977aa56a0498b717780"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

module.exports = { firebase, app };