/**
 * Ofgem Publication Monitor
 * 
 * Monitors the Ofgem website for new publications and sends email notifications
 * when new content is detected. Uses web scraping to check the latest publication
 * and maintains state to avoid duplicate notifications.
 * 
 * Requirements:
 * - Node.js with puppeteer, resend packages
 * - Valid Resend API key and verified sender email
 * 
 * Usage:
 * Set environment variables: RESEND_API_KEY, NOTIFY_EMAILS, SENDER_EMAIL
 * NOTIFY_EMAILS should be comma-separated (e.g., "email1@example.com,email2@example.com")
 * Run: node ofgem-poll.js
 * 
 * @author Muhammad Hamza
 * @version 1.0.0
 */

require('dotenv').config();
const fs = require('fs');
const { Resend } = require('resend');
const puppeteer = require('puppeteer');

// Configuration
const CONFIG = {
  baseUrl: 'https://www.ofgem.gov.uk/search?sort=field_published&direction=desc',
  pollInterval: 5 * 60 * 1000, // 5 minutes
  stateFile: 'last_ofgem_publication.json',
  browserTimeout: 30000,
  selectorTimeout: 10000
};

const ENV = {
  resendApiKey: process.env.RESEND_API_KEY,
  notifyEmails: process.env.NOTIFY_EMAILS ? process.env.NOTIFY_EMAILS.split(',').map(email => email.trim()) : [],
  senderEmail: process.env.SENDER_EMAIL
};

// Validate required configuration
if (!ENV.resendApiKey || ENV.notifyEmails.length === 0 || !ENV.senderEmail) {
  console.error('❌ Configuration Error: Missing required environment variables');
  console.error('   Required: RESEND_API_KEY, NOTIFY_EMAILS, SENDER_EMAIL');
  console.error('   NOTIFY_EMAILS should be comma-separated (e.g., "email1@example.com,email2@example.com")');
  process.exit(1);
}

const resend = new Resend(ENV.resendApiKey);

// State management utilities
const loadState = () => {
  try {
    return fs.existsSync(CONFIG.stateFile) 
      ? JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf8')) 
      : null;
  } catch (error) {
    console.warn('⚠️  State file corrupted, starting fresh');
    return null;
  }
};

const saveState = (data) => {
  try {
    fs.writeFileSync(CONFIG.stateFile, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('❌ Failed to save state:', error.message);
  }
};

/**
 * Fetches the latest publication from Ofgem website
 * @returns {Promise<Object|null>} Publication object or null if failed
 */
const fetchLatestPublication = async () => {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(CONFIG.baseUrl, { 
      waitUntil: 'networkidle2', 
      timeout: CONFIG.browserTimeout 
    });
    
    // Wait for content to load
    await page.waitForSelector('article', { timeout: CONFIG.selectorTimeout });

    // Extract publication details from first article
    const publication = await page.$eval('article', (article) => {
      const link = article.querySelector('a')?.href;
      const title = article.querySelector('h3 span span')?.textContent?.trim();
      
      // Find publication date
      const dateSpan = [...article.querySelectorAll('span.font-bold')]
        .find(span => span.textContent?.includes('Published date:'));
      const date = dateSpan?.parentElement?.querySelector('time')?.textContent?.trim();

      return title && link ? { title, link, date: date || 'Unknown' } : null;
    });

    return publication;
    
  } catch (error) {
    console.error('❌ Failed to fetch publication:', error.message);
    return null;
  } finally {
    await browser.close();
  }
};

/**
 * Sends email notification for new publication to multiple recipients
 * @param {Object} publication - Publication details
 */
const sendNotification = async (publication) => {
  try {
    const { data, error } = await resend.emails.send({
      from: ENV.senderEmail,
      to: ENV.notifyEmails,
      subject: '📢 New Ofgem Publication Available',
      html: `
        <h2>New Ofgem Publication Detected</h2>
        <p><strong>Title:</strong> ${publication.title}</p>
        <p><strong>Published:</strong> ${publication.date}</p>
        <p><strong>Link:</strong> <a href="${publication.link}">${publication.link}</a></p>
        <hr>
        <p><em>This is an automated notification from Ofgem Monitor.</em></p>
      `,
      text: `New Ofgem Publication\n\nTitle: ${publication.title}\nPublished: ${publication.date}\nLink: ${publication.link}\n\n---\nAutomated notification from Ofgem Monitor`
    });

    if (error) {
      throw new Error(error.message);
    }
    
    console.log(`✅ Email notification sent successfully to ${ENV.notifyEmails.length} recipient(s)`);
    
  } catch (error) {
    console.error('❌ Email notification failed:', error.message);
  }
};

/**
 * Main polling function - checks for new publications
 */
const pollForUpdates = async () => {
  console.log(`🔍 Checking for updates... [${new Date().toLocaleString('en-GB')}]`);
  
  try {
    const latestPublication = await fetchLatestPublication();
    
    if (!latestPublication) {
      console.log('⚠️  No publication data retrieved');
      return;
    }

    const previousPublication = loadState();
    const currentId = `${latestPublication.title}|${latestPublication.link}`;
    const previousId = previousPublication 
      ? `${previousPublication.title}|${previousPublication.link}` 
      : null;

    if (currentId !== previousId) {
      console.log('🆕 New publication detected:', latestPublication.title);
      await sendNotification(latestPublication);
      saveState(latestPublication);
    } else {
      console.log('✨ No new publications');
    }
    
  } catch (error) {
    console.error('❌ Polling cycle failed:', error.message);
  }
};

// Application startup
console.log('🚀 Starting Ofgem Publication Monitor');
console.log(`📧 Notifications will be sent to: ${ENV.notifyEmails.join(', ')}`);
console.log(`⏱️  Polling interval: ${CONFIG.pollInterval / 1000} seconds`);
console.log('─'.repeat(50));

// Initial check
pollForUpdates();

// Set up recurring polling
const pollInterval = setInterval(pollForUpdates, CONFIG.pollInterval);

// Graceful shutdown handling
const shutdown = () => {
  console.log('\n🛑 Shutting down Ofgem Monitor...');
  clearInterval(pollInterval);
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error.message);
  shutdown();
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason);
  shutdown();
});