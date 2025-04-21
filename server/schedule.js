const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const path = require('path');
const csv = require("csv-parser");
const { json } = require("body-parser");
require("dotenv").config();
const fspromises = require('fs').promises;

let messages = [];
let resultProcessing = [];


let processingIndex = 0;
fs.createReadStream("./server/Example-CSV-BB-Code.csv")
    .pipe(csv({ headers: ["message"], skipLines: 0 })) // Adjust if CSV has no header
    .on("data", (row) => {
        // console.log(row);
        if (row.message) {
            messages.push(row.message);
            resultProcessing.push({ index: processingIndex, schedule: {}, status: false });
            processingIndex ++;
        }
    })
    .on("end", async () => {
        const filePath = path.join(__dirname, 'result.json');

        try {
            if (!fs.existsSync(filePath)) {
                resultProcessing = await makeResultProcessing();
                fs.writeFileSync(filePath, JSON.stringify(resultProcessing, null, 2));
                console.log('result.json created with initial data');
            } else {
                const data = fs.readFileSync(filePath, 'utf8');
                resultProcessing = JSON.parse(data);
                // console.log('Existing data:', resultProcessing);
                console.log('result.json already exists');
            }
        } catch (err) {
            console.error('Error:', err);
        }

        // console.log(resultProcessing);
        await postReplies(messages);

    });

async function makeResultProcessing() {
    const data = await fspromises.readFile('./server/data/data.json', 'utf8');
    const jsonData = JSON.parse(data);
    const start = jsonData.start;
    const interval = jsonData.interval;
    let currentDate = new Date(start);

    for(let i = 0; i < resultProcessing.length; i++) {
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        let hours = currentDate.getHours();
        const minutes = String(currentDate.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';

        hours = hours % 12;
        hours = hours ? hours : 12; // the hour '0' should be '12'
        hours = String(hours).padStart(2, '0');

        resultProcessing[i].schedule = {
            date: year + '-' + month + '-' + day,
            hours,
            minutes,
            ampm
        }

        currentDate = new Date(currentDate.getTime() + interval * 60000);
    }

    return resultProcessing;

}

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

async function updateStatus(skip) {
    try {
        // Read the file
        const data = await fspromises.readFile('./server/result.json', 'utf8');
        const jsonData = JSON.parse(data);

        // Update the skip data
        jsonData[skip].status = true;

        // Write the file back
        await fspromises.writeFile('./server/result.json', JSON.stringify(jsonData, null, 2));

    } catch (err) {
        console.error('Error updating file:', err);
    }
}

function makeScheduleData(messages, start, interval, skip, count) {
    let messagesResult = [];
    let currentIndex = 0;
    let index = 0;

    let currentDate = new Date(start);

    let limit = count;

    if (messages.length < count + skip) {
        limit = messages.length - skip;
    }

    for (currentIndex = skip; index < limit; index++, currentIndex++) {

        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        let hours = currentDate.getHours();
        const minutes = String(currentDate.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';

        hours = hours % 12;
        hours = hours ? hours : 12; // the hour '0' should be '12'
        hours = String(hours).padStart(2, '0');

        messagesResult.push({
            message: messages[currentIndex],
            date: year + "-" + month + "-" + day,
            hours,
            minutes,
            ampm
        });

        currentDate = new Date(currentDate.getTime() + interval * 60000);
    }

    return messagesResult;
}

async function loginR2R(page) {
    // Step 1: Login
    await page.goto("https://www.reef2reef.com/login");
    await page.type('input[name="login"]', process.env.R2R_EMAIL);
    await page.type('input[name="password"]', process.env.R2R_PASSWORD);


    // Submit login
    await page.click('button[type="submit"].button--icon--login');
    await page.waitForNavigation();
    const finalUrl = page.url();
    console.log('Navigated to:', finalUrl);

    if (finalUrl == 'https://www.reef2reef.com/') {
        return 'success'
    } else {
        return await loginR2R(page);
    }
}

async function postReplies(messages) {
    console.log('Total records: ' + messages.length);
    const data = await fspromises.readFile('./server/data/data.json', 'utf8');
    const jsonData = JSON.parse(data);


    const THREAD_URL = jsonData.threads;

    if (messages.length == jsonData.skip) {
        return;
    }

    // let messagesResult = makeScheduleData(messages, jsonData.start, jsonData.interval, jsonData.skip, jsonData.end);

    // console.log(messagesResult);

    const browser = await puppeteer.launch({ headless: false }); // Set `headless: true` in production

    const page = await browser.newPage();

    let result = await loginR2R(page);

    if (result == 'success') {
        
        let currentIndex = 0;

        const intervalId = setInterval(async () => {
            const data = await fspromises.readFile('./server/data/data.json', 'utf8');
            const jsonData = JSON.parse(data);
            const dataSchedule = await fspromises.readFile('./server/result.json', 'utf8');
            const jsonDataSchedule = JSON.parse(dataSchedule);

            

            if (messages.length == jsonData.skip) {
                clearInterval(intervalId);
                await browser.close();
                return;
            }

            if (currentIndex >= jsonData.end) {
                clearInterval(intervalId);
                await browser.close();
                return;
            }
            const page = await browser.newPage();
            try {

                if(!jsonDataSchedule[jsonData.skip].status) {
                    const message = messages[jsonData.skip];
                    
                    await page.goto(`${THREAD_URL}`);
                    await page.click('button#xfBbCode-1');
                    await page.waitForSelector('div[contenteditable="true"]');
                    await page.type('div[contenteditable="true"]', message);
    
                    //Adding schedule 
                    await page.click('input[type="checkbox"][name="__schedule[enabled]"]');
                    await page.type('input[type="text"][name="__schedule[date]"]', jsonDataSchedule[jsonData.skip].schedule.date);
                    await page.type('input[type="number"][name="__schedule[hours]"]', jsonDataSchedule[jsonData.skip].schedule.hours);
                    await page.type('input[type="number"][name="__schedule[minutes]"]', jsonDataSchedule[jsonData.skip].schedule.minutes);
                    await page.select('select[name="__schedule[is_pm]"]', jsonDataSchedule[jsonData.skip].schedule.ampm);
                    await page.click('input[type="checkbox"][name="__schedule[action][publish]"]');
    
                    //End of adding schedule
    
                    await page.click('button[type="submit"].button--icon--reply');

                    await updateStatus(jsonData.skip);
                } else {

                }
                
                await updateSkipData('./server/data/data.json', jsonData.skip + 1);

                currentIndex++;

                await new Promise((resolve) => setTimeout(resolve, 5000));
                if(page) {
                    await page.close();
                }
                

            } catch (e) {
                await page.close();
                console.log(e);
            }


        }, 20 * 1000);
    }


};