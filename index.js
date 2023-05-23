// https://github.com/openai/openai-node/issues/18
// https://github.com/jddev273/simple-chatgpt-chat-streaming-demo

const express = require('express');
const {Configuration, OpenAIApi} = require("openai");
const app = express();
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
const { stringify } = require('querystring');
require("dotenv").config();
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

app.use(cors());
app.use(express.json());
app.use('/', express.static(__dirname + '/client')); // Serves resources from client folder

// Set up Multer to handle file uploads
const upload = multer({
    storage: multer.diskStorage({
        destination: function (req, file, cb) {
            cb(null, 'uploads/')
        },
        filename: function (req, file, cb) {
            const extension = path.extname(file.originalname);
            const filename = uuidv4() + extension;
            cb(null, filename);
        }
    }),
    limits: { fileSize: 1024 * 1024 * 10 }, // 10 MB
    fileFilter: function (req, file, cb) {
        const allowedExtensions = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm'];
        const extension = path.extname(file.originalname);
        if (allowedExtensions.includes(extension)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type.'));
        }
    }
});

app.post('/transcribe', upload.single('audio'), async (req, res) => {
    try {
        const resp = await openai.createTranscription(
            fs.createReadStream(req.file.path),
            "whisper-1",
            'text'
        );
        return res.send(resp.data.text);
    } catch (error) {
        console.error(error);
        return res.status(500).send(error.message);
    } finally {
        fs.unlinkSync(req.file.path);
    }
});

app.post('/get-prompt-result', async (req, res) => {
    // Get the prompt from the request body
    const {chatHistory, model = 'gpt'} = req.body;

    prompt = chatHistory[chatHistory.length-1].content;

    console.log(chatHistory);

    // Check if prompt is present in the request
    if (chatHistory.length == 0 || !prompt) {
        // Send a 400 status code and a message indicating that the prompt is missing
        return res.status(400).send({error: 'Prompt is missing in the request'});
    }

    try {
        // Use the OpenAI SDK to create a completion
        // with the given prompt, model and maximum tokens
        if (model === 'image') {
            const result = await openai.createImage({
                prompt,
                response_format: 'url',
                size: '512x512'
            });
            return res.send(result.data.data[0].url);
        }
        if (model === 'chatgpt') {
            const result = await openai.createChatCompletion({
                model:"gpt-3.5-turbo",
                messages: chatHistory,
                stream: true
            }, { responseType: 'stream' });

            result.data.on('data', data => {
                const lines = data.toString().split('\n').filter(line => line.trim() !== '');
                for (const line of lines) {
                    const message = line.replace(/^data: /, '');
                    if (message === '[DONE]') {
                        res.end();
                        return; // Stream finished
                    }
                    try {
                        const parsed = JSON.parse(message);
                        if (parsed.choices[0].delta.content !== undefined) {
                            res.write(parsed.choices[0].delta.content);
                        }
                    } catch(error) {
                        console.error('Could not JSON parse stream message', message, error);
                    }
                }
            });
        } else {
            const completion = await openai.createCompletion({
                model: model === 'gpt' ? "text-davinci-003" : 'code-davinci-002', // model name
                prompt: `Please reply below question in markdown format.\n ${prompt}`, // input prompt
                max_tokens: model === 'gpt' ? 4000 : 8000, // Use max 8000 tokens for codex model
                stream: true
            }, { responseType: 'stream' });

            completion.data.on('data', data => {
                const lines = data.toString().split('\n').filter(line => line.trim() !== '');
                for (const line of lines) {
                    const message = line.replace(/^data: /, '');
                    if (message === '[DONE]') {
                        res.end();
                        return; // Stream finished
                    }
                    try {
                        const parsed = JSON.parse(message);
                        if (parsed.choices[0].text !== undefined) {
                            res.write(parsed.choices[0].text);
                        }
                    } catch(error) {
                        console.error('Could not JSON parse stream message', message, error);
                    }
                }
            });
        }
    } catch (error) {
        const errorMsg = error.response ? error.response.data.error : `${error}`;
        console.error(errorMsg);
        // Send a 500 status code and the error message as the response
        return res.status(500).send(errorMsg);
    }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Listening on port ${port}`));
