const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const csv = require("csv-parser");
const bodyParser = require('body-parser');
const session = require('express-session');
const fspromises = require('fs').promises;

const app = express();
const PORT = 3000;
let workerThread = null;
let isRunning = false;
let isClickedStartButton = false;
let timerId = null;
let totalRecords = 0;
let messages = [];

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: '1234567890',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// File paths
const DATA_FILE = path.join(__dirname, 'data', 'data.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// Ensure data directory exists
if (!fs.existsSync(path.dirname(DATA_FILE))) {
    fs.mkdirSync(path.dirname(DATA_FILE));
}

// Initialize files with default values if they don't exist
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
        start: 0,
        end: 100,
        threads: 1,
        skip: 0,
        pauseDuration: 10,
        interval: 1
    }, null, 2));
}

if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({
        users: [
            { username: 'admin', password: 'password' } // Change in production!
        ]
    }, null, 2));
}

// Auth middleware
const requireLogin = (req, res, next) => {
    if (!req.session.user) return res.redirect('/');
    next();
};

// Routes
app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/inputs.html');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const users = JSON.parse(fs.readFileSync(USERS_FILE)).users;

    const user = users.find(u => u.username === username && u.password === password);

    if (user) {
        req.session.user = user;
        return res.redirect('/inputs.html');
    }

    res.redirect('/?error=1');
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Config API endpoints
app.get('/api/config', (req, res) => {
    try {
        const config = JSON.parse(fs.readFileSync(DATA_FILE));
        res.json(config);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load configuration' });
    }
});

app.post('/api/config', (req, res) => {
    try {
        const { start, end, threads, skip, pauseDuration, interval } = req.body;

        // Validate all fields are numbers
        if ([start, end, skip, pauseDuration, interval].some(isNaN)) {
            return res.status(400).json({ error: 'All fields must be numbers' });
        }

        const config = {
            start: parseInt(start),
            end: parseInt(end),
            threads: threads,
            skip: parseInt(skip),
            pauseDuration: parseInt(pauseDuration),
            interval: parseInt(interval)
        };

        fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 2));
        res.json({ success: true });
    } catch (error) {
        console.log(error)
        res.status(500).json({ error: 'Failed to save configuration' });
    }
});

// Protected route
app.get('/inputs.html', requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'inputs.html'));
});


// Add these new endpoints after your existing API routes
app.post('/api/start', async (req, res) => {
    
    
    if (isRunning) {
        return res.status(400).json({ error: 'Worker is already running' });
    }


    const data = await fspromises.readFile('./server/data/data.json', 'utf8');
    const jsonData = JSON.parse(data);
    
    console.log(totalRecords);
    if(totalRecords == jsonData.skip) {
        res.status(500).json({ error: 'Already Posted all, reset the skip to 0!', details: "Already Posted all, reset the skip to 0!" });
        return;
    }

    try {
        // Read current config
        const config = JSON.parse(fs.readFileSync(DATA_FILE));

        // Start the post-reply.js script
        workerThread = spawn('node', [path.join(__dirname, 'post.js')]); //For dev
        // workerThread = spawn('xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24" node', [path.join(__dirname, 'post-reply.js')]); //For prod

        // Handle process events
        workerThread.stdout.on('data', (data) => {
            console.log(`post-reply stdout: ${data}`);
        });

        workerThread.stderr.on('data', (data) => {
            console.error(`post-reply stderr: ${data}`);
        });

        workerThread.on('close', (code) => {
            console.log(`post-reply process exited with code ${code}`);
            isRunning = false;
            workerThread = null;
        });
        isClickedStartButton = true;
        isRunning = true;
        

        timerId = setInterval(() => {
            if(isClickedStartButton) {
                if(!isRunning && !workerThread) {
                    workerThread = spawn('node', [path.join(__dirname, 'post.js')]); //for dev
                    // workerThread = spawn('xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24" node', [path.join(__dirname, 'post-reply.js')]); //For prod

                    // Handle process events
                    workerThread.stdout.on('data', (data) => {
                        console.log(`post-reply stdout: ${data}`);
                    });
            
                    workerThread.stderr.on('data', (data) => {
                        console.error(`post-reply stderr: ${data}`);
                    });
            
                    workerThread.on('close', (code) => {
                        console.log(`post-reply process exited with code ${code}`);
                        isRunning = false;
                        workerThread = null;
                    });
                }
            }
        }, jsonData.pauseDuration * 1000);
        
        res.json({ success: true, running: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to start worker', details: error.message });
    }
});

app.post('/api/stop', (req, res) => {
    if (!isRunning || !workerThread) {
        return res.status(400).json({ error: 'Worker is not running' });
    }

    try {
        // Kill the worker process
        workerThread.kill();
        workerThread = null;
        isRunning = false;
        isClickedStartButton = false;
        clearInterval(timerId); 
        res.json({ success: true, running: false });
    } catch (error) {
        res.status(500).json({ error: 'Failed to stop worker', details: error.message });
    }
});

app.get('/api/status', (req, res) => {
    res.json({ running: isRunning });
});

fs.createReadStream("./server/Example-CSV-BB-Code.csv")
    .pipe(csv({ headers: ["message"], skipLines: 0 })) // Adjust if CSV has no header
    .on("data", (row) => {
        // console.log(row);
        if(row.message) {
            messages.push(row.message)
        }
    })
    .on("end", async () => {
        totalRecords = messages.length;
    });


// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});