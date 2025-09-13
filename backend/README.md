- Set up
1. Create the firebase project and getting into the console of Firestore
2. Add Collection “settings” → document “alerts” → field “alertEnabled: boolean”
3. create .env in /backend/functions and put credentials 1.)LINE_CHANNEL_ACEES_TOKEN 2.)LINE_USER_ID
4. Generate private key of the firebase project and save into local.
- Simulating
1. (To connect Firebase) 

export GOOGLE_APPLICATION_CREDENTIALS=”/path/to/firebase-service-account.json” then Run node index.js

1. **Ngrok makes your local server temporarily accessible online** so **LINE can send messages to your backend** while you’re testing locally.

Without ngrok, LINE cannot reach `http://localhost:3000` because it’s behind your computer’s firewall/router.

Run ngrok http 3000 and look at URL

Put the URL/line-webhook into Webhook URL setting of LINE developer website.

1. simulate dog go outside with command: 

curl -X POST http://localhost:3000/dog-event \
-H "Content-Type: application/json" \
-d '{"outside":true}'