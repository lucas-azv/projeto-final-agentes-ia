const express = require('express');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
require('dotenv').config();
const path = require('path');
const fs = require('fs/promises'); // Usando promises para readFile

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname)); // Serve arquivos estáticos do diretório raiz

let MODEL_NAME;
let initialMessageHistory;
let sourceContent = '';
let primaryDocumentConfig = null;
let primaryDocumentPart = null;

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
    console.error("Erro: A chave de API (API_KEY) não foi carregada. Verifique seu arquivo .env ou as Config Vars do Heroku.");
    process.exit(1); // Encerra o processo se a API_KEY não estiver disponível
}
const genAI = new GoogleGenerativeAI(API_KEY);

async function loadConfigAndData() {
    try {
        const configPath = path.join(__dirname, 'config', 'data.json');
        const configData = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(configData);

        MODEL_NAME = config.modelName;
        // Faz uma cópia profunda para que o histórico inicial não seja modificado diretamente
        initialMessageHistory = JSON.parse(JSON.stringify(config.initialMessageHistory));
        primaryDocumentConfig = config.document; // Atribui a configuração do documento

        console.log("Configurações do modelo e histórico inicial carregados de data.json.");

        // LÓGICA PARA CARREGAR O DOCUMENTO PRIMÁRIO LOCALMENTe
        if (primaryDocumentConfig && primaryDocumentConfig.path && primaryDocumentConfig.mimeType) {
            const documentLocalPath = path.join(__dirname, primaryDocumentConfig.path);
            const documentMimeType = primaryDocumentConfig.mimeType;

            try {
                await fs.access(documentLocalPath, fs.constants.F_OK);
                console.log(`Documento primário encontrado localmente no caminho configurado: ${documentLocalPath}`);

                const documentBuffer = await fs.readFile(documentLocalPath);
                const base64Data = documentBuffer.toString('base64');

                primaryDocumentPart = {
                    inlineData: {
                        data: base64Data,
                        mimeType: documentMimeType,
                    },
                };

                console.log("Documento primário carregado e pronto para uso a partir do arquivo local (via inlineData).");

                // Injeta o documento na primeira mensagem 'user' do histórico inicial
                if (initialMessageHistory[0] && initialMessageHistory[0].role === 'user') {
                    if (!Array.isArray(initialMessageHistory[0].parts)) {
                        initialMessageHistory[0].parts = [];
                    }
                    initialMessageHistory[0].parts.push(primaryDocumentPart);
                    console.log("Documento primário injetado no prompt inicial do modelo.");
                } else {
                    console.warn("Aviso: Não foi possível injetar o documento primário no prompt inicial. Verifique a estrutura de initialMessageHistory.");
                }
            } catch (documentError) {
                console.error(`Erro ao carregar o documento primário localmente (${documentLocalPath}): ${documentError.message}`);
                console.warn("Continuando sem o documento primário devido a erro.");
            }
        } else {
            console.warn("Aviso: Configuração do documento primário (chave 'document') não encontrada ou incompleta em data.json. Não será carregado.");
        }

        // LÓGICA PARA CARREGAR O ARQUIVO DE FONTE (source.txt)
        const sourceFilePathFromConfig = config.sourceFilePath;

        if (sourceFilePathFromConfig) {
            const sourceFilePath = path.join(__dirname, sourceFilePathFromConfig);

            try {
                sourceContent = await fs.readFile(sourceFilePath, 'utf8');
                console.log(`Conteúdo da fonte '${sourceFilePath}' carregado com sucesso.`);

                if (initialMessageHistory[0] && initialMessageHistory[0].role === 'user' && initialMessageHistory[0].parts && initialMessageHistory[0].parts[0] && initialMessageHistory[0].parts[0].text) {
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
                } else {
                    console.warn("Aviso: A estrutura do prompt inicial não permite a injeção do conteúdo da fonte. Verifique initialMessageHistory.");
                }
            } catch (error) {
                console.warn(`Aviso: Não foi possível carregar o arquivo de fonte '${sourceFilePath}'. Continuando sem ele.`, error.message);
                sourceContent = 'Nenhuma diretriz de SEO disponível.';
            }
        } else {
            console.warn("Aviso: 'sourceFilePath' não configurado em data.json. O conteúdo da fonte não será carregado.");
            sourceContent = 'Nenhuma diretriz de SEO disponível.';
        }

    } catch (error) {
        console.error("Erro fatal ao carregar configurações de data.json:", error);
        process.exit(1);
    }
}

const userSessions = new Map();
const MAX_HISTORY_LENGTH = 12;

async function runChat(sessionId, userInput) {
    if (!MODEL_NAME || !initialMessageHistory) {
        console.warn("Modelo ou histórico inicial não carregados. Tentando carregar novamente...");
        await loadConfigAndData();
    }

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
        if (error.message && error.message.includes('quota')) {
            res.status(429).json({
                error: 'Você excedeu sua cota de uso da API. Por favor, aguarde e tente novamente mais tarde.',
                details: error.errorDetails || error.message
            });
        } else {
            res.status(500).json({ error: 'Erro interno do servidor ao processar sua solicitação.', details: error.message });
        }
    }
});

loadConfigAndData().then(() => {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}).catch(err => {
    console.error("Falha ao iniciar o servidor devido a erro no carregamento das configurações/documentos:", err);
    process.exit(1);
});