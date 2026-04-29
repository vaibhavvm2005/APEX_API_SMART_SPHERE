import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyD_A6ttqFv65CNCcPaPOO5Dj1a7AIFmsAY",
  authDomain: "smartsphere-367f2.firebaseapp.com",
  databaseURL: "https://smartsphere-367f2-default-rtdb.firebaseio.com",
  projectId: "smartsphere-367f2",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db };
export default app;