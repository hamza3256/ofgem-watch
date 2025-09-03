# Ofgem Watch

Monitors the Ofgem website for new publications and sends email notifications when new content is detected.

## Features

- Polls Ofgem’s publication page every 5 minutes
- Sends email alerts via [Resend](https://resend.com/)
- Remembers last seen publication to avoid duplicates

## Requirements

- Node.js v14+
- Resend API key and verified sender email

## Setup

1. **Install dependencies**
   ```bash
   npm install puppeteer resend dotenv
   ```

2. **Create `.env` file**
   ```env
   RESEND_API_KEY=your_resend_api_key
   NOTIFY_EMAILS=recipient@example.com
   SENDER_EMAIL=monitor@yourdomain.com
   ```

3. **Run the monitor**
   ```bash
   node ofgem-poll.js
   ```

   Or limit each run to a fixed duration (minutes) using an env variable:
   ```bash
   MAX_RUN_MINUTES=60 node ofgem-poll.js
   ```

## Configuration

Edit `CONFIG` in `ofgem-poll.js` to change polling interval or state file name.

- `MAX_RUN_MINUTES` (env): optional, defaults to 60. The process will auto-exit
  after this many minutes. Useful when running via a cron/scheduled job
  (e.g., Railway cron `1 11 * * *`).

## Troubleshooting

- Ensure `.env` is set up correctly.
- Sender email must be verified in Resend.
- If Ofgem’s site structure changes, update the selectors in the script.

## Author

Muhammad Hamza
