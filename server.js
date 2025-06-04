const express = require('express');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, createPartFromUri } = require('@google/generative-ai');
require('dotenv').config();
const path = require('path');
const fs = require('fs/promises');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

let MODEL_NAME;
let initialMessageHistory;
let sourceContent = '';
let bnccPdfConfig = null;
let bnccPdfPart = null;

async function uploadRemotePDF(url, displayName) {
    console.log(`Iniciando upload de PDF: ${displayName} de ${url}`);
    const pdfBuffer = await fetch(url)
        .then((response) => {
            if (!response.ok) {
                throw new Error(`Falha ao buscar PDF: ${response.statusText} (Status: ${response.status})`);
            }
            return response.arrayBuffer();
        });

    if (!process.env.API_KEY) {
        throw new Error("API_KEY não definida. Não é possível fazer upload de arquivos.");
    }
    const ai = new GoogleGenerativeAI(process.env.API_KEY);

    const fileBlob = new Blob([pdfBuffer], { type: 'application/pdf' });
    const file = await ai.files.upload({
        file: fileBlob,
        config: {
            displayName: displayName,
        },
    });
    console.log(`Upload inicial do arquivo '${displayName}' concluído. Nome do arquivo: ${file.name}`);

    let getFile = await ai.files.get({ name: file.name });
    while (getFile.state === 'PROCESSING' || getFile.state === 'PENDING') {
        getFile = await ai.files.get({ name: file.name });
        console.log(`Status atual do arquivo '${displayName}': ${getFile.state}`);
        console.log('Arquivo ainda está processando/pendente, tentando novamente em 5 segundos...');
        await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    if (getFile.state === 'FAILED') {
        throw new Error(`O processamento do arquivo '${displayName}' falhou. Status: ${getFile.state}. Erro: ${getFile.error || 'Desconhecido'}`);
    }

    console.log(`Processamento do arquivo '${displayName}' concluído com sucesso. Status: ${getFile.state}`);
    return getFile;
}

async function loadConfigAndData() {
    try {
        const configPath = path.join(__dirname, 'config', 'data.json');
        const configData = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(configData);

        MODEL_NAME = config.modelName;
        initialMessageHistory = config.initialMessageHistory;
        bnccPdfConfig = config.bnccPdfConfig;
        console.log("Configurações do modelo e histórico inicial carregados de data.json.");

        if (bnccPdfConfig && bnccPdfConfig.url && bnccPdfConfig.displayName) {
            try {
                const uploadedFile = await uploadRemotePDF(bnccPdfConfig.url, bnccPdfConfig.displayName);
                if (uploadedFile.uri && uploadedFile.mimeType) {
                    bnccPdfPart = createPartFromUri(uploadedFile.uri, uploadedFile.mimeType);
                    console.log(`Documento BNCC carregado e pronto para uso: ${uploadedFile.name}`);

                    if (initialMessageHistory[0] && initialMessageHistory[0].role === 'user') {
                        initialMessageHistory[0].parts.push(bnccPdfPart);
                        console.log("Documento BNCC injetado no prompt inicial do modelo.");
                    } else {
                        console.warn("Aviso: Não foi possível injetar o PDF da BNCC no prompt inicial. Verifique a estrutura de initialMessageHistory.");
                    }
                } else {
                    console.error(`Erro: PDF da BNCC não retornou URI ou mimeType válido. Não será anexado.`);
                }
            } catch (pdfError) {
                console.error(`Erro ao fazer upload ou processar o PDF da BNCC: ${pdfError.message}`);
                console.warn("Continuando sem o documento BNCC devido a erro.");
            }
        } else {
            console.warn("Aviso: Configuração do PDF da BNCC não encontrada ou incompleta em data.json. Não será carregado.");
        }

        try {
            sourceContent = await fs.readFile(sourceFilePath, 'utf8');
            console.log(`Conteúdo da fonte '${sourceFilePathFromConfig}' carregado com sucesso.`);

            if (initialMessageHistory[0] && initialMessageHistory[0].role === 'user') {
                const promptParts = initialMessageHistory[0].parts[0].text.split('Para me ajudar a criar o roteiro, preciso das seguintes informações.');
                if (promptParts.length > 1) {
                    initialMessageHistory[0].parts[0].text =
                        promptParts[0].trim() +
                        `\n\n**Diretrizes Adicionais para Conteúdo:**\n${sourceContent}\n\n` +
                        'Para me ajudar a criar o roteiro, preciso das seguintes informações.' +
                        promptParts[1];
                } else {
                    initialMessageHistory[0].parts[0].text += `\n\n**Diretrizes Adicionais para Conteúdo:**\n${sourceContent}`;
                }
            }
        } catch (error) {
            console.warn(`Aviso: Não foi possível carregar o arquivo de fonte '${sourceFilePathFromConfig}'. Continuando sem ele.`, error.message);
            sourceContent = 'Nenhuma diretriz de SEO disponível.';
        }

    } catch (error) {
        console.error("Erro fatal ao carregar configurações de data.json:", error);
        process.exit(1);
    }
}

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
    console.error("Erro: A chave de API não foi carregada. Verifique seu arquivo .env.");
    process.exit(1);
}

