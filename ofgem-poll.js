const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const { Resend } = require('resend');
const puppeteer = require('puppeteer');
const { URL } = require('url');

// configs
const baseUrlString = 'https://www.ofgem.gov.uk/search?sort=field_published&direction=desc';
const POLL_INTERVAL = 5 * 60 * 1000; // poll every 5 mins
const STATE_FILE = 'last_ofgem_pub.json';

const RESEND_API_KEY = 'YOUR_RESEND_API_KEY'; 
const NOTIFY_EMAIL = 'YOUR_NOTIFICATION_EMAIL'; 
const SENDER_EMAIL = 'Ofgem Watch <YOUR_VERIFIED_SENDER_EMAIL>';

if (!RESEND_API_KEY || !NOTIFY_EMAIL || !SENDER_EMAIL) {
  console.error('FATAL ERROR: Please check your configs: RESEND_API_KEY; NOTIFY_EMAIL; SENDER_EMAIL.');
  process.exit(1);
}

const resend = new Resend(RESEND_API_KEY);

function getLastSeen() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      const parsedData = JSON.parse(data);
      if (typeof parsedData === 'object' && parsedData !== null) {
        console.log('INFO: Loaded last seen data from', STATE_FILE);
        return parsedData;
      } else {
        console.warn('WARN: Invalid data format in state file. Starting fresh.');
        return null;
      }
    }
  } catch (error) {
    console.error('ERROR: Failed to read state file:', error);
    return null;
  }
  console.log('INFO: No state file found. Starting fresh.');
  return null;
}

function setLastSeen(data) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('INFO: Saved last seen data to', STATE_FILE);
  } catch (error) {
    console.error('ERROR: Failed to write state file:', error);
  }
}

async function fetchLatestPublication() {
  let browser;
  try {
    console.log(`INFO: Launching browser and navigating to ${baseUrlString}`);
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);

    // Wait for dynamic content to load
    await page.goto(baseUrlString, { waitUntil: 'networkidle2' });
    console.log('INFO: Page loaded. Extracting data...');

    const articleSelector = 'article';
    try {
      await page.waitForSelector(articleSelector, { timeout: 10000 });
    } catch (e) {
      console.warn('WARN: Timeout waiting for article element. Page structure may have changed.');
      return null;
    }

    // Extract publication data from the first article
    const publicationData = await page.$eval(articleSelector, (articleElement) => {
      const linkElem = articleElement.querySelector('a');
      const relativeLink = linkElem ? linkElem.getAttribute('href') : null;

      // Target specific nested span for title
      const titleSpan = articleElement.querySelector('h3.text-fl-base.text-underline span span');
      const title = titleSpan ? titleSpan.textContent.trim() : '';

      // Find published date - complex DOM traversal due to structure
      let date = '';
      const fontBoldSpans = articleElement.querySelectorAll('span.font-bold');
      
      for (const span of fontBoldSpans) {
        if (span.textContent && span.textContent.includes('Published date:')) {
          const timeElem = span.parentElement ? span.parentElement.querySelector('time') : null;
          if (timeElem) {
            date = timeElem.textContent.trim();
          }
          break;
        }
      }

      return { relativeLink, title, date };
    });

    const fullLink = publicationData.relativeLink
      ? new URL(publicationData.relativeLink, baseUrlString).href
      : '';

    const latest = {
      title: publicationData.title,
      link: fullLink,
      date: publicationData.date
    };

    // Essential data validation - prevent incomplete notifications
    if (!latest.title || !latest.link) {
      console.warn('WARN: Essential publication data missing.');
      return null;
    }

    console.log('INFO: Successfully extracted publication data.');
    console.log('DEBUG:', latest);
    return latest;

  } catch (error) {
    console.error('ERROR: Failed to fetch publication data:', error);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function sendEmail(pub) {
  try {
    if (!pub || !pub.title || !pub.link) {
      console.warn('WARN: Cannot send email - incomplete publication data.');
      return;
    }

    console.log(`INFO: Sending notification email to ${NOTIFY_EMAIL}...`);
    const { data, error } = await resend.emails.send({
      from: SENDER_EMAIL,
      to: NOTIFY_EMAIL,
      subject: 'New Ofgem Publication Detected',
      text: `Title: ${pub.title}\nDate: ${pub.date || 'Date not found'}\nLink: ${pub.link}\n\n---\nThis is an automated notification.`,
    });

    if (error) {
      console.error('ERROR: Failed to send email:', error);
    } else {
      console.log('INFO: Notification email sent successfully.');
    }
  } catch (error) {
    console.error('ERROR: Unexpected error during email sending:', error);
  }
}

async function poll() {
  console.log(`INFO: Starting poll cycle at ${new Date().toISOString()}`);
  try {
    const latest = await fetchLatestPublication();
    const lastSeen = getLastSeen();

    if (!latest) {
      console.log('INFO: No publication data fetched. Skipping comparison.');
      return;
    }

    const latestIdentifier = `${latest.title}-${latest.link}`;
    const lastSeenIdentifier = lastSeen ? `${lastSeen.title}-${lastSeen.link}` : null;

    if (!lastSeenIdentifier || latestIdentifier !== lastSeenIdentifier) {
      console.log('INFO: New publication detected!');
      console.log('DEBUG: Latest Publication:', latest);

      await sendEmail(latest);
      setLastSeen(latest);
    } else {
      console.log('INFO: No new publication detected.');
    }
  } catch (err) {
    console.error('FATAL: Uncaught error during polling cycle:', err);
  } finally {
    console.log(`INFO: Poll cycle finished at ${new Date().toISOString()}`);
  }
}

console.log(`INFO: Starting Ofgem publication watcher. Polling every ${POLL_INTERVAL / 1000} seconds.`);

poll(); // Initial run
setInterval(poll, POLL_INTERVAL);

// Graceful shutdown handlers
const shutdown = () => {
  console.log('INFO: Shutting down...');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);