const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const csv = require("csv-parser");
require("dotenv").config();
const fspromises = require('fs').promises;

let messages = []; 
fs.createReadStream("./server/Example-CSV-BB-Code.csv")
    .pipe(csv({ headers: ["message"], skipLines: 0 })) // Adjust if CSV has no header
    .on("data", (row) => {
        // console.log(row);
        if(row.message) {
            messages.push(row.message)
        }
    })
    .on("end", async () => {
        // console.log("CSV loaded. Starting automation...");
        await postReplies(messages);
        // console.log(messages)
    });

    async function updateSkipData(filePath, newSkipValue) {
        try {
            // Read the file
            const data = await fspromises.readFile(filePath, 'utf8');
            const jsonData = JSON.parse(data);
            
            // Update the skip data
            jsonData.skip = newSkipValue;
            
            // Write the file back
            await fspromises.writeFile(filePath, JSON.stringify(jsonData, null, 2));
            
        } catch (err) {
            console.error('Error updating file:', err);
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

    const browser = await puppeteer.launch({ headless: false }); // Set `headless: true` in production
    // const browser = await puppeteer.launch({ 
    //     headless: true,  
    //     args: [
    //         '--no-sandbox',
    //         '--disable-setuid-sandbox' // Required for Linux without GUI
    //       ]
    // }); // For production
    const page = await browser.newPage();

    // Step 1: Login
    await page.goto("https://www.reef2reef.com/login");
    await page.type('input[name="login"]', process.env.R2R_EMAIL);
    await page.type('input[name="password"]', process.env.R2R_PASSWORD);

    // Step 2: Solve CAPTCHA if present
    const captchaExists = await page.$('div.g-recaptcha');


    // if (captchaExists) {
    //     console.log("Solving CAPTCHA...");
    //     const siteKey = await page.$eval('div.g-recaptcha', (el) => el.getAttribute("data-sitekey"));
    //     const { data } = await axios.get(
    //         `https://2captcha.com/in.php?key=${process.env.CAPTCHA_API_KEY}&method=userrecaptcha&googlekey=${siteKey}&pageurl=${page.url()}`
    //     );
    //     const captchaId = data.split("|")[1];

    //     // Poll for CAPTCHA solution
    //     let captchaResponse;
    //     while (!captchaResponse) {
    //         await new Promise((resolve) => setTimeout(resolve, 5000));
    //         const { data } = await axios.get(
    //             `https://2captcha.com/res.php?key=${process.env.CAPTCHA_API_KEY}&action=get&id=${captchaId}`
    //         );
    //         if (data.includes("OK")) captchaResponse = data.split("|")[1];
    //     }

    //     // Inject CAPTCHA solution
    //     await page.evaluate((response) => {
    //         document.getElementById("g-recaptcha-response").innerHTML = response;
    //     }, captchaResponse);
    // }

    // Submit login
    await page.click('button[type="submit"].button--icon--login');
    await page.waitForNavigation();

    // Step 3: Post Replies
    

    for (let i = jsonData.skip; i< messages.length; i++) {
        let message = messages[i];
        console.log('current skip: ' + i)
       
        if(message) {
            await page.goto(`${THREAD_URL}/reply`);
            await page.click('button#xfBbCode-1');
            await page.waitForSelector('div[contenteditable="true"]');
            await page.type('div[contenteditable="true"]', message);
            await page.click('button[type="submit"].button--icon--reply');
            
            await new Promise((resolve) => setTimeout(resolve, jsonData.interval)); // Avoid rate limits
            
            updateSkipData('./server/data/data.json', i+1);
        }
    }

    await browser.close();
};