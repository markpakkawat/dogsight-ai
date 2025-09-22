Developing the frontend to executable application
- Always run 'npm run build' after make changes on /app/frontend/ 
then copy contents inside /build folder into /frontend/ of app inheritly
(For the first time, run 'npx create-react-app')

In developing frontend will have to update ngrok URL via .env variable name REACT_APP_API_BASE
=https://xxxxx.ngrok-free.app/firebase-firestore-project-id/region/api
(Everytime you run ngrok, URL will always change.)

To package the file into executable file
1. Install Electron Packager via "npm install electron-packager --save-dev"
2. Produce .exe under /app via "npx electron-packager . your-app-name" This will output as your-app-name folder containing .exe file inside(for Windows)