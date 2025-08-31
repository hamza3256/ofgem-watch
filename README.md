# Ofgem Watch

A lightweight Node.js application that monitors the Ofgem website for new publications and sends email notifications when new content is detected.

## Features

- 🔍 Automated monitoring: Polls Ofgem's publication page every 5 minutes
- 📧 Email notifications: Sends HTML and text email alerts via Resend
- 💾 State persistence: Tracks last seen publication to avoid duplicates
- 🚀 Minimal footprint: Lightweight with essential dependencies only
- ⚡ Professional logging: Clear status updates with emoji indicators
- 🛡️ Error handling: Robust error handling and graceful shutdown

## Prerequisites

- Node.js (v14 or higher)
- [Resend](https://resend.com/) account with API key
- Verified sender email domain in Resend

## Installation

1. **Clone or download the script**
   ```bash
   mkdir ofgem-monitor
   cd ofgem-monitor
   # Copy ofgem-poll.js to this directory
   ```

2. **Install dependencies**
   ```bash
   npm init -y
   npm install puppeteer resend dotenv
   ```

3. **Set up environment variables**

   Create a `.env` file:
   ```env
   RESEND_API_KEY=re_your_actual_api_key_here
   NOTIFY_EMAIL=recipient@example.com
   SENDER_EMAIL=monitor@yourdomain.com
   ```

## Configuration

### Required Environment Variables

| Variable           | Description                                 | Example                  |
|--------------------|---------------------------------------------|--------------------------|
| RESEND_API_KEY     | Your Resend API key                         | re_123abc...             |
| NOTIFY_EMAIL       | Email address to receive notifications      | alert@company.com        |
| SENDER_EMAIL       | Verified sender email (must be verified)    | monitor@yourdomain.com   |

### Optional Configuration

Modify the `CONFIG` object in `ofgem-poll.js` if needed:

```javascript
const CONFIG = {
  baseUrl: 'https://www.ofgem.gov.uk/search?sort=field_published&direction=desc',
  pollInterval: 5 * 60 * 1000, // 5 minutes (in milliseconds)
  stateFile: 'last_ofgem_publication.json',
  browserTimeout: 30000,
  selectorTimeout: 10000
};
```

## Usage

### Development

```bash
node ofgem-poll.js
```

### Production

```bash
# Using PM2 (recommended for production)
npm install -g pm2
pm2 start ofgem-poll.js --name "ofgem-monitor"

# Or using nohup
nohup node ofgem-poll.js > ofgem-monitor.log 2>&1 &
```

### Docker

Create `Dockerfile`:
```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY ofgem-poll.js .
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

CMD ["node", "ofgem-poll.js"]
```

Build and run:
```bash
docker build -t ofgem-monitor .
docker run -d --env-file .env ofgem-monitor
```

## How It Works

1. **Initial Check**: Performs an immediate check on startup
2. **Regular Polling**: Checks Ofgem's publication page every 5 minutes
3. **Web Scraping**: Uses Puppeteer to extract publication details
4. **State Comparison**: Compares current publication with last seen
5. **Notification**: Sends email if new publication detected
6. **State Update**: Saves current publication as last seen

### Publication Detection Logic

Publications are identified by combining title and link:
```javascript
const identifier = `${publication.title}|${publication.link}`;
```
This ensures accurate detection even if publication dates are updated.

## File Structure

```
ofgem-monitor/
├── ofgem-poll.js                # Main application
├── package.json                 # Dependencies
├── .env                         # Environment variables (create this)
├── .gitignore                   # Git ignore file
├── last_ofgem_publication.json  # State file (auto-generated)
└── README.md                    # This file
```

## Email Notification Format

Notifications include:
- **Subject**: "📢 New Ofgem Publication Available"
- **Publication title** and date
- **Direct link** to the publication
- Both HTML and text formats

Example notification:
```
New Ofgem Publication Detected

Title: Energy Market Outlook 2025
Published: 31 August 2025
Link: https://www.ofgem.gov.uk/publication/...
```

## Troubleshooting

### Common Issues

**Environment Variables Not Found**
```
❌ Configuration Error: Missing required environment variables
```
- Solution: Ensure `.env` file exists and contains all required variables

**Browser Launch Failed**
```
❌ Failed to fetch publication: Protocol error
```
- Solution: Install Chrome/Chromium or use Docker with included browser

**Email Send Failed**
```
❌ Email notification failed: Invalid API key
```
- Solution: Verify Resend API key and sender email domain

**No Publications Detected**
```
⚠️ No publication data retrieved
```
- Solution: Check if Ofgem website structure has changed

### Logs

The application provides clear status updates:
- 🚀 Startup messages
- 🔍 Polling status
- 🆕 New publication alerts
- ✅ Success confirmations
- ❌ Error messages

### Testing

Test email functionality:
```bash
# Delete state file to trigger notification on next run
rm last_ofgem_publication.json
node ofgem-poll.js
```

## Production Deployment

### Systemd Service (Linux)

Create `/etc/systemd/system/ofgem-monitor.service`:
```ini
[Unit]
Description=Ofgem Publication Monitor
After=network.target

[Service]
Type=simple
User=nodejs
WorkingDirectory=/opt/ofgem-monitor
ExecStart=/usr/bin/node ofgem-poll.js
EnvironmentFile=/opt/ofgem-monitor/.env
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable ofgem-monitor
sudo systemctl start ofgem-monitor
```

### PM2 Process Manager

```bash
npm install -g pm2
pm2 start ofgem-poll.js --name ofgem-monitor
pm2 save
pm2 startup
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Author

**Muhammad Hamza**  

