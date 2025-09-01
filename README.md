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

## Configuration

Edit `CONFIG` in `ofgem-poll.js` to change polling interval or state file name.

## Troubleshooting

- Ensure `.env` is set up correctly.
- Sender email must be verified in Resend.
- If Ofgem’s site structure changes, update the selectors in the script.

## Author

Muhammad Hamza
