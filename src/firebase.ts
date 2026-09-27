import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyC0Sx0QZGfKBPsXTCgzIPHAUUf-UQJjYzc',
  authDomain: 'workout-logs-fb23d.firebaseapp.com',
  projectId: 'workout-logs-fb23d',
  storageBucket: 'workout-logs-fb23d.firebasestorage.app',
  messagingSenderId: '783277656152',
  appId: '1:783277656152:web:c5f74e667daa71e857222d',
  measurementId: 'G-JRGN09QSSH',
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
