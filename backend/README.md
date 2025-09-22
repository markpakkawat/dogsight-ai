- Set up for LINE messaging API
1. Create the firebase project and getting into the console of Firestore
2. Add Collection “settings” → document “alerts” → field “alertEnabled: boolean”
3. create .env in /backend/functions and put credentials
 1.)LINE_CHANNEL_ACEES_TOKEN in LINE Messaging API
 2.)LINE_USER_ID in LINE Messaging API
4. Generate private key of the firebase project and save into local.
- Simulating
1. To connect Firebase (Manually)

export GOOGLE_APPLICATION_CREDENTIALS=”/path/to/firebase-service-account.json” then Run node index.js

1. **Ngrok makes your local server temporarily accessible online** so **LINE can send messages to your backend** while you’re testing locally.

Without ngrok, LINE cannot reach `http://localhost:3000` because it’s behind your computer’s firewall/router.

Run ngrok http 3000 and look at URL

Put the URL/line-webhook into Webhook URL setting of LINE developer website.

1. simulate dog go outside with command: 

curl -X POST http://localhost:3000/dog-event \
-H "Content-Type: application/json" \
-d '{"outside":true}'

- Set up for LINE login in Executable application
After finish creating firebase project and setting, look at the project setting for Service Account.
1. generate new private key (Firebase Admin SDK) then save it in /backend
2. make change to /backend/index.js for Firebase initial as your project name it. At databaseURL="https://your-project-id.firebaseio.com"
3. Run the command 'ngrok http 5001' and get the URL
4. Setting up .env
     1)CHANNEL_ID in LINE login
     2)CHANNEL_SECRET in LINE login
     3)CALLBACK_URL a produced URL from ngrok with https://ngrok-URL.app/your-project-id/region/api/pair/callback. Update this callback URL in LINE developer (LINE login)
## For now tesing firebase function with emulators via 'firebase emulators:start --only functions
## For the first time, install firebase CLI.
`npm install -g firebase-tools
firebase login
firebase init`
Choose Functions and Firestore when asked and use javascript,
This creates a /functions folder with backend code.