const userSessions = new Map();
const MAX_HISTORY_LENGTH = 12;

async function runChat(sessionId, userInput) {
    if (!MODEL_NAME || !initialMessageHistory) {
        await loadConfigAndData();
    }

    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    const generationConfig = {
        temperature: 0.9,
        topK: 1,
        topP: 1,
        maxOutputTokens: 1000,
    };

    const safetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ];

    let currentHistory = userSessions.get(sessionId);
    if (!currentHistory) {
        currentHistory = JSON.parse(JSON.stringify(initialMessageHistory));
        userSessions.set(sessionId, currentHistory);
    }

    if (currentHistory.length > MAX_HISTORY_LENGTH) {
        currentHistory.splice(2, 2);
    }

    currentHistory.push({
        role: 'user',
        parts: [{ text: userInput }]
    });

    const chat = model.startChat({
        generationConfig,
        safetySettings,
        history: currentHistory,
    });

    try {
        const result = await chat.sendMessage(userInput);
        const botResponse = result.response.text();

        currentHistory.push({
            role: 'model',
            parts: [{ text: botResponse }]
        });

        return botResponse;
    } catch (error) {
        console.error('Erro ao chamar a API Gemini:', error);
        if (currentHistory[currentHistory.length - 1].role === 'user') {
            currentHistory.pop();
        }
        throw error;
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/loader.gif', (req, res) => {
    res.sendFile(path.join(__dirname, 'images', 'loader.gif'));
});

app.get('/send.png', (req, res) => {
    res.sendFile(path.join(__dirname, 'images', 'send.png'));
});

app.post('/chat', async (req, res) => {
    try {
        const userInput = req.body?.userInput;
        const sessionId = req.body?.sessionId || 'default-session-id';

        if (!userInput) {
            return res.status(400).json({ error: 'Corpo da requisição inválido: userInput é necessário.' });
        }

        const response = await runChat(sessionId, userInput);
        res.json({ response });
    } catch (error) {
        console.error('Erro na rota /chat:', error);
        if (error.status === 429) {
            res.status(429).json({
                error: 'Você excedeu sua cota de uso da API. Por favor, aguarde e tente novamente mais tarde.',
                details: error.errorDetails || 'Detalhes do erro de cota.'
            });
        } else {
            res.status(500).json({ error: 'Erro interno do servidor ao processar sua solicitação.' });
        }
    }
});

loadConfigAndData().then(() => {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}).catch(err => {
    console.error("Falha ao iniciar o servidor devido a erro de carregamento:", err);
    process.exit(1);
});