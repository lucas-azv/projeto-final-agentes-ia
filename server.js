// node --version # Deve ser >= 18
// npm install @google/generative-ai express dotenv

const express = require('express');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const dotenv = require('dotenv').config(); // Carrega as variáveis de ambiente do .env
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware para parsear JSON no corpo das requisições
app.use(express.json());
// Servir arquivos estáticos (como index.html, script.js, styles.css, loader.gif)
app.use(express.static(__dirname));

// --- Configuração do Modelo Gemini ---
const MODEL_NAME = "gemini-1.5-pro"; // Usando o modelo corrigido
const API_KEY = process.env.API_KEY; // Sua chave de API deve estar no arquivo .env

if (!API_KEY) {
    console.error("Erro: A chave de API não foi carregada. Verifique seu arquivo .env.");
    process.exit(1); // Encerra o processo se a chave não estiver disponível
}

// Histórico de chat inicializado com as instruções
const messageHistory = [
    {
        role: 'user',
        parts: [{ text: `Você é um assistente de criação de conteúdo especializado em roteirizar vídeos para plataformas como YouTube, TikTok, Instagram Reels e outras.
Seu objetivo é criar roteiros envolventes, com linguagem adequada à plataforma, que sigam a duração estimada e mantenham o interesse da audiência do início ao fim.

Para me ajudar a criar o roteiro, preciso das seguintes informações. Por favor, sempre me peça esses detalhes se eu não os fornecer:
- **Tema do vídeo** (Ex: "Como usar IA para criar planos de aula na educação básica")
- **Plataforma de postagem** (Ex: TikTok, YouTube, Instagram Reels)
- **Duração desejada** (Ex: 60 segundos, 3 minutos, 10 minutos)
- **Objetivo do vídeo** (Ex: informar, educar, entreter, viralizar, vender, engajar)
- **Tom de voz e estilo** (Ex: informal e dinâmico, técnico e direto, divertido e criativo, emocional e inspirador)
- **Estrutura desejada (opcional)** (Ex: gancho + problema + solução + call to action (CTA))
- **Público-alvo (opcional, mas importante)** (Ex: professores do ensino médio, jovens empreendedores, pais de primeira viagem)` }]
    },
    {
        role: 'model',
        parts: [{ text: "Entendido! Estou pronto para ajudar a criar roteiros de vídeo incríveis. Para começar, por favor, me forneça o **tema do vídeo**, a **plataforma de postagem**, a **duração desejada**, o **objetivo** e o **tom de voz/estilo**. Se tiver, também pode incluir a **estrutura** e o **público-alvo**." }]
    }
];

const MAX_HISTORY_LENGTH = 12; // Aumentei um pouco para acomodar o prompt inicial + conversação

async function runChat(userInput) {
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    const generationConfig = {
        temperature: 0.9,
        topK: 1,
        topP: 1,
        maxOutputTokens: 1000,
    };

    const safetySettings = [
        {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
    ];

    // --- Lógica para Limitar o Histórico ---
    // Começa a remover as mensagens mais antigas apenas DEPOIS que o histórico inicial for enviado
    // e o chat começar a crescer além de um certo ponto.
    // Ajuste MAX_HISTORY_LENGTH para controlar quantos pares de mensagens (user/model)
    // você quer manter ANTES do histórico inicial.
    if (messageHistory.length > MAX_HISTORY_LENGTH) {
        // Remove os pares de mensagens mais antigos, mas mantendo as instruções iniciais.
        // Se o histórico inicial tem 2 elementos, e MAX_HISTORY_LENGTH é 12,
        // isso significa que 10 elementos podem ser de conversas adicionais.
        // Se o histórico já tem as 2 instruções iniciais, e chegou a 13 elementos,
        // os 2 mais antigos (que não são as instruções) serão removidos.
        messageHistory.splice(2, 2); // Começa a remover a partir do terceiro elemento (índice 2)
    }

    // Adiciona mensagem do usuário ao histórico antes de enviar ao modelo
    messageHistory.push({
        role: 'user',
        parts: [{ text: userInput }]
    });

    const chat = model.startChat({
        generationConfig,
        safetySettings,
        history: messageHistory, // Envia o histórico (agora com instruções) para o modelo
    });

    try {
        const result = await chat.sendMessage(userInput);
        const botResponse = result.response.text();

        // Adiciona resposta do modelo ao histórico APÓS receber a resposta
        messageHistory.push({
            role: 'model',
            parts: [{ text: botResponse }]
        });

        return botResponse;
    } catch (error) {
        console.error('Erro ao chamar a API Gemini:', error);
        // Em caso de erro da API (como 429 Quota Exceeded), o histórico não deve ser corrompido.
        // Remove a última mensagem do usuário adicionada se a resposta do bot não for gerada.
        if (messageHistory[messageHistory.length - 1].role === 'user') {
            messageHistory.pop();
        }
        throw error; // Propaga o erro para ser tratado pelo app.post('/chat')
    }
}

// Rota para servir o arquivo HTML principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Rota para o loader.gif
app.get('/loader.gif', (req, res) => {
    res.sendFile(path.join(__dirname, 'loader.gif'));
});

// Rota para lidar com as requisições de chat
app.post('/chat', async (req, res) => {
    try {
        const userInput = req.body?.userInput;
        if (!userInput) {
            return res.status(400).json({ error: 'Corpo da requisição inválido: userInput é necessário.' });
        }

        const response = await runChat(userInput);
        res.json({ response });
    } catch (error) {
        console.error('Erro na rota /chat:', error);
        if (error.status === 429) {
            res.status(429).json({
                error: 'Você excedeu sua cota de uso da API. Por favor, aguarde e tente novamente mais tarde.',
                details: error.errorDetails
            });
        } else {
            res.status(500).json({ error: 'Erro interno do servidor ao processar sua solicitação.' });
        }
    }
});

// Inicia o servidor
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

if (!API_KEY) {
    console.error("Erro: API_KEY não definida. Use um arquivo .env local ou configure no Heroku.");
    process.exit(1);
}
