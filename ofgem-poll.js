/**
 * Ofgem Publication Monitor
 * 
 * Monitors the Ofgem website for new publications and sends email notifications
 * when new content is detected. Uses the API endpoint as primary method with
 * web scraping as fallback. Maintains state to avoid duplicate notifications.
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
 * @version 1.1.0
 */

require('dotenv').config();
const fs = require('fs');
const { Resend } = require('resend');
const puppeteer = require('puppeteer');

// Configuration
const CONFIG = {
  apiUrl: 'https://www.ofgem.gov.uk/api/listing/4044?sort%5Bfield_published%5D%5Bpath%5D=field_published&sort%5Bfield_published%5D%5Bdirection%5D=desc',
  baseUrl: 'https://www.ofgem.gov.uk/search?sort=field_published&direction=desc',
  pollInterval: 5 * 60 * 1000, // 5 minutes
  stateFile: 'last_ofgem_publication.json',
  browserTimeout: 30000,
  selectorTimeout: 10000,
  apiTimeout: 10000,
  rateLimitDelay: 2000, // 2 seconds between API calls
  maxRetries: 3
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
 * Parses publication details from HTML markup
 * @param {string} markup - HTML markup string
 * @returns {Object|null} Publication object or null if parsing fails
 */
const parsePublicationFromMarkup = (markup) => {
  try {
    // Decode HTML entities
    const decodedMarkup = markup
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'");
    
    // Extract title from h3 tag
    const titleMatch = decodedMarkup.match(/<h3[^>]*>.*?<span[^>]*>.*?<span[^>]*>([^<]+)<\/span>/s);
    const title = titleMatch ? titleMatch[1].trim() : null;
    
    // Extract link from href attribute
    const linkMatch = decodedMarkup.match(/href="([^"]+)"/);
    const link = linkMatch ? `https://www.ofgem.gov.uk${linkMatch[1]}` : null;
    
    // Extract date from time tag
    const dateMatch = decodedMarkup.match(/<time[^>]*datetime="([^"]+)"[^>]*>([^<]+)<\/time>/);
    const date = dateMatch ? dateMatch[2].trim() : 'Unknown';
    
    if (!title || !link) {
      return null;
    }
    
    return { title, link, date };
    
  } catch (error) {
    console.log(`⚠️  Failed to parse markup: ${error.message}`);
    return null;
  }
};

/**
 * Fetches the latest publication using the API endpoint
 * @returns {Promise<Object|null>} Publication object or null if failed
 */
const fetchLatestPublicationViaAPI = async () => {
  try {
    console.log('🔌 Attempting to fetch via API...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.apiTimeout);
    
    const response = await fetch(CONFIG.apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Ofgem-Monitor/1.1.0'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data || !data.items || !Array.isArray(data.items) || data.items.length === 0) {
      throw new Error('Invalid API response structure - missing items array');
    }
    
    const latestPublication = data.items[0];
    
    if (!latestPublication.markup) {
      throw new Error('Publication markup is missing');
    }
    
    // Parse HTML content from the markup field to extract publication details
    const publication = parsePublicationFromMarkup(latestPublication.markup);
    
    if (!publication) {
      throw new Error('Failed to parse publication data from markup');
    }
    
    console.log('✅ API fetch successful');
    return publication;
    
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('⏰ API request timed out');
    } else {
      console.log(`⚠️  API fetch failed: ${error.message}`);
    }
    return null;
  }
};

/**
 * Fetches the latest publication from Ofgem website using web scraping (fallback)
 * @returns {Promise<Object|null>} Publication object or null if failed
 */
const fetchLatestPublicationViaScraping = async () => {
  console.log('🕷️  Falling back to web scraping...');
  
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

    if (publication) {
      console.log('✅ Web scraping fallback successful');
    }
    
    return publication;
    
  } catch (error) {
    console.error('❌ Web scraping fallback failed:', error.message);
    return null;
  } finally {
    await browser.close();
  }
};

/**
 * Fetches the latest publication with fallback strategy
 * @returns {Promise<Object|null>} Publication object or null if all methods failed
 */
