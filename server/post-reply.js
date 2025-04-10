const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const csv = require("csv-parser");
require("dotenv").config();
const fspromises = require('fs').promises;

let messages = []; 
fs.createReadStream("./server/Example-CSV-BB-Code.csv")
    .pipe(csv({ headers: ["message"], skipLines: 0 }))
    .on("data", (row) => {
        if(row.message) {
            messages.push(row.message)
        }
    })
    .on("end", async () => {
        await postReplies(messages);
    });

async function updateSkipData(filePath, newSkipValue) {
    try {
        const data = await fspromises.readFile(filePath, 'utf8');
        const jsonData = JSON.parse(data);
        jsonData.skip = newSkipValue;
        await fspromises.writeFile(filePath, JSON.stringify(jsonData, null, 2));
    } catch (err) {
        console.error('Error updating file:', err);
    }
}

async function waitForLoginSuccess(page) {
    // Wait for either login success or failure
    try {
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 });
        // Check if we're still on login page (login failed)
        if (page.url().includes('/login')) {
            throw new Error('Login failed - still on login page');
        }
        return true;
    } catch (err) {
        console.log('Navigation timeout, checking login state...');
        // Additional checks for login state
        return false;
    }
}

async function postReplies(messages) {
    console.log('Total records: ' + messages.length);
    const data = await fspromises.readFile('./server/data/data.json', 'utf8');
    const jsonData = JSON.parse(data);
    const THREAD_URL = jsonData.threads;

    if(messages.length == jsonData.skip) {
        return;
    }

    const browser = await puppeteer.launch({ 
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });
    
    const page = await browser.newPage();
    
    // Configure page to handle unexpected navigation and errors
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(30000);

    // Step 1: Login with retries
    let loggedIn = false;
    let loginAttempts = 0;
    const maxLoginAttempts = 3;

    while (!loggedIn && loginAttempts < maxLoginAttempts) {
        try {
            loginAttempts++;
            console.log(`Login attempt ${loginAttempts} of ${maxLoginAttempts}`);

            await page.goto("https://www.reef2reef.com/login", {
                waitUntil: 'networkidle2',
                timeout: 60000
            });

            // Wait for login form to be ready
            await page.waitForSelector('input[name="login"]', { visible: true, timeout: 30000 });
            await page.waitForSelector('input[name="password"]', { visible: true, timeout: 30000 });

            // Clear fields first in case of previous attempts
            await page.$eval('input[name="login"]', el => el.value = '');
            await page.$eval('input[name="password"]', el => el.value = '');

            // Type credentials
            await page.type('input[name="login"]', process.env.R2R_EMAIL, { delay: 50 });
            await page.type('input[name="password"]', process.env.R2R_PASSWORD, { delay: 50 });

            // Click submit and wait for navigation
            const loginPromise = page.click('button[type="submit"].button--icon--login');
            const navigationPromise = waitForLoginSuccess(page);
            
            await Promise.all([loginPromise, navigationPromise]);
            
            loggedIn = true;
            console.log('Login successful');
        } catch (err) {
            console.error(`Login attempt ${loginAttempts} failed:`, err.message);
            if (loginAttempts < maxLoginAttempts) {
                console.log('Retrying login...');
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retry
            } else {
                throw new Error('Max login attempts reached');
            }
        }
    }

    if (!loggedIn) {
        await browser.close();
        throw new Error('Failed to login after multiple attempts');
    }

    // Step 2: Post Replies
    for (let i = jsonData.skip; i < messages.length; i++) {
        let message = messages[i];
        console.log('Current index: ' + i);
       
        if(message) {
            let replyPosted = false;
            let replyAttempts = 0;
            const maxReplyAttempts = 3;

            while (!replyPosted && replyAttempts < maxReplyAttempts) {
                try {
                    replyAttempts++;
                    console.log(`Reply attempt ${replyAttempts} for index ${i}`);

                    await page.goto(`${THREAD_URL}/reply`, {
                        waitUntil: 'networkidle2',
                        timeout: 60000
                    });

                    await page.waitForSelector('button#xfBbCode-1', { visible: true, timeout: 30000 });
                    await page.click('button#xfBbCode-1');
                    
                    await page.waitForSelector('div[contenteditable="true"]', { visible: true, timeout: 30000 });
                    await page.focus('div[contenteditable="true"]');
                    
                    // Clear existing content if any
                    await page.evaluate(() => {
                        document.querySelector('div[contenteditable="true"]').innerHTML = '';
                    });
                    
                    await page.type('div[contenteditable="true"]', message, { delay: 50 });
                    
                    await page.waitForSelector('button[type="submit"].button--icon--reply', { visible: true, timeout: 30000 });
                    await page.click('button[type="submit"].button--icon--reply');
                    
                    // Wait for reply to be posted
                    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 });
                    
                    console.log(`Successfully posted reply ${i + 1}/${messages.length}`);
                    replyPosted = true;
                    await updateSkipData('./server/data/data.json', i + 1);
                    
                    // Wait before next post
                    if (i < messages.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, jsonData.interval));
                    }
                } catch (err) {
                    console.error(`Error posting reply ${i}:`, err.message);
                    if (replyAttempts < maxReplyAttempts) {
                        console.log('Retrying reply...');
                        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retry
                    } else {
                        console.error(`Failed to post reply ${i} after ${maxReplyAttempts} attempts`);
                        // Continue with next message instead of stopping
                    }
                }
            }
        }
    }

    await browser.close();
    console.log('Automation completed');
};