const fetchLatestPublication = async () => {
  // Try API first
  let publication = await fetchLatestPublicationViaAPI();
  
  if (!publication) {
    // Add delay to respect rate limiting
    await new Promise(resolve => setTimeout(resolve, CONFIG.rateLimitDelay));
    
    // Try API again with retry
    for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
      console.log(`🔄 API retry attempt ${attempt}/${CONFIG.maxRetries}`);
      publication = await fetchLatestPublicationViaAPI();
      
      if (publication) break;
      
      if (attempt < CONFIG.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.rateLimitDelay * attempt));
      }
    }
  }
  
  // If API still fails, use web scraping fallback
  if (!publication) {
    publication = await fetchLatestPublicationViaScraping();
  }
  
  return publication;
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
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>New Ofgem Publication</title>
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
              line-height: 1.6; 
              color: #2d3748; 
              margin: 0; 
              padding: 20px; 
              background-color: #f7fafc; 
            }
            .container { 
              max-width: 500px; 
              margin: 0 auto; 
              background: white; 
              border-radius: 8px; 
              box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); 
              overflow: hidden; 
            }
            .header { 
              background: #2d3748; 
              color: white; 
              padding: 24px; 
              text-align: center; 
            }
            .header h1 { 
              margin: 0; 
              font-size: 20px; 
              font-weight: 500; 
              letter-spacing: -0.025em; 
            }
            .header p { 
              margin: 8px 0 0 0; 
              opacity: 0.8; 
              font-size: 14px; 
              font-weight: 400; 
            }
            .content { 
              padding: 24px; 
            }
            .publication-title { 
              font-size: 16px; 
              font-weight: 600; 
              color: #2d3748; 
              margin-bottom: 16px; 
              line-height: 1.5; 
            }
            .publication-meta { 
              margin-bottom: 20px; 
            }
            .meta-item { 
              display: flex; 
              align-items: center; 
              margin-bottom: 8px; 
              font-size: 14px; 
              color: #4a5568; 
            }
            .meta-label { 
              font-weight: 500; 
              color: #2d3748; 
              min-width: 80px; 
            }
            .cta-button { 
              display: block; 
              background: #2d3748; 
              color: white; 
              text-decoration: none; 
              padding: 16px 32px; 
              border-radius: 8px; 
              font-weight: 600; 
              font-size: 16px; 
              margin: 20px auto; 
              text-align: center; 
              max-width: 280px; 
              transition: background-color 0.2s ease; 
            }
            .cta-button:hover { 
              background: #4a5568; 
            }
            .divider { 
              height: 1px; 
              background: #e2e8f0; 
              margin: 24px 0; 
            }
            .github-link { 
              text-align: center; 
              margin: 20px 0; 
            }
            .github-link a { 
              color: #4a5568; 
              text-decoration: none; 
              font-size: 14px; 
              transition: color 0.2s ease; 
            }
            .github-link a:hover { 
              color: #2d3748; 
            }
            .cv-offer { 
              background: #f7fafc; 
              padding: 20px; 
              border-radius: 6px; 
              text-align: center; 
              border: 1px solid #e2e8f0; 
            }
            .cv-offer h3 { 
              margin: 0 0 8px 0; 
              font-size: 16px; 
              font-weight: 600; 
              color: #2d3748; 
            }
            .cv-offer p { 
              margin: 0 0 16px 0; 
              font-size: 14px; 
              color: #4a5568; 
            }
            .cv-button { 
              display: inline-block; 
              background: linear-gradient(45deg, #667eea, #764ba2, #f093fb, #f5576c, #4facfe, #00f2fe);
              background-size: 300% 300%;
              color: white; 
              text-decoration: none; 
              padding: 10px 18px; 
              border-radius: 5px; 
              font-weight: 500; 
              font-size: 14px; 
              transition: all 0.3s ease; 
              animation: shimmer 3s ease-in-out infinite;
              box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
            }
            .cv-button:hover { 
              transform: translateY(-2px);
              box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
              animation: shimmer 1.5s ease-in-out infinite;
            }
            @keyframes shimmer {
              0% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
            .footer { 
              background: #f7fafc; 
              padding: 20px 24px; 
              text-align: center; 
              border-top: 1px solid #e2e8f0; 
            }
            .footer-text { 
              color: #718096; 
              font-size: 13px; 
              margin-bottom: 8px; 
            }
            .footer-subtext { 
              color: #a0aec0; 
              font-size: 12px; 
            }
            @media (max-width: 600px) {
              body { padding: 10px; }
              .container { margin: 0; border-radius: 6px; }
              .header, .content, .footer { padding: 20px; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>New Ofgem Update</h1>
              <p>Tomato Energy updates delivered to your inbox</p>
            </div>
            
            <div class="content">
              <div class="publication-title">${publication.title}</div>
              
              <div class="publication-meta">
                <div class="meta-item">
                  <span class="meta-label">Published</span>
                  <span>${publication.date}</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">Type</span>
                  <span>Publication</span>
                </div>
              </div>
              
              <a href="${publication.link}" class="cta-button" target="_blank">
                Read Publication
              </a>
              
              <div class="divider"></div>
              
                <div class="cv-offer">
                  <h3>Need a boost?</h3>
                  <p>Quick motivation to power through your day</p>
                  <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" class="cv-button" target="_blank">
                    Get Motivated
                  </a>
                </div>
            </div>
            
            <div class="footer">
              <div class="footer-text">
                Automated notification from Ofgem Watch
              </div>
              <div class="footer-subtext">
                Powered by <a href="https://www.shazpay.link" target="_blank" style="color: #2d3748; text-decoration: none;">Shazpay</a>
              </div>
            </div>
          </div>
        </body>
        </html>
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
      
      // Check if any of the target keywords are in the title
      const titleLower = latestPublication.title.toLowerCase();
      const hasTomato = titleLower.includes('tomato');
      const hasSenapt = titleLower.includes('senapt');
      const hasLogicor = titleLower.includes('logicor');
      
      if (hasTomato || hasSenapt || hasLogicor) {
        console.log('🎯 Target keyword detected - sending notification!');
        if (hasTomato) console.log('🍅 Tomato found');
        if (hasSenapt) console.log('🔍 Senapt found');
        if (hasLogicor) console.log('🏢 Logicor found');
        await sendNotification(latestPublication);
        saveState(latestPublication);
      } else {
        console.log('🚫 No target keywords found - skipping notification');
        console.log('📝 Publication:', latestPublication.title);
        // Still save the state to avoid re-checking the same publication
        saveState(latestPublication);
      }
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